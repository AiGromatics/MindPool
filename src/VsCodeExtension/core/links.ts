import { type Dirent, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LinkTargetStatus } from './types.ts';
import { expandFolderPath, isInside, isSafeName } from './validation.ts';

/**
 * Skill links. AI tools such as Claude Code only discover skills one level deep
 * (`~/.claude/skills/<name>/SKILL.md`), while MindPool keeps them in
 * `<team repository>/mindSkills/<skill>/`. When the `mindpool.linkSkillsTo` setting names
 * folders, every skill found in mindSkills gets a link in each of those folders: a symlink, or a
 * junction on Windows (junctions need no admin rights).
 *
 * Ownership is read from the file system: a symlink that points inside mindSkills belongs to
 * MindPool, so it is created, repointed and removed freely. Anything else with the same name (a
 * real folder, a link to somewhere else) is never touched and is reported instead.
 */

export const SKILL_FILE = 'SKILL.md';

/** Inside mindSkills: the link folders of the last run, so they are cleaned up when the setting changes. */
export const LINK_STATE_FILE = '.links.json';

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

export interface SkillFolder {
    /** Name of the link, e.g. `brainstorming`. */
    linkName: string;
    /** Folder that holds the SKILL.md. */
    dir: string;
    /** The skill.json entry it comes from. */
    skill: string;
}

export interface LinkRequest {
    /** The mindSkills folder. Links pointing inside it belong to MindPool. */
    skillsDir: string;
    /** Absolute folders that must hold the links (see `resolveLinkTargets`). */
    targets: readonly string[];
    /** Installed skills, in skill.json order (first one wins on a name clash). */
    skills: readonly { name: string; dir: string }[];
}

export interface LinkResult {
    targets: LinkTargetStatus[];
    /** Links created or repointed by this run. */
    created: string[];
    /** Stale links removed by this run. */
    removed: string[];
    problems: string[];
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function samePath(a: string | undefined, b: string): boolean {
    if (a === undefined) {
        return false;
    }
    const norm = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
    return norm(a) === norm(b);
}

async function readDir(dir: string): Promise<Dirent[]> {
    try {
        return await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

async function hasSkillFile(dir: string): Promise<boolean> {
    // Case-insensitive, so `skill.md` behaves the same on Linux as on macOS and Windows.
    return (await readDir(dir)).some((e) => (e.isFile() || e.isSymbolicLink()) && e.name.toLowerCase() === SKILL_FILE.toLowerCase());
}

async function skillChildren(base: string, skill: string): Promise<SkillFolder[]> {
    const names = (await readDir(base))
        .filter((e) => e.isDirectory() && isSafeName(e.name))
        .map((e) => e.name)
        .sort();
    const found: SkillFolder[] = [];
    for (const name of names) {
        const dir = path.join(base, name);
        if (await hasSkillFile(dir)) {
            found.push({ linkName: name, dir, skill });
        }
    }
    return found;
}

/**
 * Finds the skills inside an installed skill folder:
 * 1. the folder itself when it has a SKILL.md, linked under its skill.json name;
 * 2. otherwise every `skills/<name>/` with a SKILL.md (the plugin layout, e.g. superpowers);
 * 3. otherwise every direct `<name>/` sub-folder with a SKILL.md (a plain collection).
 */
export async function findSkillFolders(skill: string, dir: string): Promise<SkillFolder[]> {
    if (await hasSkillFile(dir)) {
        return [{ linkName: skill, dir, skill }];
    }
    const plugin = await skillChildren(path.join(dir, 'skills'), skill);
    return plugin.length > 0 ? plugin : skillChildren(dir, skill);
}

/**
 * Expands the `linkSkillsTo` folders: `~` and `${userHome}` are supported, relative paths start
 * at the pool folder. Folders inside the team repository are refused, otherwise the links would
 * show up as changes to commit.
 */
export function resolveLinkTargets(values: readonly string[], options: { poolFolder: string; repoDir: string; home?: string }): { targets: string[]; problems: string[] } {
    const targets: string[] = [];
    const problems: string[] = [];
    for (const value of values) {
        if (value.includes('${workspaceFolder}')) {
            problems.push(`"mindpool.linkSkillsTo": "${value}" can't use \${workspaceFolder}, because every window that uses this pool folder shares the same links. Use an absolute path or ~.`);
            continue;
        }
        const expanded = expandFolderPath(value, { home: options.home ?? os.homedir(), base: options.poolFolder });
        if (!expanded.path) {
            problems.push(`"mindpool.linkSkillsTo": ${expanded.error ?? `"${value}" is not a valid folder.`}`);
            continue;
        }
        if (isInside(options.repoDir, expanded.path)) {
            problems.push(`"mindpool.linkSkillsTo": "${value}" is inside the team repository, so the links would show up as changes. Pick a folder outside it, such as ~/.claude/skills.`);
            continue;
        }
        if (!targets.some((t) => samePath(t, expanded.path as string))) {
            targets.push(expanded.path);
        }
    }
    return { targets, problems };
}

async function readState(skillsDir: string): Promise<string[]> {
    try {
        const raw: unknown = JSON.parse(await fs.readFile(path.join(skillsDir, LINK_STATE_FILE), 'utf8'));
        const targets = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['targets'] : undefined;
        return Array.isArray(targets) ? targets.filter((t): t is string => typeof t === 'string' && path.isAbsolute(t)) : [];
    } catch {
        return [];
    }
}

async function writeState(skillsDir: string, previous: readonly string[], targets: readonly string[]): Promise<void> {
    if (previous.length === targets.length && previous.every((p, i) => p === targets[i])) {
        return;
    }
    const file = path.join(skillsDir, LINK_STATE_FILE);
    if (targets.length === 0) {
        await fs.rm(file, { force: true });
        return;
    }
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ targets }, null, 4)}\n`, 'utf8');
}

/** Brings one folder in line with `wanted`. Returns how many links are in place afterwards. */
async function syncTarget(target: string, wanted: ReadonlyMap<string, SkillFolder>, skillsDir: string, result: LinkResult): Promise<number> {
    const inPlace = new Set<string>();

    // 1. Review MindPool's own links: keep the right ones, drop stale or repointed ones.
    for (const entry of await readDir(target)) {
        if (!entry.isSymbolicLink()) {
            continue;
        }
        const link = path.join(target, entry.name);
        let pointsTo: string;
        try {
            pointsTo = path.resolve(target, await fs.readlink(link));
        } catch {
            continue;
        }
        if (!isInside(skillsDir, pointsTo)) {
            continue; // not ours
        }
        if (samePath(wanted.get(entry.name)?.dir, pointsTo)) {
            inPlace.add(entry.name);
            continue;
        }
        try {
            await fs.unlink(link);
            result.removed.push(link);
        } catch (error) {
            result.problems.push(`Cannot remove the old link ${link}: ${errorMessage(error)}`);
        }
    }
    if (wanted.size === 0) {
        return 0;
    }

    // 2. Create the missing ones, never replacing something MindPool did not make.
    try {
        await fs.mkdir(target, { recursive: true });
    } catch (error) {
        result.problems.push(`Cannot create the link folder ${target}: ${errorMessage(error)}`);
        return 0;
    }
    for (const [name, folder] of wanted) {
        if (inPlace.has(name)) {
            continue;
        }
        const link = path.join(target, name);
        try {
            await fs.lstat(link);
            result.problems.push(`${link} already exists and was not made by MindPool, so "${name}" was not linked there.`);
            continue;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                result.problems.push(`Cannot check ${link}: ${errorMessage(error)}`);
                continue;
            }
        }
        try {
            await fs.symlink(folder.dir, link, LINK_TYPE);
            result.created.push(link);
            inPlace.add(name);
        } catch (error) {
            result.problems.push(`Cannot link "${name}" into ${target}: ${errorMessage(error)}`);
        }
    }
    return inPlace.size;
}

/**
 * Makes every target folder hold exactly one link per installed skill, and removes MindPool's
 * links from folders that are no longer configured. Problems are collected, never thrown.
 */
export async function syncSkillLinks(request: LinkRequest): Promise<LinkResult> {
    const result: LinkResult = { targets: [], created: [], removed: [], problems: [] };
    const wanted = new Map<string, SkillFolder>();
    for (const skill of request.skills) {
        const folders = await findSkillFolders(skill.name, skill.dir);
        if (folders.length === 0) {
            result.problems.push(`"${skill.name}" has no ${SKILL_FILE}, so it was not linked.`);
        }
        for (const folder of folders) {
            const taken = wanted.get(folder.linkName);
            if (taken) {
                result.problems.push(`"${folder.linkName}" is in both ${taken.skill} and ${folder.skill}; the link points to ${taken.skill}.`);
            } else {
                wanted.set(folder.linkName, folder);
            }
        }
    }

    const previous = await readState(request.skillsDir);
    const stale = previous.filter((p) => !request.targets.some((t) => samePath(t, p)));
    for (const target of request.targets) {
        result.targets.push({ path: target, linked: await syncTarget(target, wanted, request.skillsDir, result) });
    }
    for (const target of stale) {
        await syncTarget(target, new Map(), request.skillsDir, result);
    }
    try {
        await writeState(request.skillsDir, previous, request.targets);
    } catch (error) {
        result.problems.push(`Cannot save ${path.join(request.skillsDir, LINK_STATE_FILE)}: ${errorMessage(error)}`);
    }
    return result;
}

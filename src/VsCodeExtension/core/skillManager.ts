import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { NETWORK_TIMEOUT_MS, parseLsRemote, type GitExec, type RemoteRefs } from './git.ts';
import { latestStable, maxSatisfying, newerStable, parseVersion } from './semver.ts';
import type { RemoteInfo, SkillSpec } from './types.ts';
import { isInside, isSafeName, validateGitUrl } from './validation.ts';

export interface ResolvedSkill {
    commit: string;
    /** Ref passed to `git fetch`, e.g. `refs/tags/v1.2.0`. */
    fetchRef: string;
    /** Human label: branch or tag name. */
    label: string;
    /** A newer stable version that the spec does not allow (pinned tag / range). */
    newerVersion?: string;
}

export class SkillDirtyError extends Error {
    constructor(name: string) {
        super(`"${name}" has local changes in mindSkills, so it was not updated. Use Reinstall to discard them.`);
        this.name = 'SkillDirtyError';
    }
}

function list(values: Iterable<string>, max = 6): string {
    const items = [...values];
    if (items.length === 0) {
        return 'none';
    }
    return items.length > max ? `${items.slice(0, max).join(', ')}, …` : items.join(', ');
}

/** Finds a tag tolerating a missing/extra `v` prefix (`1.2.0` ↔ `v1.2.0`). */
function findTag(refs: RemoteRefs, tag: string): string | undefined {
    if (refs.tags.has(tag)) {
        return tag;
    }
    const alternative = tag.startsWith('v') || tag.startsWith('V') ? tag.slice(1) : `v${tag}`;
    return parseVersion(tag) && refs.tags.has(alternative) ? alternative : undefined;
}

/** Pure resolution of a skill spec against the remote refs. Throws with a helpful message. */
export function resolveSpec(spec: SkillSpec, refs: RemoteRefs): ResolvedSkill {
    const tagNames = [...refs.tags.keys()];
    const fromTag = (tag: string): ResolvedSkill => ({
        commit: refs.tags.get(tag) as string,
        fetchRef: `refs/tags/${tag}`,
        label: tag,
    });
    const fromBranch = (branch: string): ResolvedSkill => ({
        commit: refs.branches.get(branch) as string,
        fetchRef: `refs/heads/${branch}`,
        label: branch,
    });

    switch (spec.kind) {
        case 'default': {
            if (!refs.head) {
                throw new Error('The repository is empty (no default branch found).');
            }
            return { commit: refs.head, fetchRef: 'HEAD', label: refs.defaultBranch ?? 'HEAD' };
        }
        case 'branch': {
            const branch = spec.value ?? '';
            if (!refs.branches.has(branch)) {
                throw new Error(`Branch "${branch}" not found. Available: ${list(refs.branches.keys())}.`);
            }
            return fromBranch(branch);
        }
        case 'tag': {
            const tag = findTag(refs, spec.value ?? '');
            if (!tag) {
                throw new Error(`Tag "${spec.value}" not found. Available: ${list(tagNames)}.`);
            }
            return { ...fromTag(tag), newerVersion: newerStable(tagNames, tag)[0] };
        }
        case 'version': {
            const range = spec.value ?? '*';
            const tag = maxSatisfying(tagNames, range);
            if (!tag) {
                const latest = latestStable(tagNames);
                throw new Error(`No tag matches "${range}"${latest ? ` (latest is ${latest})` : ' (no semver tags found)'}.`);
            }
            return { ...fromTag(tag), newerVersion: newerStable(tagNames, tag)[0] };
        }
        case 'ref': {
            const name = spec.value ?? '';
            const tag = findTag(refs, name);
            if (tag) {
                return { ...fromTag(tag), newerVersion: newerStable(tagNames, tag)[0] };
            }
            if (refs.branches.has(name)) {
                return fromBranch(name);
            }
            throw new Error(`"${name}" is neither a tag nor a branch of the repository.`);
        }
    }
}

export function remoteInfoFromRefs(refs: RemoteRefs): RemoteInfo {
    const tags = [...refs.tags.keys()];
    const versions = newerStable(tags, '0.0.0-0');
    const others = tags.filter((t) => !versions.includes(t)).sort();
    return {
        ok: true,
        defaultBranch: refs.defaultBranch,
        branches: [...refs.branches.keys()].sort((a, b) => (a === refs.defaultBranch ? -1 : b === refs.defaultBranch ? 1 : a.localeCompare(b))),
        tags: [...versions, ...others],
        latestVersion: versions[0],
    };
}

export function lsRemoteArgs(url: string): string[] {
    return ['ls-remote', '--symref', '--', url, 'HEAD', 'refs/heads/*', 'refs/tags/*'];
}

/** Lists branches and tags of any git URL without cloning it. Never throws. */
export async function inspectRemote(git: GitExec, url: string): Promise<RemoteInfo> {
    const urlError = validateGitUrl(url);
    if (urlError) {
        return { ok: false, branches: [], tags: [], error: urlError };
    }
    try {
        return remoteInfoFromRefs(parseLsRemote(await git(lsRemoteArgs(url.trim()), { timeoutMs: NETWORK_TIMEOUT_MS })));
    } catch (error) {
        return { ok: false, branches: [], tags: [], error: (error as Error).message };
    }
}

export type InstallOutcome = 'installed' | 'updated' | 'unchanged';

/** Downloads skills as shallow, detached clones inside the non-versioned mindSkills folder. */
export class SkillManager {
    readonly skillsDir: string;
    private readonly git: GitExec;

    constructor(git: GitExec, skillsDir: string) {
        this.git = git;
        this.skillsDir = skillsDir;
    }

    pathFor(name: string): string {
        const target = path.join(this.skillsDir, name);
        if (!isSafeName(name) || !isInside(this.skillsDir, target) || target === path.resolve(this.skillsDir)) {
            throw new Error(`"${name}" is not a valid skill name.`);
        }
        return target;
    }

    async lsRemote(url: string): Promise<RemoteRefs> {
        return parseLsRemote(await this.git(lsRemoteArgs(url), { timeoutMs: NETWORK_TIMEOUT_MS }));
    }

    async installedCommit(name: string): Promise<string | undefined> {
        const dir = this.pathFor(name);
        try {
            await fs.access(path.join(dir, '.git'));
            return (await this.git(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: dir })).trim() || undefined;
        } catch {
            return undefined;
        }
    }

    async isDirty(name: string): Promise<boolean> {
        const dir = this.pathFor(name);
        const out = await this.git(['status', '--porcelain', '--untracked-files=normal'], { cwd: dir });
        return out.trim().length > 0;
    }

    async install(name: string, spec: SkillSpec, resolved: ResolvedSkill): Promise<{ outcome: InstallOutcome; commit: string }> {
        const dir = this.pathFor(name);
        const gitDir = path.join(dir, '.git');
        let fresh = false;
        try {
            await fs.access(gitDir);
        } catch {
            fresh = true;
        }

        if (fresh) {
            try {
                const entries = await fs.readdir(dir);
                if (entries.length > 0) {
                    throw new Error(`mindSkills/${name} exists but is not a git checkout. Delete it to let MindPool install the skill.`);
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }
            }
            await fs.mkdir(dir, { recursive: true });
            await this.git(['init', '--quiet'], { cwd: dir });
            await this.git(['remote', 'add', 'origin', spec.repository], { cwd: dir });
        } else {
            const current = await this.installedCommit(name);
            if (current === resolved.commit) {
                return { outcome: 'unchanged', commit: current };
            }
            if (await this.isDirty(name)) {
                throw new SkillDirtyError(name);
            }
            const url = (await this.git(['remote', 'get-url', 'origin'], { cwd: dir }).catch(() => '')).trim();
            if (url !== spec.repository) {
                await this.git(url ? ['remote', 'set-url', 'origin', spec.repository] : ['remote', 'add', 'origin', spec.repository], { cwd: dir });
            }
        }

        try {
            await this.git(['fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', resolved.fetchRef], {
                cwd: dir,
                timeoutMs: NETWORK_TIMEOUT_MS,
            });
            await this.git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: dir });
        } catch (error) {
            if (fresh) {
                await fs.rm(dir, { recursive: true, force: true });
            }
            throw error;
        }
        const commit = (await this.installedCommit(name)) ?? resolved.commit;
        return { outcome: fresh ? 'installed' : 'updated', commit };
    }

    async remove(name: string): Promise<void> {
        await fs.rm(this.pathFor(name), { recursive: true, force: true });
    }

    /** Folder names currently present in mindSkills. */
    async listInstalled(): Promise<string[]> {
        try {
            const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
            return entries.filter((e) => e.isDirectory() && isSafeName(e.name)).map((e) => e.name).sort();
        } catch {
            return [];
        }
    }
}

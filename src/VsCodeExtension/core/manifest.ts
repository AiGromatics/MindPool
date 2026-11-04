import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isValidRange, looksLikeRange } from './semver.ts';
import type { ManifestEntry, SkillRefKind, SkillSpec } from './types.ts';
import { isSafeName, validateGitUrl, validateRefName } from './validation.ts';

/**
 * `skill.json` lives at the root of the team repository and declares the skills to download,
 * the same way `dependencies` works in a package.json:
 *
 * ```json
 * {
 *   "name": "acme-team-skills",
 *   "skills": {
 *     "code-review": "https://github.com/acme/skill-code-review.git",
 *     "pdf-tools":   "https://github.com/acme/pdf-tools.git#^2.1.0",
 *     "writer":      { "repository": "git@github.com:acme/writer.git", "branch": "develop" },
 *     "planner":     { "repository": "https://github.com/acme/planner.git", "tag": "v1.4.0" }
 *   }
 * }
 * ```
 */
export const MANIFEST_FILE = 'skill.json';

/** Non-versioned folder (inside the team repository) where skills are downloaded. */
export const SKILLS_DIR = 'mindSkills';

export interface ParsedManifest {
    name?: string;
    description?: string;
    entries: ManifestEntry[];
}

export interface ManifestParseResult {
    manifest?: ParsedManifest;
    error?: string;
}

function validateSelector(kind: SkillRefKind, value: string | undefined): string | undefined {
    switch (kind) {
        case 'default':
            return undefined;
        case 'version':
            return value && isValidRange(value) ? undefined : `"${value ?? ''}" is not a valid semver range.`;
        case 'branch':
            return validateRefName(value ?? '', 'Branch');
        case 'tag':
            return validateRefName(value ?? '', 'Tag');
        case 'ref':
            return validateRefName(value ?? '', 'Ref');
    }
}

/** Parses one `skills` entry: either `"url[#ref]"` or `{ repository, branch | tag | version }`. */
export function parseSkillSpec(value: unknown): { spec?: SkillSpec; error?: string } {
    let spec: SkillSpec;
    if (typeof value === 'string') {
        const hash = value.lastIndexOf('#');
        const repository = (hash >= 0 ? value.slice(0, hash) : value).trim();
        const ref = hash >= 0 ? value.slice(hash + 1).trim() : '';
        if (!ref) {
            spec = { repository, kind: 'default' };
        } else if (looksLikeRange(ref)) {
            spec = { repository, kind: 'version', value: ref };
        } else {
            spec = { repository, kind: 'ref', value: ref };
        }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        const repository = typeof obj['repository'] === 'string' ? obj['repository'].trim() : '';
        const selectors = (['tag', 'version', 'branch'] as const).filter((key) => obj[key] !== undefined);
        if (selectors.length > 1) {
            return { error: `use only one of "branch", "tag" or "version" (found ${selectors.join(', ')}).` };
        }
        const kind: SkillRefKind = selectors[0] ?? 'default';
        const selectorValue = selectors[0] ? obj[selectors[0]] : undefined;
        if (selectorValue !== undefined && typeof selectorValue !== 'string') {
            return { error: `"${kind}" must be a string.` };
        }
        spec = { repository, kind, value: (selectorValue as string | undefined)?.trim() };
        if (kind === 'default') {
            delete spec.value;
        }
    } else {
        return { error: 'expected a git URL string or an object with a "repository" field.' };
    }
    const error = validateGitUrl(spec.repository) ?? validateSelector(spec.kind, spec.value);
    return error ? { error } : { spec };
}

export function parseManifest(text: string): ManifestParseResult {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        return { error: `skill.json is not valid JSON: ${(error as Error).message}` };
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { error: 'skill.json must contain a JSON object.' };
    }
    const obj = raw as Record<string, unknown>;
    const skills = obj['skills'] ?? {};
    if (typeof skills !== 'object' || skills === null || Array.isArray(skills)) {
        return { error: '"skills" must be an object mapping skill names to git sources.' };
    }
    const entries: ManifestEntry[] = [];
    for (const [name, value] of Object.entries(skills as Record<string, unknown>)) {
        if (!isSafeName(name)) {
            entries.push({ name, error: `"${name}" is not a valid skill name (use letters, digits, ".", "_", "-").` });
            continue;
        }
        const { spec, error } = parseSkillSpec(value);
        entries.push(spec ? { name, spec } : { name, error: error ?? 'invalid skill source.' });
    }
    return {
        manifest: {
            name: typeof obj['name'] === 'string' ? obj['name'] : undefined,
            description: typeof obj['description'] === 'string' ? obj['description'] : undefined,
            entries,
        },
    };
}

export interface ReadManifestResult extends ManifestParseResult {
    exists: boolean;
    path: string;
    /** Raw file content, used to detect real changes. */
    text?: string;
}

export async function readManifest(repoDir: string): Promise<ReadManifestResult> {
    const file = path.join(repoDir, MANIFEST_FILE);
    let text: string;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { exists: false, path: file };
        }
        return { exists: true, path: file, error: `Cannot read skill.json: ${(error as Error).message}` };
    }
    return { exists: true, path: file, text, ...parseManifest(text) };
}

/**
 * JSON value written to skill.json for a spec. The object form is explicit and easy to diff;
 * an ambiguous `ref` (tag-or-branch) keeps the `url#ref` shorthand so its meaning is preserved.
 */
export function specToJson(spec: SkillSpec): string | Record<string, string> {
    if (spec.kind === 'ref') {
        return `${spec.repository}#${spec.value ?? ''}`;
    }
    const out: Record<string, string> = { repository: spec.repository };
    if (spec.kind !== 'default' && spec.value) {
        out[spec.kind] = spec.value;
    }
    return out;
}

export { describeSpec } from './format.ts';

async function readRawManifest(file: string): Promise<Record<string, unknown>> {
    let text: string;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { skills: {} };
        }
        throw error;
    }
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('skill.json must contain a JSON object.');
    }
    return raw as Record<string, unknown>;
}

async function writeRawManifest(file: string, data: Record<string, unknown>): Promise<void> {
    await fs.writeFile(file, `${JSON.stringify(data, null, 4)}\n`, 'utf8');
}

function skillsObject(data: Record<string, unknown>): Record<string, unknown> {
    const skills = data['skills'];
    if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
        return skills as Record<string, unknown>;
    }
    const fresh: Record<string, unknown> = {};
    data['skills'] = fresh;
    return fresh;
}

export async function createManifest(repoDir: string, name: string): Promise<string> {
    const file = path.join(repoDir, MANIFEST_FILE);
    try {
        await fs.access(file);
        return file;
    } catch {
        // create below
    }
    await writeRawManifest(file, {
        name,
        description: 'AI skills shared by the team. Managed with MindPool.',
        skills: {},
    });
    return file;
}

/** Adds or replaces a skill, keeping every other key (and the key order) intact. */
export async function upsertSkill(repoDir: string, name: string, spec: SkillSpec): Promise<void> {
    if (!isSafeName(name)) {
        throw new Error(`"${name}" is not a valid skill name (use letters, digits, ".", "_", "-").`);
    }
    const checked = parseSkillSpec(specToJson(spec));
    if (!checked.spec) {
        throw new Error(checked.error);
    }
    const file = path.join(repoDir, MANIFEST_FILE);
    const data = await readRawManifest(file);
    skillsObject(data)[name] = specToJson(checked.spec);
    await writeRawManifest(file, data);
}

export async function removeSkill(repoDir: string, name: string): Promise<boolean> {
    const file = path.join(repoDir, MANIFEST_FILE);
    const data = await readRawManifest(file);
    const skills = skillsObject(data);
    if (!(name in skills)) {
        return false;
    }
    delete skills[name];
    await writeRawManifest(file, data);
    return true;
}

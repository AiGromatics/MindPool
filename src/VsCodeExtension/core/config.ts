import type { PoolConfig, PoolSettings } from './types.ts';
import { isSafeName, repoNameFromUrl, validateGitUrl, validateRefName } from './validation.ts';

/** The repository settings, each stored in the VS Code settings as `mindpool.<key>`. */
export const SETTING_KEYS = ['repository', 'branch', 'tag', 'directory', 'linkSkillsTo'] as const;

/**
 * Where the repository settings live: the VS Code settings in the extension, memory in tests.
 * Values are typed loosely on purpose: users can write anything in settings.json, so whatever
 * `read()` returns goes through {@link validateConfig}.
 */
export interface SettingsStore {
    /** Current values. Called on every sync, so edits are picked up without a restart. */
    read(): Partial<PoolSettings>;
    /** Stores values saved from the dashboard. */
    write(values: PoolSettings): Promise<void>;
}

export interface ConfigParseResult {
    config?: PoolConfig;
    /** Whatever could be read, to pre-fill the edit form. */
    draft: Partial<PoolSettings>;
    error?: string;
}

function asOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** True for a setting that was left empty. */
export function isBlank(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/**
 * `linkSkillsTo` is a list of folders. A single string is accepted too, for hand-written
 * settings.json files. Empty entries and duplicates are dropped.
 */
export function parseLinkList(value: unknown): { values: string[]; error?: string } {
    if (value === undefined || value === null) {
        return { values: [] };
    }
    const items = typeof value === 'string' ? [value] : Array.isArray(value) ? (value as unknown[]) : undefined;
    if (!items || !items.every((item) => typeof item === 'string')) {
        return { values: [], error: '"mindpool.linkSkillsTo" must be a list of folder paths.' };
    }
    return { values: [...new Set((items as string[]).map((item) => item.trim()).filter(Boolean))] };
}

export function validateConfig(raw: unknown): ConfigParseResult {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { draft: {}, error: 'The repository settings must be an object.' };
    }
    const obj = raw as Record<string, unknown>;
    const draft: Partial<PoolSettings> = {
        repository: asOptionalString(obj['repository']),
        branch: asOptionalString(obj['branch']),
        tag: asOptionalString(obj['tag']),
        directory: asOptionalString(obj['directory']),
    };
    const links = parseLinkList(obj['linkSkillsTo']);
    if (links.values.length > 0) {
        draft.linkSkillsTo = links.values;
    }
    const errors: string[] = [];
    if (links.error) {
        errors.push(links.error);
    }
    for (const key of ['repository', 'branch', 'tag', 'directory'] as const) {
        if (obj[key] !== undefined && obj[key] !== null && typeof obj[key] !== 'string') {
            errors.push(`"mindpool.${key}" must be a string.`);
        }
    }
    const urlError = validateGitUrl(draft.repository ?? '');
    if (urlError) {
        errors.push(urlError);
    }
    const branchError = validateRefName(draft.branch ?? '', 'Branch');
    if (branchError) {
        errors.push(branchError);
    }
    if (draft.tag) {
        const tagError = validateRefName(draft.tag, 'Tag');
        if (tagError) {
            errors.push(tagError);
        }
    }
    if (draft.directory && (!isSafeName(draft.directory) || draft.directory === 'mindSkills')) {
        errors.push(`"mindpool.directory" must be a plain folder name (letters, digits, ".", "_", "-"), got "${draft.directory}".`);
    }
    if (errors.length > 0) {
        return { draft, error: errors.join(' ') };
    }
    const repository = draft.repository as string;
    return {
        draft,
        config: {
            repository,
            branch: draft.branch as string,
            tag: draft.tag,
            directory: draft.directory ?? repoNameFromUrl(repository),
            linkSkillsTo: links.values,
        },
    };
}

/**
 * The values to store for a dashboard save: trimmed, with empty optional values left out and
 * the clone folder left as typed (not derived). Throws when they are invalid.
 */
export function cleanSettings(values: PoolSettings): PoolSettings {
    const result = validateConfig(values);
    if (!result.config) {
        throw new Error(result.error ?? 'Invalid repository settings.');
    }
    return {
        repository: result.config.repository,
        branch: result.config.branch,
        tag: result.config.tag,
        directory: result.draft.directory,
        linkSkillsTo: result.config.linkSkillsTo,
    };
}

/** Canonical form: whitespace, `""` versus unset, and duplicate folders do not count as changes. */
function canonical(values: Partial<PoolSettings>): string {
    const text = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : (value ?? ''));
    const links = parseLinkList(values.linkSkillsTo);
    return JSON.stringify([text(values.repository), text(values.branch), text(values.tag), text(values.directory), links.error ? values.linkSkillsTo : links.values]);
}

/** True when both sets of values describe the same setup, so no new sync is needed. */
export function sameSettings(a: Partial<PoolSettings>, b: Partial<PoolSettings>): boolean {
    return canonical(a) === canonical(b);
}

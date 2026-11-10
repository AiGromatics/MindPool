import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { PoolConfig, PoolConfigFile } from './types.ts';
import { isSafeName, repoNameFromUrl, validateGitUrl, validateRefName } from './validation.ts';

export const CONFIG_FILE = 'config.json';

export interface ConfigParseResult {
    config?: PoolConfig;
    /** Whatever could be read, to pre-fill the edit form. */
    draft: Partial<PoolConfigFile>;
    error?: string;
}

function asOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** `linkSkillsTo` accepts one folder or a list of folders. Empty entries and duplicates are dropped. */
export function parseLinkList(value: unknown): { values: string[]; error?: string } {
    if (value === undefined || value === null) {
        return { values: [] };
    }
    const items = typeof value === 'string' ? [value] : Array.isArray(value) ? (value as unknown[]) : undefined;
    if (!items || !items.every((item) => typeof item === 'string')) {
        return { values: [], error: '"linkSkillsTo" must be a folder path or a list of folder paths.' };
    }
    return { values: [...new Set((items as string[]).map((item) => item.trim()).filter(Boolean))] };
}

export function validateConfig(raw: unknown): ConfigParseResult {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { draft: {}, error: 'config.json must contain a JSON object.' };
    }
    const obj = raw as Record<string, unknown>;
    const draft: Partial<PoolConfigFile> = {
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
        if (obj[key] !== undefined && typeof obj[key] !== 'string') {
            errors.push(`"${key}" must be a string.`);
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
        errors.push(`"directory" must be a plain folder name (letters, digits, ".", "_", "-"), got "${draft.directory}".`);
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

export function parseConfig(text: string): ConfigParseResult {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        return { draft: {}, error: `config.json is not valid JSON: ${(error as Error).message}` };
    }
    return validateConfig(raw);
}

export interface ReadConfigResult extends ConfigParseResult {
    exists: boolean;
    path: string;
    /** Raw file content, used to detect real changes. */
    text?: string;
}

export async function readConfig(folder: string): Promise<ReadConfigResult> {
    const file = path.join(folder, CONFIG_FILE);
    let text: string;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { exists: false, path: file, draft: {} };
        }
        return { exists: true, path: file, draft: {}, error: `Cannot read config.json: ${(error as Error).message}` };
    }
    return { exists: true, path: file, text, ...parseConfig(text) };
}

/**
 * Writes config.json. Unknown keys already present in the file are preserved so teams can
 * keep their own annotations next to the MindPool settings.
 */
export async function writeConfig(folder: string, values: PoolConfigFile): Promise<PoolConfig> {
    const clean: PoolConfigFile = {
        repository: values.repository.trim(),
        branch: values.branch.trim(),
        tag: values.tag?.trim() || undefined,
        directory: values.directory?.trim() || undefined,
        linkSkillsTo: values.linkSkillsTo,
    };
    const result = validateConfig(clean);
    if (!result.config) {
        throw new Error(result.error ?? 'Invalid configuration.');
    }
    const file = path.join(folder, CONFIG_FILE);
    let existing: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            existing = parsed as Record<string, unknown>;
        }
    } catch {
        // missing or broken file: start fresh
    }
    const next: Record<string, unknown> = { ...existing, repository: clean.repository, branch: clean.branch };
    for (const key of ['tag', 'directory'] as const) {
        if (clean[key]) {
            next[key] = clean[key];
        } else {
            delete next[key];
        }
    }
    // A single folder is written as a plain string, the common case stays easy to read.
    const links = result.config.linkSkillsTo;
    if (links.length === 0) {
        delete next['linkSkillsTo'];
    } else {
        next['linkSkillsTo'] = links.length === 1 ? links[0] : links;
    }
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(next, null, 4)}\n`, 'utf8');
    return result.config;
}

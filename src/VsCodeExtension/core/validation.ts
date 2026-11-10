import * as path from 'node:path';

/**
 * Validation helpers. Values coming from config.json / skill.json are shared through a
 * team repository, so they are treated as untrusted: names must never escape their parent
 * folder and nothing may be interpreted by git as a command-line option.
 */

const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** A single folder name: no separators, no `..`, no leading dot/dash. */
export function isSafeName(name: string): boolean {
    return SAFE_NAME_RE.test(name) && !name.endsWith('.lock');
}

export function validateGitUrl(url: string): string | undefined {
    const value = url.trim();
    if (!value) {
        return 'Repository URL is required.';
    }
    if (value.startsWith('-')) {
        return 'Repository URL must not start with "-".';
    }
    if (/[\s\u0000-\u001f\u007f]/.test(value)) {
        return 'Repository URL must not contain spaces or control characters.';
    }
    if (/^(ext|fd)::/i.test(value)) {
        return 'The ext:: and fd:: git transports are not allowed.';
    }
    return undefined;
}

/** Approximation of `git check-ref-format` for branch and tag names. */
export function validateRefName(ref: string, label = 'Ref'): string | undefined {
    if (!ref) {
        return `${label} is required.`;
    }
    if (
        ref.startsWith('-') ||
        ref.startsWith('/') ||
        ref.endsWith('/') ||
        ref.endsWith('.') ||
        ref.endsWith('.lock') ||
        ref.includes('..') ||
        ref.includes('@{') ||
        ref.includes('//') ||
        ref === '@' ||
        /[\s\u0000-\u001f\u007f~^:?*[\\]/.test(ref)
    ) {
        return `${label} "${ref}" is not a valid git ref name.`;
    }
    return undefined;
}

/** Derives a folder name from a git URL: `git@host:team/skills.git` → `skills`. */
export function repoNameFromUrl(url: string): string {
    const trimmed = url.trim().replace(/[/\\]+$/, '').replace(/\.git$/i, '');
    const last = trimmed.split(/[/\\:]/).pop() ?? '';
    const cleaned = last.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '');
    return isSafeName(cleaned) ? cleaned : 'skills-repo';
}

export interface ExpandContext {
    home: string;
    workspaceFolder?: string;
    /** Folder that relative paths resolve against. Defaults to the workspace folder, then home. */
    base?: string;
}

/**
 * Expands `~`, `${userHome}` and `${workspaceFolder}` in a configured folder path.
 * Relative paths resolve against `base`, the workspace folder or the home folder.
 */
export function expandFolderPath(raw: string, ctx: ExpandContext): { path?: string; error?: string } {
    let value = raw.trim();
    if (!value) {
        return {};
    }
    if (value.includes('${workspaceFolder}')) {
        if (!ctx.workspaceFolder) {
            return { error: '"${workspaceFolder}" is used but no folder is open in this window.' };
        }
        value = value.split('${workspaceFolder}').join(ctx.workspaceFolder);
    }
    value = value.split('${userHome}').join(ctx.home);
    if (value === '~') {
        value = ctx.home;
    } else if (value.startsWith('~/') || value.startsWith('~\\')) {
        value = path.join(ctx.home, value.slice(2));
    }
    if (!path.isAbsolute(value)) {
        value = path.resolve(ctx.base ?? ctx.workspaceFolder ?? ctx.home, value);
    }
    return { path: path.normalize(value) };
}

/** True when `child` is `parent` itself or lives inside it. */
export function isInside(parent: string, child: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

import { execFile } from 'node:child_process';
import type { FileChange, FileChangeKind } from './types.ts';

export interface GitRunOptions {
    cwd?: string;
    /** Defaults to 60s; network operations pass a longer timeout. */
    timeoutMs?: number;
}

/** Runs `git <args>` and resolves with stdout. Rejects with {@link GitError}. */
export type GitExec = (args: readonly string[], options?: GitRunOptions) => Promise<string>;

export const NETWORK_TIMEOUT_MS = 180_000;

export class GitError extends Error {
    readonly args: readonly string[];
    readonly exitCode: number | string | null;
    readonly stderr: string;
    readonly stdout: string;

    constructor(message: string, args: readonly string[], exitCode: number | string | null, stdout: string, stderr: string) {
        super(message);
        this.name = 'GitError';
        this.args = args;
        this.exitCode = exitCode;
        this.stdout = stdout;
        this.stderr = stderr;
    }
}

/** Turns raw git stderr into a short, human friendly sentence. */
export function summarizeGitError(stderr: string, fallback: string): string {
    const lines = stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('hint:') && !/^(Cloning into|remote: (Counting|Compressing|Enumerating|Total))/.test(line))
        .map((line) => line.replace(/^(fatal|error):\s*/i, ''));
    const text = lines.slice(0, 3).join(' — ');
    return text || fallback;
}

export interface CreateGitOptions {
    gitPath?: string;
    /** Called once per git invocation, e.g. to feed an output channel. */
    onCommand?: (line: string) => void;
}

export function createGit(options: CreateGitOptions = {}): GitExec {
    const gitPath = options.gitPath?.trim() || 'git';
    return (args, runOptions = {}) =>
        new Promise<string>((resolve, reject) => {
            const started = Date.now();
            const timeout = runOptions.timeoutMs ?? 60_000;
            execFile(
                gitPath,
                [...args],
                {
                    cwd: runOptions.cwd,
                    timeout,
                    maxBuffer: 64 * 1024 * 1024,
                    windowsHide: true,
                    // Never block a background sync on an interactive credential prompt.
                    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
                },
                (error, stdout, stderr) => {
                    const elapsed = Date.now() - started;
                    options.onCommand?.(`git ${args.join(' ')}  [${error ? 'failed' : 'ok'} ${elapsed}ms]`);
                    if (!error) {
                        resolve(stdout);
                        return;
                    }
                    const err = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string | null };
                    let message: string;
                    if (err.code === 'ENOENT') {
                        message = `Git executable not found ("${gitPath}"). Install Git or set "mindpool.gitPath".`;
                    } else if (err.killed) {
                        message = `git ${args[0] ?? ''} timed out after ${Math.round(timeout / 1000)}s`;
                    } else {
                        message = summarizeGitError(stderr, err.message);
                    }
                    reject(new GitError(message, args, err.code ?? null, stdout, stderr));
                },
            );
        });
}

export interface RemoteRefs {
    /** Commit of the remote HEAD. */
    head?: string;
    /** Branch HEAD points to, e.g. `main`. */
    defaultBranch?: string;
    branches: Map<string, string>;
    /** Tag name → commit (annotated tags are peeled to their commit). */
    tags: Map<string, string>;
}

/** Parses `git ls-remote --symref <url> HEAD refs/heads/* refs/tags/*`. */
export function parseLsRemote(output: string): RemoteRefs {
    const refs: RemoteRefs = { branches: new Map(), tags: new Map() };
    const peeled = new Map<string, string>();
    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        const symref = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/.exec(line);
        if (symref) {
            refs.defaultBranch = symref[1];
            continue;
        }
        const match = /^([0-9a-f]{40,64})\s+(\S+)$/.exec(line);
        if (!match) {
            continue;
        }
        const sha = match[1] as string;
        const ref = match[2] as string;
        if (ref === 'HEAD') {
            refs.head = sha;
        } else if (ref.startsWith('refs/heads/')) {
            refs.branches.set(ref.slice('refs/heads/'.length), sha);
        } else if (ref.startsWith('refs/tags/')) {
            const name = ref.slice('refs/tags/'.length);
            if (name.endsWith('^{}')) {
                peeled.set(name.slice(0, -3), sha);
            } else {
                refs.tags.set(name, sha);
            }
        }
    }
    for (const [name, sha] of peeled) {
        refs.tags.set(name, sha);
    }
    if (!refs.head && refs.defaultBranch) {
        refs.head = refs.branches.get(refs.defaultBranch);
    }
    return refs;
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function classify(code: string): FileChangeKind {
    const x = code[0];
    const y = code[1];
    if (code === '??') {
        return 'untracked';
    }
    if (CONFLICT_CODES.has(code)) {
        return 'conflicted';
    }
    if (x === 'R' || y === 'R') {
        return 'renamed';
    }
    if (x === 'C' || y === 'C') {
        return 'copied';
    }
    if (x === 'A') {
        return 'added';
    }
    if (x === 'D' || y === 'D') {
        return 'deleted';
    }
    if (x === 'T' || y === 'T') {
        return 'typechange';
    }
    return 'modified';
}

/** Parses `git status --porcelain=v1 -z`. */
export function parseStatusZ(output: string): FileChange[] {
    const parts = output.split('\0');
    const changes: FileChange[] = [];
    for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        if (!entry || entry.length < 4) {
            continue;
        }
        const code = entry.slice(0, 2);
        if (code === '!!') {
            continue;
        }
        const change: FileChange = {
            path: entry.slice(3),
            kind: classify(code),
            staged: code[0] !== ' ' && code[0] !== '?',
            code,
        };
        if (code[0] === 'R' || code[0] === 'C' || code[1] === 'R' || code[1] === 'C') {
            change.origPath = parts[++i];
        }
        changes.push(change);
    }
    return changes;
}

/** `git rev-list --left-right --count A...B` → [left, right]. */
export function parseLeftRight(output: string): { ahead: number; behind: number } {
    const [left, right] = output.trim().split(/\s+/);
    return { ahead: Number(left) || 0, behind: Number(right) || 0 };
}

export { shortSha } from './format.ts';

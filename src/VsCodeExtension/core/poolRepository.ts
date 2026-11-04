import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { GitError, NETWORK_TIMEOUT_MS, parseLeftRight, parseStatusZ, type GitExec } from './git.ts';
import { SKILLS_DIR } from './manifest.ts';
import { newerStable } from './semver.ts';
import type { FileChange, PoolConfig, RepoStatus } from './types.ts';

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

export type FastForwardResult =
    | { kind: 'upToDate' }
    | { kind: 'fastForwarded'; commits: number }
    | { kind: 'diverged'; ahead: number; behind: number }
    | { kind: 'blocked'; reason: string };

/** The team repository cloned next to config.json. */
export class PoolRepository {
    readonly dir: string;
    private readonly git: GitExec;

    constructor(git: GitExec, dir: string) {
        this.git = git;
        this.dir = dir;
    }

    private run(args: readonly string[], network = false): Promise<string> {
        return this.git(args, { cwd: this.dir, timeoutMs: network ? NETWORK_TIMEOUT_MS : undefined });
    }

    async isCloned(): Promise<boolean> {
        return pathExists(path.join(this.dir, '.git'));
    }

    async clone(config: PoolConfig): Promise<void> {
        if (await pathExists(this.dir)) {
            const entries = await fs.readdir(this.dir);
            if (entries.length > 0) {
                throw new Error(`"${this.dir}" already exists and is not a Git repository. Remove it or pick another "directory" in config.json.`);
            }
        }
        await fs.mkdir(path.dirname(this.dir), { recursive: true });
        await this.git(['clone', '--origin', 'origin', '--branch', config.branch, '--', config.repository, this.dir], {
            cwd: path.dirname(this.dir),
            timeoutMs: NETWORK_TIMEOUT_MS,
        });
        if (config.tag) {
            await this.checkoutTag(config.tag);
        }
    }

    async remoteUrl(): Promise<string | undefined> {
        try {
            return (await this.run(['remote', 'get-url', 'origin'])).trim();
        } catch {
            return undefined;
        }
    }

    /** Points `origin` at the configured URL (the team may move the repository). */
    async ensureRemote(url: string): Promise<boolean> {
        const current = await this.remoteUrl();
        if (current === url) {
            return false;
        }
        await this.run(current === undefined ? ['remote', 'add', 'origin', url] : ['remote', 'set-url', 'origin', url]);
        return true;
    }

    async fetch(): Promise<void> {
        await this.run(['fetch', '--prune', '--tags', '--force', 'origin'], true);
    }

    async currentBranch(): Promise<string | undefined> {
        try {
            return (await this.run(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || undefined;
        } catch {
            return undefined;
        }
    }

    async head(): Promise<string | undefined> {
        try {
            return (await this.run(['rev-parse', '--verify', '--quiet', 'HEAD'])).trim() || undefined;
        } catch {
            return undefined;
        }
    }

    async hasRemoteBranch(branch: string): Promise<boolean> {
        try {
            await this.run(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
            return true;
        } catch {
            return false;
        }
    }

    async aheadBehind(branch: string): Promise<{ ahead: number; behind: number }> {
        if (!(await this.hasRemoteBranch(branch)) || !(await this.head())) {
            return { ahead: 0, behind: 0 };
        }
        return parseLeftRight(await this.run(['rev-list', '--left-right', '--count', `HEAD...refs/remotes/origin/${branch}`]));
    }

    async changes(): Promise<FileChange[]> {
        return parseStatusZ(await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    }

    async operationInProgress(): Promise<RepoStatus['operation']> {
        const gitDir = path.join(this.dir, '.git');
        if ((await pathExists(path.join(gitDir, 'rebase-merge'))) || (await pathExists(path.join(gitDir, 'rebase-apply')))) {
            return 'rebase';
        }
        if (await pathExists(path.join(gitDir, 'MERGE_HEAD'))) {
            return 'merge';
        }
        if (await pathExists(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
            return 'cherry-pick';
        }
        return undefined;
    }

    /** Switches to the configured branch when config.json changed it. */
    async ensureBranch(branch: string): Promise<boolean> {
        if ((await this.currentBranch()) === branch) {
            return false;
        }
        await this.run(['switch', branch]);
        return true;
    }

    async fastForward(branch: string): Promise<FastForwardResult> {
        const { ahead, behind } = await this.aheadBehind(branch);
        if (behind === 0) {
            return { kind: 'upToDate' };
        }
        if (ahead > 0) {
            return { kind: 'diverged', ahead, behind };
        }
        if (await this.operationInProgress()) {
            return { kind: 'blocked', reason: 'a merge or rebase is in progress' };
        }
        try {
            await this.run(['merge', '--ff-only', `refs/remotes/origin/${branch}`]);
            return { kind: 'fastForwarded', commits: behind };
        } catch (error) {
            return { kind: 'blocked', reason: (error as Error).message };
        }
    }

    /** Fetches and rebases local commits on top of the remote branch. Never leaves a half-done rebase. */
    async pull(branch: string): Promise<void> {
        try {
            await this.run(['pull', '--rebase', '--autostash', 'origin', branch], true);
        } catch (error) {
            if ((await this.operationInProgress()) === 'rebase') {
                await this.run(['rebase', '--abort']).catch(() => undefined);
                throw new Error('Pull stopped because of conflicts, so it was cancelled and your work is untouched. Open the repository in a new window to resolve the conflicts.');
            }
            throw error;
        }
    }

    /** Commits the given paths (or everything when `files` is empty). Returns the new commit. */
    async commit(message: string, files: readonly string[] = []): Promise<string> {
        const text = message.trim();
        if (!text) {
            throw new Error('Commit message is empty.');
        }
        if (files.length > 0) {
            // A staged rename/deletion leaves its old path in neither the worktree nor the
            // index; `git add` would fail on it, while `git commit -- <paths>` still commits it.
            const indexed = new Set((await this.run(['ls-files', '-z', '--', ...files])).split('\0').filter(Boolean));
            const toAdd: string[] = [];
            for (const file of files) {
                if (indexed.has(file) || (await pathExists(path.join(this.dir, file)))) {
                    toAdd.push(file);
                }
            }
            if (toAdd.length > 0) {
                await this.run(['add', '-A', '--', ...toAdd]);
            }
            await this.run(['commit', '--quiet', '-m', text, '--', ...files]);
        } else {
            await this.run(['add', '-A']);
            await this.run(['commit', '--quiet', '-m', text]);
        }
        return (await this.head()) ?? '';
    }

    async push(branch: string): Promise<void> {
        try {
            await this.run(['push', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], true);
        } catch (error) {
            if (error instanceof GitError && /rejected|non-fast-forward|fetch first/i.test(error.stderr)) {
                throw new Error('The remote has commits you do not have yet. Pull first, then push again.');
            }
            throw error;
        }
    }

    async tags(): Promise<string[]> {
        const out = await this.run(['tag', '--list']);
        return out.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
    }

    async tagCommit(tag: string): Promise<string | undefined> {
        try {
            return (await this.run(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`])).trim() || undefined;
        } catch {
            return undefined;
        }
    }

    async checkoutTag(tag: string): Promise<void> {
        if (!(await this.tagCommit(tag))) {
            throw new Error(`Release tag "${tag}" does not exist in the repository.`);
        }
        await this.run(['-c', 'advice.detachedHead=false', 'checkout', '--detach', `refs/tags/${tag}`]);
    }

    /** Keeps mindSkills out of git without touching any tracked file. */
    async ensureSkillsExcluded(): Promise<void> {
        const excludePath = path.resolve(this.dir, (await this.run(['rev-parse', '--git-path', 'info/exclude'])).trim());
        let content = '';
        try {
            content = await fs.readFile(excludePath, 'utf8');
        } catch {
            // the file is optional
        }
        const entry = `/${SKILLS_DIR}/`;
        if (content.split(/\r?\n/).some((line) => line.trim() === entry)) {
            return;
        }
        await fs.mkdir(path.dirname(excludePath), { recursive: true });
        const prefix = content && !content.endsWith('\n') ? '\n' : '';
        await fs.writeFile(excludePath, `${content}${prefix}# MindPool: downloaded skills are never committed\n${entry}\n`, 'utf8');
    }

    async status(config: PoolConfig, upstreamError?: string): Promise<RepoStatus> {
        if (!(await this.isCloned())) {
            return {
                path: this.dir,
                cloned: false,
                detached: false,
                readOnly: Boolean(config.tag),
                tag: config.tag,
                ahead: 0,
                behind: 0,
                changes: [],
                newerTags: [],
                upstreamError,
            };
        }
        const [branch, head, changes, operation, remoteUrl] = await Promise.all([
            this.currentBranch(),
            this.head(),
            this.changes(),
            this.operationInProgress(),
            this.remoteUrl(),
        ]);
        const counts = config.tag ? { ahead: 0, behind: 0 } : await this.aheadBehind(config.branch);
        const newerTags = config.tag ? newerStable(await this.tags(), config.tag) : [];
        return {
            path: this.dir,
            cloned: true,
            branch,
            head,
            detached: branch === undefined,
            tag: config.tag,
            readOnly: Boolean(config.tag),
            ahead: counts.ahead,
            behind: counts.behind,
            changes,
            newerTags,
            upstreamError,
            operation,
            remoteUrl,
        };
    }
}

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SettingsStore } from '../VsCodeExtension/core/config.ts';
import type { PoolSettings } from '../VsCodeExtension/core/types.ts';

/**
 * Test sandbox: real git repositories in a temp folder, with "remotes" being local bare
 * repositories. Git is isolated from the developer's global config (signing, hooks, …).
 */

const configDir = mkdtempSync(path.join(os.tmpdir(), 'mindpool-gitconfig-'));
const globalConfig = path.join(configDir, 'gitconfig');
writeFileSync(
    globalConfig,
    [
        '[user]',
        '\tname = MindPool Test',
        '\temail = test@mindpool.invalid',
        '[init]',
        '\tdefaultBranch = main',
        '[commit]',
        '\tgpgsign = false',
        '[tag]',
        '\tgpgsign = false',
        '[advice]',
        '\tdetachedHead = false',
        '[protocol "file"]',
        '\tallow = always',
        '',
    ].join('\n'),
);
process.env['GIT_CONFIG_GLOBAL'] = globalConfig;
process.env['GIT_CONFIG_NOSYSTEM'] = '1';
delete process.env['GIT_DIR'];
delete process.env['GIT_WORK_TREE'];

export function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export class Remote {
    readonly url: string;
    readonly work: string;

    constructor(url: string, work: string) {
        this.url = url;
        this.work = work;
    }

    write(files: Record<string, string | null>): void {
        for (const [file, content] of Object.entries(files)) {
            const target = path.join(this.work, file);
            if (content === null) {
                rmSync(target, { force: true });
            } else {
                mkdirSync(path.dirname(target), { recursive: true });
                writeFileSync(target, content);
            }
        }
    }

    /** Writes files, commits and pushes. Returns the new commit sha. */
    commit(files: Record<string, string | null>, message = 'update', branch = 'main'): string {
        this.write(files);
        git(this.work, 'add', '-A');
        git(this.work, 'commit', '--quiet', '--allow-empty', '-m', message);
        git(this.work, 'push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`);
        return this.head();
    }

    tag(name: string, annotated = true): void {
        if (annotated) {
            git(this.work, 'tag', '-a', name, '-m', `release ${name}`);
        } else {
            git(this.work, 'tag', name);
        }
        git(this.work, 'push', '--quiet', 'origin', `refs/tags/${name}`);
    }

    branch(name: string): void {
        git(this.work, 'push', '--quiet', 'origin', `HEAD:refs/heads/${name}`);
    }

    head(): string {
        return git(this.work, 'rev-parse', 'HEAD');
    }

    /** Commit at the tip of a branch on the bare remote. */
    remoteHead(branch = 'main'): string {
        return git(this.url, 'rev-parse', `refs/heads/${branch}`);
    }
}

export class Sandbox {
    readonly root: string;

    constructor(prefix = 'mindpool-test-') {
        this.root = mkdtempSync(path.join(os.tmpdir(), prefix));
    }

    path(...parts: string[]): string {
        return path.join(this.root, ...parts);
    }

    /** Creates a bare remote seeded with an initial commit. */
    remote(name: string, files: Record<string, string> = { 'README.md': `# ${name}\n` }): Remote {
        const url = this.path('remotes', `${name}.git`);
        mkdirSync(url, { recursive: true });
        git(url, 'init', '--quiet', '--bare', '--initial-branch=main');
        const work = this.path('work', name);
        mkdirSync(work, { recursive: true });
        git(work, 'init', '--quiet', '--initial-branch=main');
        git(work, 'remote', 'add', 'origin', url);
        const remote = new Remote(url, work);
        remote.commit(files, 'initial commit');
        git(url, 'symbolic-ref', 'HEAD', 'refs/heads/main');
        return remote;
    }

    write(file: string, content: string): string {
        const target = this.path(file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
        return target;
    }

    cleanup(): void {
        rmSync(this.root, { recursive: true, force: true });
    }
}

export function skillJson(skills: Record<string, unknown>, name = 'team-skills'): string {
    return `${JSON.stringify({ name, skills }, null, 4)}\n`;
}

/** Repository settings kept in memory, standing in for the VS Code settings. */
export class MemorySettings implements SettingsStore {
    values: Partial<PoolSettings>;
    /** Every value saved through `write`, oldest first. */
    readonly written: PoolSettings[] = [];

    constructor(values: Partial<PoolSettings> = {}) {
        this.values = values;
    }

    read(): Partial<PoolSettings> {
        return this.values;
    }

    async write(values: PoolSettings): Promise<void> {
        this.written.push(values);
        this.values = { ...values };
    }
}

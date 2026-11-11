import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { after, describe, test } from 'node:test';
import { createGit } from '../../VsCodeExtension/core/git.ts';
import { PoolRepository } from '../../VsCodeExtension/core/poolRepository.ts';
import type { PoolConfig } from '../../VsCodeExtension/core/types.ts';
import { git, Sandbox } from '../helpers.ts';

const sandbox = new Sandbox();
after(() => sandbox.cleanup());
const run = createGit();

function setup(name: string): { remote: ReturnType<Sandbox['remote']>; repo: PoolRepository; config: PoolConfig } {
    const remote = sandbox.remote(name, { 'skill.json': '{"skills":{}}\n', 'README.md': '# team\n' });
    const config: PoolConfig = { repository: remote.url, branch: 'main', directory: name, linkSkillsTo: [] };
    const repo = new PoolRepository(run, sandbox.path('pools', name, name));
    return { remote, repo, config };
}

describe('PoolRepository', () => {
    test('clones the configured branch into the pool folder', async () => {
        const { repo, config, remote } = setup('clone');
        assert.equal(await repo.isCloned(), false);
        await repo.clone(config);
        assert.equal(await repo.isCloned(), true);
        assert.equal(await repo.currentBranch(), 'main');
        assert.equal(await repo.head(), remote.head());
        const status = await repo.status(config);
        assert.equal(status.cloned, true);
        assert.equal(status.readOnly, false);
        assert.deepEqual(status.changes, []);
    });

    test('refuses to clone into a non-empty folder', async () => {
        const { repo, config } = setup('occupied');
        sandbox.write(path.relative(sandbox.root, path.join(repo.dir, 'stuff.txt')), 'x');
        await assert.rejects(repo.clone(config), /already exists and is not a Git repository/);
    });

    test('detects new upstream commits and fast-forwards', async () => {
        const { repo, config, remote } = setup('ff');
        await repo.clone(config);
        const sha = remote.commit({ 'skill.json': '{"skills":{"a":"x"}}\n' }, 'add skill a');
        await repo.fetch();
        assert.deepEqual(await repo.aheadBehind('main'), { ahead: 0, behind: 1 });
        const result = await repo.fastForward('main');
        assert.deepEqual(result, { kind: 'fastForwarded', commits: 1 });
        assert.equal(await repo.head(), sha);
        assert.deepEqual(await repo.fastForward('main'), { kind: 'upToDate' });
    });

    test('commits selected files and pushes them to the remote', async () => {
        const { repo, config, remote } = setup('commit');
        await repo.clone(config);
        writeFileSync(path.join(repo.dir, 'skill.json'), '{"skills":{"new":"https://x/new.git"}}\n');
        writeFileSync(path.join(repo.dir, 'notes.md'), 'not part of the commit\n');
        const changes = await repo.changes();
        assert.deepEqual(changes.map((c) => `${c.kind}:${c.path}`).sort(), ['modified:skill.json', 'untracked:notes.md']);

        const sha = await repo.commit('Add the new skill', ['skill.json']);
        assert.deepEqual((await repo.changes()).map((c) => c.path), ['notes.md'], 'unselected files stay uncommitted');
        assert.deepEqual(await repo.aheadBehind('main'), { ahead: 1, behind: 0 });

        await repo.push('main');
        assert.equal(remote.remoteHead(), sha);
        assert.deepEqual(await repo.aheadBehind('main'), { ahead: 0, behind: 0 });
        assert.equal(git(remote.url, 'log', '-1', '--format=%s'), 'Add the new skill');
    });

    test('commits renames and deletions', async () => {
        const { repo, config, remote } = setup('rename');
        await repo.clone(config);
        git(repo.dir, 'mv', 'README.md', 'GUIDE.md');
        const changes = await repo.changes();
        assert.equal(changes[0]?.kind, 'renamed');
        assert.equal(changes[0]?.origPath, 'README.md');
        await repo.commit('Rename readme', ['GUIDE.md', 'README.md']);
        await repo.push('main');
        assert.equal(git(remote.url, 'ls-tree', '--name-only', 'HEAD').split('\n').sort().join(','), 'GUIDE.md,skill.json');
    });

    test('push is rejected with a friendly message when the remote moved', async () => {
        const { repo, config, remote } = setup('reject');
        await repo.clone(config);
        remote.commit({ 'other.md': 'from a teammate\n' }, 'teammate change');
        writeFileSync(path.join(repo.dir, 'mine.md'), 'mine\n');
        await repo.commit('my change');
        await assert.rejects(repo.push('main'), /Pull first, then push again/);
    });

    test('pull rebases local commits on top of the remote', async () => {
        const { repo, config, remote } = setup('rebase');
        await repo.clone(config);
        const theirs = remote.commit({ 'theirs.md': 'theirs\n' }, 'theirs');
        writeFileSync(path.join(repo.dir, 'mine.md'), 'mine\n');
        await repo.commit('mine');
        await repo.fetch();
        const ff = await repo.fastForward('main');
        assert.equal(ff.kind, 'diverged');
        await repo.pull('main');
        assert.equal(git(repo.dir, 'rev-parse', 'HEAD~1'), theirs);
        assert.deepEqual(await repo.aheadBehind('main'), { ahead: 1, behind: 0 });
        await repo.push('main');
    });

    test('a conflicting pull is aborted and leaves the work untouched', async () => {
        const { repo, config, remote } = setup('conflict');
        await repo.clone(config);
        remote.commit({ 'README.md': '# theirs\n' }, 'theirs');
        writeFileSync(path.join(repo.dir, 'README.md'), '# mine\n');
        await repo.commit('mine');
        const before = await repo.head();
        await assert.rejects(repo.pull('main'), /conflicts/);
        assert.equal(await repo.operationInProgress(), undefined);
        assert.equal(await repo.head(), before);
        assert.equal(readFileSync(path.join(repo.dir, 'README.md'), 'utf8'), '# mine\n');
    });

    test('pins a release tag (read-only) and reports newer releases', async () => {
        const { repo, config, remote } = setup('tagged');
        remote.tag('v1.0.0');
        remote.commit({ 'skill.json': '{"skills":{"b":"y"}}\n' }, 'v1.1');
        remote.tag('v1.1.0');
        const pinned: PoolConfig = { ...config, tag: 'v1.0.0' };
        await repo.clone(pinned);
        const status = await repo.status(pinned);
        assert.equal(status.detached, true);
        assert.equal(status.readOnly, true);
        assert.equal(status.head, git(remote.url, 'rev-parse', 'v1.0.0^{commit}'));
        assert.deepEqual(status.newerTags, ['v1.1.0']);

        await repo.checkoutTag('v1.1.0');
        assert.equal(await repo.head(), git(remote.url, 'rev-parse', 'v1.1.0^{commit}'));
        await assert.rejects(repo.checkoutTag('v9.0.0'), /does not exist/);
    });

    test('switches branch when the setting changes, and updates the remote URL', async () => {
        const { repo, config, remote } = setup('switch');
        remote.branch('develop');
        await repo.clone(config);
        await repo.fetch();
        assert.equal(await repo.ensureBranch('develop'), true);
        assert.equal(await repo.currentBranch(), 'develop');
        assert.equal(await repo.ensureBranch('develop'), false);

        const mirror = sandbox.path('remotes', 'switch-mirror.git');
        git(sandbox.root, 'clone', '--quiet', '--bare', remote.url, mirror);
        assert.equal(await repo.ensureRemote(mirror), true);
        assert.equal(await repo.remoteUrl(), mirror);
        assert.equal(await repo.ensureRemote(mirror), false);
    });

    test('keeps mindSkills out of git via .git/info/exclude (idempotent)', async () => {
        const { repo, config } = setup('exclude');
        await repo.clone(config);
        await repo.ensureSkillsExcluded();
        await repo.ensureSkillsExcluded();
        const exclude = readFileSync(path.join(repo.dir, '.git', 'info', 'exclude'), 'utf8');
        assert.equal(exclude.split('\n').filter((l) => l === '/mindSkills/').length, 1);
        sandbox.write(path.relative(sandbox.root, path.join(repo.dir, 'mindSkills', 'x', 'SKILL.md')), 'hi');
        assert.deepEqual(await repo.changes(), []);
        assert.ok(existsSync(path.join(repo.dir, 'mindSkills', 'x', 'SKILL.md')));
        assert.equal(readFileSync(path.join(repo.dir, 'README.md'), 'utf8'), '# team\n', 'no tracked file was modified');
    });
});

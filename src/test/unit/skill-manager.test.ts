import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { after, describe, test } from 'node:test';
import { createGit } from '../../VsCodeExtension/core/git.ts';
import { inspectRemote, resolveSpec, SkillDirtyError, SkillManager } from '../../VsCodeExtension/core/skillManager.ts';
import type { SkillSpec } from '../../VsCodeExtension/core/types.ts';
import { git, Sandbox } from '../helpers.ts';

const sandbox = new Sandbox();
after(() => sandbox.cleanup());
const run = createGit();

async function installLatest(manager: SkillManager, name: string, spec: SkillSpec) {
    const resolved = resolveSpec(spec, await manager.lsRemote(spec.repository));
    return { resolved, ...(await manager.install(name, spec, resolved)) };
}

describe('SkillManager', () => {
    test('installs a skill as a shallow detached checkout and updates it on new commits', async () => {
        const remote = sandbox.remote('writer', { 'SKILL.md': '# Writer v1\n' });
        const manager = new SkillManager(run, sandbox.path('repo1', 'mindSkills'));
        const spec: SkillSpec = { repository: remote.url, kind: 'default' };

        const first = await installLatest(manager, 'writer', spec);
        assert.equal(first.outcome, 'installed');
        assert.equal(first.commit, remote.head());
        assert.equal(readFileSync(path.join(manager.pathFor('writer'), 'SKILL.md'), 'utf8'), '# Writer v1\n');
        assert.equal(git(manager.pathFor('writer'), 'rev-parse', '--is-shallow-repository'), 'true');

        const again = await installLatest(manager, 'writer', spec);
        assert.equal(again.outcome, 'unchanged');

        const next = remote.commit({ 'SKILL.md': '# Writer v2\n' }, 'v2');
        const updated = await installLatest(manager, 'writer', spec);
        assert.equal(updated.outcome, 'updated');
        assert.equal(updated.commit, next);
        assert.equal(readFileSync(path.join(manager.pathFor('writer'), 'SKILL.md'), 'utf8'), '# Writer v2\n');
        assert.deepEqual(await manager.listInstalled(), ['writer']);
    });

    test('tracks a branch', async () => {
        const remote = sandbox.remote('brancher', { 'SKILL.md': 'main\n' });
        remote.commit({ 'SKILL.md': 'develop\n' }, 'dev work', 'develop');
        const manager = new SkillManager(run, sandbox.path('repo2', 'mindSkills'));
        const result = await installLatest(manager, 'b', { repository: remote.url, kind: 'branch', value: 'develop' });
        assert.equal(result.resolved.label, 'develop');
        assert.equal(readFileSync(path.join(manager.pathFor('b'), 'SKILL.md'), 'utf8'), 'develop\n');
    });

    test('a pinned tag stays put but reports the newer release; a range auto-upgrades', async () => {
        const remote = sandbox.remote('versioned', { 'SKILL.md': 'v1.0.0\n' });
        remote.tag('v1.0.0');
        remote.commit({ 'SKILL.md': 'v1.1.0\n' }, '1.1');
        remote.tag('v1.1.0', false);
        const manager = new SkillManager(run, sandbox.path('repo3', 'mindSkills'));

        const pinned = await installLatest(manager, 'pinned', { repository: remote.url, kind: 'tag', value: 'v1.0.0' });
        assert.equal(readFileSync(path.join(manager.pathFor('pinned'), 'SKILL.md'), 'utf8'), 'v1.0.0\n');
        assert.equal(pinned.resolved.newerVersion, 'v1.1.0');

        const ranged = await installLatest(manager, 'ranged', { repository: remote.url, kind: 'version', value: '^1.0.0' });
        assert.equal(ranged.resolved.label, 'v1.1.0');

        remote.commit({ 'SKILL.md': 'v1.2.0\n' }, '1.2');
        remote.tag('v1.2.0');
        remote.commit({ 'SKILL.md': 'v2.0.0\n' }, '2.0');
        remote.tag('v2.0.0');
        const upgraded = await installLatest(manager, 'ranged', { repository: remote.url, kind: 'version', value: '^1.0.0' });
        assert.equal(upgraded.outcome, 'updated');
        assert.equal(upgraded.resolved.label, 'v1.2.0');
        assert.equal(upgraded.resolved.newerVersion, 'v2.0.0');
        assert.equal(readFileSync(path.join(manager.pathFor('ranged'), 'SKILL.md'), 'utf8'), 'v1.2.0\n');

        const stillPinned = await installLatest(manager, 'pinned', { repository: remote.url, kind: 'tag', value: 'v1.0.0' });
        assert.equal(stillPinned.outcome, 'unchanged');
    });

    test('never overwrites local modifications', async () => {
        const remote = sandbox.remote('precious', { 'SKILL.md': 'original\n' });
        const manager = new SkillManager(run, sandbox.path('repo4', 'mindSkills'));
        const spec: SkillSpec = { repository: remote.url, kind: 'default' };
        await installLatest(manager, 'precious', spec);
        writeFileSync(path.join(manager.pathFor('precious'), 'SKILL.md'), 'my local tweak\n');
        remote.commit({ 'SKILL.md': 'upstream change\n' }, 'upstream');
        await assert.rejects(installLatest(manager, 'precious', spec), (error: unknown) => error instanceof SkillDirtyError);
        assert.equal(readFileSync(path.join(manager.pathFor('precious'), 'SKILL.md'), 'utf8'), 'my local tweak\n');

        await manager.remove('precious');
        const reinstalled = await installLatest(manager, 'precious', spec);
        assert.equal(reinstalled.outcome, 'installed');
        assert.equal(readFileSync(path.join(manager.pathFor('precious'), 'SKILL.md'), 'utf8'), 'upstream change\n');
    });

    test('a failed fresh install leaves no half-created folder', async () => {
        const remote = sandbox.remote('flaky');
        const manager = new SkillManager(run, sandbox.path('repo5', 'mindSkills'));
        const resolved = { commit: 'f'.repeat(40), fetchRef: 'refs/heads/does-not-exist', label: 'x' };
        await assert.rejects(manager.install('flaky', { repository: remote.url, kind: 'default' }, resolved));
        assert.equal(existsSync(manager.pathFor('flaky')), false);
    });

    test('refuses to touch a non-git folder or unsafe names', async () => {
        const manager = new SkillManager(run, sandbox.path('repo6', 'mindSkills'));
        sandbox.write('repo6/mindSkills/handmade/notes.md', 'mine');
        const remote = sandbox.remote('handmade');
        const resolved = resolveSpec({ repository: remote.url, kind: 'default' }, await manager.lsRemote(remote.url));
        await assert.rejects(manager.install('handmade', { repository: remote.url, kind: 'default' }, resolved), /not a git checkout/);
        assert.throws(() => manager.pathFor('../../etc'), /not a valid skill name/);
        assert.throws(() => manager.pathFor('..'), /not a valid skill name/);
    });

    test('follows a repository move', async () => {
        const remote = sandbox.remote('moving', { 'SKILL.md': 'one\n' });
        const manager = new SkillManager(run, sandbox.path('repo7', 'mindSkills'));
        await installLatest(manager, 'moving', { repository: remote.url, kind: 'default' });
        const mirror = sandbox.path('remotes', 'moved.git');
        git(sandbox.root, 'clone', '--quiet', '--bare', remote.url, mirror);
        const work = sandbox.path('work', 'moved');
        git(sandbox.root, 'clone', '--quiet', mirror, work);
        writeFileSync(path.join(work, 'SKILL.md'), 'two\n');
        git(work, 'commit', '--quiet', '-am', 'moved');
        git(work, 'push', '--quiet', 'origin', 'HEAD:main');
        const result = await installLatest(manager, 'moving', { repository: mirror, kind: 'default' });
        assert.equal(result.outcome, 'updated');
        assert.equal(git(manager.pathFor('moving'), 'remote', 'get-url', 'origin'), mirror);
    });

    test('inspectRemote lists branches and tags, and never throws', async () => {
        const remote = sandbox.remote('inspect');
        remote.tag('v0.1.0');
        remote.branch('feature');
        const info = await inspectRemote(run, remote.url);
        assert.equal(info.ok, true);
        assert.equal(info.defaultBranch, 'main');
        assert.deepEqual(info.branches, ['main', 'feature']);
        assert.deepEqual(info.tags, ['v0.1.0']);
        const missing = await inspectRemote(run, sandbox.path('remotes', 'nope.git'));
        assert.equal(missing.ok, false);
        assert.ok(missing.error);
        const bad = await inspectRemote(run, '--upload-pack=evil');
        assert.equal(bad.ok, false);
        assert.match(bad.error ?? '', /must not start/);
    });
});

import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { after, describe, test } from 'node:test';
import { MindPoolEngine } from '../../VsCodeExtension/core/engine.ts';
import { createGit } from '../../VsCodeExtension/core/git.ts';
import type { PoolState } from '../../VsCodeExtension/core/types.ts';
import { git, Sandbox, skillJson, type Remote } from '../helpers.ts';

const sandbox = new Sandbox();
after(() => sandbox.cleanup());
let counter = 0;

interface World {
    pool: string;
    team: Remote;
    writer: Remote;
    reviewer: Remote;
    engine: MindPoolEngine;
    repoDir: string;
}

/** A team repository with skill.json pointing at two skill repositories, and a pool folder. */
function world(options: { autoUpdate?: boolean; tag?: string; skills?: (w: { writer: Remote; reviewer: Remote }) => Record<string, unknown> } = {}): World {
    const id = `w${++counter}`;
    const writer = sandbox.remote(`${id}-writer`, { 'SKILL.md': '# Writer\n' });
    writer.tag('v1.0.0');
    const reviewer = sandbox.remote(`${id}-reviewer`, { 'SKILL.md': '# Reviewer\n' });
    const skills = options.skills?.({ writer, reviewer }) ?? {
        writer: { repository: writer.url, version: '^1.0.0' },
        reviewer: reviewer.url,
    };
    const team = sandbox.remote(`${id}-team`, { 'skill.json': skillJson(skills), 'README.md': '# Team skills\n' });
    if (options.tag) {
        team.tag(options.tag);
    }
    const pool = sandbox.path('pools', id);
    sandbox.write(path.relative(sandbox.root, path.join(pool, 'config.json')), JSON.stringify({ repository: team.url, branch: 'main', tag: options.tag, directory: 'team' }));
    const engine = new MindPoolEngine({ poolFolder: pool, git: createGit(), autoUpdateSkills: options.autoUpdate ?? true });
    return { pool, team, writer, reviewer, engine, repoDir: path.join(pool, 'team') };
}

function skill(state: PoolState, name: string) {
    const found = state.skills.find((s) => s.name === name);
    assert.ok(found, `skill ${name} exists`);
    return found;
}

describe('MindPoolEngine: first sync', () => {
    test('clones the team repository and installs every skill into mindSkills', async () => {
        const w = world();
        const state = await w.engine.sync();
        assert.equal(state.phase, 'ready', state.lastError ?? 'sync failed');
        assert.equal(state.lastError, undefined);
        assert.equal(state.repo?.branch, 'main');
        assert.equal(state.manifest.exists, true);
        assert.equal(state.manifest.name, 'team-skills');
        assert.deepEqual(state.skills.map((s) => [s.name, s.health, s.changed]), [
            ['writer', 'ok', 'installed'],
            ['reviewer', 'ok', 'installed'],
        ]);
        assert.equal(skill(state, 'writer').resolvedLabel, 'v1.0.0');
        assert.equal(skill(state, 'reviewer').resolvedLabel, 'main');
        assert.equal(readFileSync(path.join(w.repoDir, 'mindSkills', 'writer', 'SKILL.md'), 'utf8'), '# Writer\n');
        assert.deepEqual(state.repo?.changes, [], 'mindSkills never shows up as a change');
        assert.ok(state.lastSync);
        assert.ok(state.log.some((l) => l.message.startsWith('Cloned')));
    });

    test('a second sync is a no-op', async () => {
        const w = world();
        await w.engine.sync();
        const logSize = w.engine.state.log.length;
        const state = await w.engine.sync();
        assert.ok(state.skills.every((s) => s.health === 'ok' && s.changed === undefined));
        assert.equal(state.log.length, logSize, 'nothing new to report');
    });
});

describe('MindPoolEngine: keeping up with the team', () => {
    test('pulls new team commits, installs new skills, upgrades in range and prunes removed ones', async () => {
        const w = world();
        await w.engine.sync();

        const extra = sandbox.remote(`extra-${counter}`, { 'SKILL.md': '# Extra\n' });
        w.writer.commit({ 'SKILL.md': '# Writer 1.1\n' }, '1.1');
        w.writer.tag('v1.1.0');
        w.writer.commit({ 'SKILL.md': '# Writer 2\n' }, '2.0');
        w.writer.tag('v2.0.0');
        w.team.commit({ 'skill.json': skillJson({ writer: { repository: w.writer.url, version: '^1.0.0' }, extra: extra.url }) }, 'swap reviewer for extra');

        const state = await w.engine.sync();
        assert.equal(state.repo?.behind, 0);
        assert.equal(state.repo?.head, w.team.head());
        assert.deepEqual(state.skills.map((s) => s.name), ['writer', 'extra']);
        assert.equal(skill(state, 'writer').resolvedLabel, 'v1.1.0', 'stays inside ^1.0.0');
        assert.equal(skill(state, 'writer').changed, 'updated');
        assert.equal(skill(state, 'writer').newerVersion, 'v2.0.0');
        assert.equal(skill(state, 'extra').changed, 'installed');
        assert.equal(existsSync(path.join(w.repoDir, 'mindSkills', 'reviewer')), false, 'removed skills are pruned');
        assert.deepEqual(state.orphans, []);
        assert.ok(state.log.some((l) => /Pulled 1 new commit/.test(l.message)));
    });

    test('never prunes when skill.json is broken', async () => {
        const w = world();
        await w.engine.sync();
        w.team.commit({ 'skill.json': '{ this is not json' }, 'oops');
        const state = await w.engine.sync();
        assert.match(state.manifest.error ?? '', /not valid JSON/);
        assert.equal(existsSync(path.join(w.repoDir, 'mindSkills', 'writer', 'SKILL.md')), true);
        assert.deepEqual(state.orphans.sort(), ['reviewer', 'writer']);
    });

    test('with auto-update off, updates are reported and installed on demand', async () => {
        const w = world({ autoUpdate: false });
        let state = await w.engine.sync();
        assert.deepEqual(state.skills.map((s) => s.health), ['missing', 'missing']);
        assert.equal(existsSync(path.join(w.repoDir, 'mindSkills')), false);

        state = await w.engine.updateSkill('reviewer');
        assert.equal(skill(state, 'reviewer').health, 'ok');
        assert.equal(skill(state, 'writer').health, 'missing');

        state = await w.engine.updateAllSkills();
        assert.ok(state.skills.every((s) => s.health === 'ok'));

        w.reviewer.commit({ 'SKILL.md': 'new\n' }, 'new');
        state = await w.engine.sync();
        assert.equal(skill(state, 'reviewer').health, 'outdated');
    });

    test('a skill with local edits is reported as dirty and can be reinstalled', async () => {
        const w = world();
        await w.engine.sync();
        writeFileSync(path.join(w.repoDir, 'mindSkills', 'reviewer', 'SKILL.md'), 'hacked locally\n');
        w.reviewer.commit({ 'SKILL.md': '# Reviewer 2\n' }, 'r2');
        let state = await w.engine.sync();
        assert.equal(skill(state, 'reviewer').health, 'dirty');
        assert.equal(readFileSync(path.join(w.repoDir, 'mindSkills', 'reviewer', 'SKILL.md'), 'utf8'), 'hacked locally\n');

        await assert.rejects(w.engine.updateSkill('reviewer'), /local changes/);
        state = await w.engine.updateSkill('reviewer', true);
        assert.equal(skill(state, 'reviewer').health, 'ok');
        assert.equal(readFileSync(path.join(w.repoDir, 'mindSkills', 'reviewer', 'SKILL.md'), 'utf8'), '# Reviewer 2\n');
    });

    test('offline: keeps working with what is installed', async () => {
        const w = world();
        await w.engine.sync();
        renameSync(w.team.url, `${w.team.url}.away`);
        renameSync(w.reviewer.url, `${w.reviewer.url}.away`);
        const state = await w.engine.sync();
        assert.equal(state.phase, 'ready');
        assert.ok(state.repo?.upstreamError, 'fetch failure is reported');
        assert.equal(skill(state, 'reviewer').health, 'error');
        assert.ok(skill(state, 'reviewer').installedCommit, 'installed copy is kept');
        assert.equal(skill(state, 'writer').health, 'ok');
        renameSync(`${w.team.url}.away`, w.team.url);
        renameSync(`${w.reviewer.url}.away`, w.reviewer.url);
        const back = await w.engine.sync();
        assert.equal(back.repo?.upstreamError, undefined);
        assert.ok(back.skills.every((s) => s.health === 'ok'));
    });
});

describe('MindPoolEngine: editing and sharing', () => {
    test('add a skill, commit & push: a teammate gets it on their next sync', async () => {
        const w = world();
        await w.engine.sync();
        const planner = sandbox.remote(`planner-${counter}`, { 'SKILL.md': '# Planner\n' });
        planner.tag('v0.3.0');

        let state = await w.engine.addSkill('planner', { repository: planner.url, kind: 'tag', value: 'v0.3.0' });
        assert.equal(skill(state, 'planner').health, 'ok');
        assert.equal(skill(state, 'planner').changed, 'installed');
        assert.deepEqual(state.repo?.changes.map((c) => c.path), ['skill.json']);

        state = await w.engine.commit('Add planner skill', ['skill.json'], true);
        assert.deepEqual(state.repo?.changes, []);
        assert.equal(state.repo?.ahead, 0);
        assert.equal(git(w.team.url, 'log', '-1', '--format=%s'), 'Add planner skill');

        // A teammate with their own pool folder.
        const teammatePool = sandbox.path('pools', `teammate-${counter}`);
        sandbox.write(path.relative(sandbox.root, path.join(teammatePool, 'config.json')), JSON.stringify({ repository: w.team.url, branch: 'main' }));
        const teammate = new MindPoolEngine({ poolFolder: teammatePool, git: createGit() });
        const theirs = await teammate.sync();
        assert.equal(theirs.config?.directory, path.basename(w.team.url, '.git'), 'folder derived from the URL');
        assert.ok(theirs.skills.some((s) => s.name === 'planner' && s.health === 'ok'));

        state = await w.engine.removeSkill('planner');
        assert.equal(state.skills.some((s) => s.name === 'planner'), false);
        assert.equal(existsSync(path.join(w.repoDir, 'mindSkills', 'planner')), false);
        assert.deepEqual(state.repo?.changes.map((c) => c.path), ['skill.json']);
    });

    test('commit validates its input', async () => {
        const w = world();
        await w.engine.sync();
        await assert.rejects(w.engine.commit('msg'), /working tree is clean/);
        writeFileSync(path.join(w.repoDir, 'NOTES.md'), 'x');
        await assert.rejects(w.engine.commit('   '), /commit message/);
        await assert.rejects(w.engine.commit('msg', ['not-changed.md']), /None of the selected files/);
        assert.ok(w.engine.state.lastError);
    });

    test('pull rebases local commits after a teammate pushed', async () => {
        const w = world();
        await w.engine.sync();
        writeFileSync(path.join(w.repoDir, 'MINE.md'), 'mine\n');
        await w.engine.commit('mine');
        w.team.commit({ 'THEIRS.md': 'theirs\n' }, 'theirs');
        let state = await w.engine.sync();
        assert.equal(state.repo?.ahead, 1);
        assert.equal(state.repo?.behind, 1);
        assert.ok(state.log.some((l) => /diverged/.test(l.message)));
        await assert.rejects(w.engine.push(), /Pull first/);
        state = await w.engine.pull();
        assert.equal(state.repo?.behind, 0);
        state = await w.engine.push();
        assert.equal(state.repo?.ahead, 0);
        assert.equal(w.team.remoteHead(), state.repo?.head);
    });

    test('createManifest bootstraps a repository without skill.json', async () => {
        const team = sandbox.remote(`bare-team-${counter++}`, { 'README.md': 'empty team\n' });
        const pool = sandbox.path('pools', `bare-${counter}`);
        sandbox.write(path.relative(sandbox.root, path.join(pool, 'config.json')), JSON.stringify({ repository: team.url, branch: 'main' }));
        const engine = new MindPoolEngine({ poolFolder: pool, git: createGit() });
        let state = await engine.sync();
        assert.equal(state.manifest.exists, false);
        state = await engine.createManifest();
        assert.equal(state.manifest.exists, true);
        assert.deepEqual(state.repo?.changes.map((c) => c.path), ['skill.json']);
    });
});

describe('MindPoolEngine: configuration', () => {
    test('no config, invalid config, then saveConfig clones', async () => {
        const team = sandbox.remote(`cfg-team-${counter++}`, { 'skill.json': skillJson({}) });
        const pool = sandbox.path('pools', `cfg-${counter}`);
        const engine = new MindPoolEngine({ poolFolder: pool, git: createGit() });
        let state = await engine.sync();
        assert.equal(state.phase, 'noConfig');

        sandbox.write(path.relative(sandbox.root, path.join(pool, 'config.json')), '{"repository": "", "branch": "main"}');
        state = await engine.sync();
        assert.equal(state.phase, 'invalidConfig');
        assert.match(state.configError ?? '', /Repository URL is required/);
        assert.equal(state.configDraft?.branch, 'main');

        assert.equal(await engine.hasFileChanged('config'), false);
        state = await engine.saveConfig({ repository: team.url, branch: 'main', directory: 'pool-repo' });
        assert.equal(state.phase, 'ready');
        assert.equal(state.repo?.path, path.join(pool, 'pool-repo'));
        assert.equal(await engine.hasFileChanged('config'), false, 'the engine knows about its own write');
        assert.equal(await engine.hasFileChanged('manifest'), false);
    });

    test('a release tag pins the repository read-only and offers newer releases', async () => {
        const w = world({ tag: 'v1.0.0' });
        let state = await w.engine.sync();
        assert.equal(state.phase, 'ready', state.lastError ?? 'sync failed');
        assert.equal(state.repo?.readOnly, true);
        assert.equal(state.repo?.detached, true);
        await assert.rejects(w.engine.commit('x'), /read-only/);
        await assert.rejects(w.engine.addSkill('x', { repository: w.writer.url, kind: 'default' }), /read-only/);
        await assert.rejects(w.engine.push(), /read-only/);

        w.team.commit({ 'skill.json': skillJson({ reviewer: w.reviewer.url }) }, 'next release');
        w.team.tag('v1.1.0');
        state = await w.engine.sync();
        assert.deepEqual(state.repo?.newerTags, ['v1.1.0']);
        assert.equal(state.skills.length, 2, 'still on the v1.0.0 skill list');

        state = await w.engine.saveConfig({ repository: w.team.url, branch: 'main', tag: 'v1.1.0', directory: 'team' });
        assert.equal(state.repo?.tag, 'v1.1.0');
        assert.deepEqual(state.repo?.newerTags, []);
        assert.deepEqual(state.skills.map((s) => s.name), ['reviewer']);

        state = await w.engine.saveConfig({ repository: w.team.url, branch: 'main', directory: 'team' });
        assert.equal(state.repo?.readOnly, false);
        assert.equal(state.repo?.branch, 'main');
    });

    test('a clone failure is reported without throwing', async () => {
        const pool = sandbox.path('pools', `broken-${counter++}`);
        sandbox.write(path.relative(sandbox.root, path.join(pool, 'config.json')), JSON.stringify({ repository: sandbox.path('remotes', 'missing.git'), branch: 'main' }));
        const engine = new MindPoolEngine({ poolFolder: pool, git: createGit() });
        const state = await engine.sync();
        assert.equal(state.phase, 'notCloned');
        assert.ok(state.lastError);
        assert.equal(state.repo?.cloned, false);
    });
});

describe('MindPoolEngine: concurrency', () => {
    test('concurrent syncs are coalesced and every operation is serialised', async () => {
        const w = world();
        const busyLabels = new Set<string>();
        w.engine.onDidChange((s) => {
            if (s.busy) {
                busyLabels.add(s.busy);
            }
        });
        const first = w.engine.sync();
        const second = w.engine.sync();
        assert.equal(first, second, 'same promise while queued');
        const results = await Promise.all([first, w.engine.refreshLocal(), w.engine.sync(), w.engine.updateAllSkills()]);
        assert.ok(results.every((s) => s.phase === 'ready'));
        assert.equal(w.engine.state.busy, undefined);
        assert.ok(busyLabels.has('Syncing'));
        assert.ok(w.engine.state.skills.every((s) => s.health === 'ok'));
    });
});

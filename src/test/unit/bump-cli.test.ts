/**
 * Runs scripts/bump.ts against real git repositories, the way `npm run bump` does.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';
import { git, type Remote, Sandbox } from '../helpers.ts';

const BUMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'bump.ts');
const sandbox = new Sandbox('mindpool-bump-');
after(() => sandbox.cleanup());

function packageJson(version: string): string {
    return `${JSON.stringify({ name: 'ext', version, repository: { type: 'git', url: 'https://github.com/acme/ext.git' } }, null, 4)}\n`;
}

function lockJson(version: string): string {
    return `${JSON.stringify({ name: 'ext', version, lockfileVersion: 3, packages: { '': { name: 'ext', version } } }, null, 4)}\n`;
}

interface Run {
    status: number | null;
    stdout: string;
    stderr: string;
}

function bump(cwd: string, ...args: string[]): Run {
    const result = spawnSync(process.execPath, [BUMP, ...args], { cwd, encoding: 'utf8', env: process.env });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function check(cwd: string, ...args: string[]): { needed: boolean; next: string | null; kind: string | null; warnings: string[] } {
    const run = bump(cwd, '--json', ...args);
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout) as { needed: boolean; next: string | null; kind: string | null; warnings: string[] };
}

function version(repo: Remote, file = 'package.json'): string {
    return (JSON.parse(readFileSync(path.join(repo.work, file), 'utf8')) as { version: string }).version;
}

describe('npm run bump', () => {
    const repo = sandbox.remote('ext', { 'package.json': packageJson('1.0.0'), 'package-lock.json': lockJson('1.0.0'), 'src/main.ts': 'export {};\n' });
    git(repo.work, 'branch', '--set-upstream-to=origin/main');

    test('first release: tags the package.json version without bumping it', () => {
        const plan = check(repo.work);
        assert.deepEqual([plan.needed, plan.kind, plan.next], [true, 'initial', '1.0.0']);

        const run = bump(repo.work, '--apply');
        assert.equal(run.status, 0, run.stderr);
        assert.match(run.stdout, /Tagged v1\.0\.0|tagged v1\.0\.0/);
        assert.equal(version(repo), '1.0.0');
        assert.equal(git(repo.work, 'describe', '--tags', '--exact-match', 'HEAD'), 'v1.0.0');
        assert.equal(git(repo.work, 'log', '-1', '--format=%s'), 'chore(release): v1.0.0');
        const changelog = readFileSync(path.join(repo.work, 'CHANGELOG.md'), 'utf8');
        assert.match(changelog, /^# Changelog\n/);
        assert.match(changelog, /## \[1\.0\.0\]\(https:\/\/github\.com\/acme\/ext\/tree\/v1\.0\.0\) \(\d{4}-\d{2}-\d{2}\)\n\n🎉 First release\./);
        assert.equal(git(repo.work, 'status', '--porcelain'), '');
    });

    test('nothing to release right after a release, or after docs and tests only', () => {
        assert.equal(check(repo.work).needed, false);
        repo.commit({ 'docs/guide.md': '# Guide\n' }, 'docs: add a guide');
        repo.commit({ 'src/test/a.test.ts': '// test\n' }, 'Add tests');
        const run = bump(repo.work);
        assert.equal(run.status, 0, run.stderr);
        assert.match(run.stdout, /No release needed\. 2 commits since v1\.0\.0, but none/);
        const apply = bump(repo.work, '--apply');
        assert.match(apply.stdout, /Nothing to release/);
        assert.equal(git(repo.work, 'tag', '--list'), 'v1.0.0');
    });

    test('a feature bumps the minor version, updates the lockfile and prepends the changelog', () => {
        repo.commit({ 'src/main.ts': 'export const x = 1;\n' }, 'feat(ui): skill filter');
        repo.commit({ 'src/main.ts': 'export const x = 2;\n' }, 'fix: crash on empty skill.json');
        const human = bump(repo.work);
        assert.match(human.stdout, /Release needed: 1\.0\.0 → 1\.1\.0/);
        assert.match(human.stdout, /✨ minor/);

        const run = bump(repo.work, '--apply');
        assert.equal(run.status, 0, run.stderr);
        assert.equal(version(repo), '1.1.0');
        assert.equal(version(repo, 'package-lock.json'), '1.1.0');
        assert.equal(git(repo.work, 'describe', '--tags', '--exact-match', 'HEAD'), 'v1.1.0');
        const changelog = readFileSync(path.join(repo.work, 'CHANGELOG.md'), 'utf8');
        assert.ok(changelog.indexOf('## [1.1.0]') < changelog.indexOf('## [1.0.0]'));
        assert.match(changelog, /compare\/v1\.0\.0\.\.\.v1\.1\.0/);
        assert.match(changelog, /- \*\*ui:\*\* skill filter/);
        assert.match(changelog, /- crash on empty skill\.json/);
        assert.doesNotMatch(changelog, /add a guide/);
        // Nothing is pushed.
        assert.equal(git(repo.url, 'tag', '--list'), '');
    });

    test('refuses to release with uncommitted changes, and changes nothing', () => {
        repo.commit({ 'src/main.ts': 'export const x = 3;\n' }, 'fix: another one');
        writeFileSync(path.join(repo.work, 'scratch.txt'), 'wip\n');
        const before = readFileSync(path.join(repo.work, 'package.json'), 'utf8');
        const run = bump(repo.work, '--apply');
        assert.equal(run.status, 1);
        assert.match(run.stderr, /uncommitted changes/);
        assert.equal(readFileSync(path.join(repo.work, 'package.json'), 'utf8'), before);
        assert.ok(check(repo.work).warnings.some((w) => /uncommitted/.test(w)));
    });

    test('--no-git only writes the files, even with a dirty tree', () => {
        const run = bump(repo.work, '--apply', '--no-git');
        assert.equal(run.status, 0, run.stderr);
        assert.equal(version(repo), '1.1.1');
        assert.equal(git(repo.work, 'tag', '--list', 'v1.1.1'), '');
        git(repo.work, 'checkout', '--', '.');
        git(repo.work, 'clean', '-fdq');
    });

    test('a version bumped by hand is released as is; --release-as overrides', () => {
        repo.commit({ 'package.json': packageJson('2.0.0') }, 'chore: prepare 2.0');
        const plan = check(repo.work);
        assert.deepEqual([plan.kind, plan.next], ['pending', '2.0.0']);
        assert.equal(check(repo.work, '--release-as', 'minor').next, '2.1.0');
        const bad = bump(repo.work, '--release-as', '1.0.0');
        assert.equal(bad.status, 1);
        assert.match(bad.stderr, /not newer/);
    });

    test('refuses when the branch is behind its upstream', () => {
        const other = sandbox.path('work', 'ext-teammate');
        git(sandbox.root, 'clone', '--quiet', repo.url, other);
        writeFileSync(path.join(other, 'b.txt'), 'b\n');
        git(other, 'add', '-A');
        git(other, 'commit', '--quiet', '-m', 'docs: teammate');
        git(other, 'push', '--quiet', 'origin', 'HEAD:main');
        git(repo.work, 'fetch', '--quiet', 'origin');
        const run = bump(repo.work, '--apply');
        assert.equal(run.status, 1);
        assert.match(run.stderr, /behind origin\/main/);
    });

    test('unknown options print the usage', () => {
        const run = bump(repo.work, '--bogus');
        assert.equal(run.status, 1);
        assert.match(run.stderr, /Usage: node scripts\/bump\.ts/);
    });
});

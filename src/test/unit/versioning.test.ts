import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
    bumpVersion,
    CHANGELOG_HEADER,
    classifyCommit,
    decideRelease,
    hasChangelogEntry,
    insertChangelog,
    isShippedPath,
    latestReleaseTag,
    parseGitLog,
    type RawCommit,
    renderChangelogSection,
    repoWebUrl,
    setJsonVersion,
} from '../../../scripts/versioning.ts';

let counter = 0;
function commit(subject: string, files: string[] = ['src/VsCodeExtension/core/engine.ts'], body = ''): RawCommit {
    counter += 1;
    return { sha: `${String(counter).padStart(7, '0')}${'a'.repeat(33)}`, subject, body, files };
}

describe('isShippedPath', () => {
    test('extension sources, manifest and assets ship; tests, docs and tooling do not', () => {
        for (const p of ['src/main.ts', 'src/VsCodeExtension/ui/render.ts', 'package.json', 'media/icon.png', 'schemas/skill.schema.json', 'scripts/build.ts']) {
            assert.equal(isShippedPath(p), true, p);
        }
        for (const p of ['src/test/unit/engine.test.ts', 'docs/UserGuide.md', 'README.md', 'package-lock.json', '.gitignore', 'tsconfig.json', 'scripts/bump.ts']) {
            assert.equal(isShippedPath(p), false, p);
        }
    });
});

describe('classifyCommit', () => {
    test('Conventional Commits types', () => {
        assert.equal(classifyCommit(commit('feat: skill filter')).level, 'minor');
        assert.equal(classifyCommit(commit('fix(engine): crash on empty skill.json')).level, 'patch');
        assert.equal(classifyCommit(commit('perf: cache ls-remote')).level, 'patch');
        assert.equal(classifyCommit(commit('revert: "feat: x"')).group, 'revert');
        assert.equal(classifyCommit(commit('Feat: upper-case type')).level, 'minor');
    });

    test('scope and description are split out', () => {
        const c = classifyCommit(commit('fix(ui): keep focus while typing'));
        assert.equal(c.type, 'fix');
        assert.equal(c.scope, 'ui');
        assert.equal(c.description, 'keep focus while typing');
    });

    test('breaking changes: "!" or a BREAKING CHANGE footer', () => {
        assert.equal(classifyCommit(commit('feat!: new config format')).level, 'major');
        assert.equal(classifyCommit(commit('refactor(core)!: drop tag field')).level, 'major');
        const footer = classifyCommit(commit('feat: new config', undefined, 'Details.\n\nBREAKING CHANGE: "directory" was renamed'));
        assert.equal(footer.level, 'major');
        assert.equal(footer.group, 'breaking');
        assert.equal(classifyCommit(commit('fix: x', undefined, 'BREAKING-CHANGE: y')).level, 'major');
    });

    test('docs, tests, chores and friends never release, even when they touch sources', () => {
        for (const type of ['docs', 'test', 'ci', 'chore', 'build', 'style', 'refactor']) {
            assert.equal(classifyCommit(commit(`${type}: something`)).level, undefined, type);
        }
        assert.equal(classifyCommit(commit('chore(release): v1.2.0', ['package.json', 'CHANGELOG.md'])).level, undefined);
    });

    test('other messages are judged by the files they touch', () => {
        const shipped = classifyCommit(commit('Improve the dashboard', ['src/VsCodeExtension/ui/render.ts', 'README.md']));
        assert.equal(shipped.level, 'patch');
        assert.equal(shipped.group, 'other');
        assert.equal(classifyCommit(commit('Typo in the guide', ['docs/UserGuide.md'])).level, undefined);
        assert.equal(classifyCommit(commit('More tests', ['src/test/unit/ui.test.ts'])).level, undefined);
        // Unknown conventional type: same rule.
        assert.equal(classifyCommit(commit('wip: half done', ['src/main.ts'])).level, 'patch');
        assert.equal(classifyCommit(commit('constructor: not a real type', ['docs/x.md'])).level, undefined);
    });
});

describe('parseGitLog', () => {
    test('reads sha, subject, multi-line body and changed files', () => {
        const output = '\x1eabc123\x1ffeat: one\x1fline 1\nline 2\n\x1f\n\nsrc/a.ts\nREADME.md\n\x1edef456\x1fchore: two\x1f\x1f\n\npackage.json\n';
        assert.deepEqual(parseGitLog(output), [
            { sha: 'abc123', subject: 'feat: one', body: 'line 1\nline 2', files: ['src/a.ts', 'README.md'] },
            { sha: 'def456', subject: 'chore: two', body: '', files: ['package.json'] },
        ]);
        assert.deepEqual(parseGitLog(''), []);
    });
});

describe('versions', () => {
    test('bumpVersion', () => {
        assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
        assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
        assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
        assert.throws(() => bumpVersion('1.2.3-beta.1', 'patch'), /plain X\.Y\.Z/);
    });

    test('latestReleaseTag picks the highest vX.Y.Z and ignores everything else', () => {
        assert.equal(latestReleaseTag(['v1.0.0', 'v1.10.0', 'v1.9.0', '']), 'v1.10.0');
        assert.equal(latestReleaseTag(['v2.0.0-beta.1', 'v1.0.0', 'vnext', 'version-3', 'release']), 'v1.0.0');
        assert.equal(latestReleaseTag([]), undefined);
    });
});

describe('decideRelease', () => {
    test('first release: the package.json version, no bump', () => {
        const plan = decideRelease({ packageVersion: '1.0.0', commits: [commit('Initial commit')] });
        assert.equal(plan.needed, true);
        assert.equal(plan.kind, 'initial');
        assert.equal(plan.next, '1.0.0');
        assert.equal(plan.previous, undefined);
    });

    test('no release when nothing shipped changed', () => {
        assert.equal(decideRelease({ packageVersion: '1.0.0', lastTag: 'v1.0.0', commits: [] }).needed, false);
        const plan = decideRelease({
            packageVersion: '1.0.0',
            lastTag: 'v1.0.0',
            commits: [commit('docs: guide', ['docs/UserGuide.md']), commit('test: more', ['src/test/unit/x.test.ts']), commit('Fix typo', ['README.md'])],
        });
        assert.equal(plan.needed, false);
        assert.equal(plan.next, undefined);
        assert.match(plan.reason, /3 commits since v1\.0\.0, but none/);
    });

    test('the biggest change wins', () => {
        const base = { packageVersion: '1.4.2', lastTag: 'v1.4.2' };
        assert.equal(decideRelease({ ...base, commits: [commit('fix: a'), commit('docs: b')] }).next, '1.4.3');
        assert.equal(decideRelease({ ...base, commits: [commit('fix: a'), commit('feat: b'), commit('chore: c')] }).next, '1.5.0');
        const major = decideRelease({ ...base, commits: [commit('feat: a'), commit('fix!: b')] });
        assert.equal(major.next, '2.0.0');
        assert.equal(major.kind, 'major');
        assert.match(major.reason, /2 of 2 commits since v1\.4\.2.*breaking change/);
    });

    test('0.x: a breaking change bumps the minor version', () => {
        const plan = decideRelease({ packageVersion: '0.3.1', lastTag: 'v0.3.1', commits: [commit('feat!: rewrite')] });
        assert.equal(plan.next, '0.4.0');
    });

    test('package.json bumped by hand but not tagged yet: release it as is', () => {
        const plan = decideRelease({ packageVersion: '2.0.0', lastTag: 'v1.3.0', commits: [commit('chore: prepare 2.0', ['package.json'])] });
        assert.equal(plan.kind, 'pending');
        assert.equal(plan.next, '2.0.0');
        assert.equal(plan.previous, '1.3.0');
    });

    test('package.json older than the latest tag is an error', () => {
        assert.throws(() => decideRelease({ packageVersion: '1.0.0', lastTag: 'v1.2.0', commits: [] }), /older than the latest release tag v1\.2\.0/);
    });

    test('pre-release or prefixed package.json versions are rejected', () => {
        assert.throws(() => decideRelease({ packageVersion: '1.0.0-beta.1', commits: [] }), /plain X\.Y\.Z/);
        assert.throws(() => decideRelease({ packageVersion: 'v1.0.0', commits: [] }), /plain X\.Y\.Z/);
    });

    test('--release-as: keyword or exact version, always newer', () => {
        const base = { packageVersion: '1.2.0', lastTag: 'v1.2.0', commits: [commit('docs: x', ['docs/a.md'])] };
        const forced = decideRelease({ ...base, releaseAs: 'minor' });
        assert.equal(forced.needed, true);
        assert.equal(forced.kind, 'manual');
        assert.equal(forced.next, '1.3.0');
        assert.equal(decideRelease({ ...base, releaseAs: '3.0.0' }).next, '3.0.0');
        assert.throws(() => decideRelease({ ...base, releaseAs: '1.2.0' }), /not newer/);
        assert.throws(() => decideRelease({ ...base, releaseAs: '1.1.0' }), /not newer/);
        assert.throws(() => decideRelease({ ...base, releaseAs: 'huge' }), /plain X\.Y\.Z/);
        assert.equal(decideRelease({ packageVersion: '1.0.0', commits: [], releaseAs: '1.0.0' }).next, '1.0.0');
    });
});

describe('changelog', () => {
    const web = 'https://github.com/AiGromatics/MindPool';

    test('groups commits in a fixed order with commit and compare links', () => {
        const plan = decideRelease({
            packageVersion: '1.0.0',
            lastTag: 'v1.0.0',
            commits: [commit('fix(ui): focus'), commit('docs: guide', ['docs/a.md']), commit('feat: filter'), commit('Polish icons', ['media/icon.svg'])],
        });
        const section = renderChangelogSection(plan, { date: '2026-11-05', webUrl: web });
        assert.match(section, /^## \[1\.1\.0\]\(https:\/\/github\.com\/AiGromatics\/MindPool\/compare\/v1\.0\.0\.\.\.v1\.1\.0\) \(2026-11-05\)\n/);
        const features = section.indexOf('### ✨ Features');
        const fixes = section.indexOf('### 🐛 Bug fixes');
        const other = section.indexOf('### 🔧 Other changes');
        assert.ok(features > 0 && fixes > features && other > fixes, section);
        assert.match(section, /- \*\*ui:\*\* focus \(\[\d{7}\]\(https:\/\/github\.com\/AiGromatics\/MindPool\/commit\/\w{40}\)\)/);
        assert.match(section, /- Polish icons/);
        assert.doesNotMatch(section, /guide/);
    });

    test('first release and maintenance release', () => {
        const first = renderChangelogSection(decideRelease({ packageVersion: '1.0.0', commits: [commit('Initial commit')] }), { date: '2026-11-05', webUrl: web });
        assert.equal(first, `## [1.0.0](${web}/tree/v1.0.0) (2026-11-05)\n\n🎉 First release.\n`);
        const manual = renderChangelogSection(decideRelease({ packageVersion: '1.0.0', lastTag: 'v1.0.0', commits: [], releaseAs: 'patch' }), { date: '2026-11-05' });
        assert.equal(manual, '## 1.0.1 (2026-11-05)\n\nMaintenance release.\n');
    });

    test('insertChangelog creates the file, then adds new entries on top', () => {
        const one = insertChangelog(undefined, '## 1.0.0 (d)\n\nA\n');
        assert.equal(one, `${CHANGELOG_HEADER}\n## 1.0.0 (d)\n\nA\n`);
        const two = insertChangelog(one, '## 1.1.0 (d)\n\nB\n');
        assert.ok(two.indexOf('## 1.1.0') < two.indexOf('## 1.0.0'));
        assert.ok(two.startsWith(CHANGELOG_HEADER));
        assert.equal(insertChangelog('# Notes\n', '## 2.0.0 (d)\n'), '# Notes\n\n## 2.0.0 (d)\n');
    });

    test('hasChangelogEntry matches whole versions only', () => {
        const text = `${CHANGELOG_HEADER}\n## [1.10.0](x) (d)\n\n## 1.2.0 (d)\n`;
        assert.equal(hasChangelogEntry(text, '1.10.0'), true);
        assert.equal(hasChangelogEntry(text, '1.2.0'), true);
        assert.equal(hasChangelogEntry(text, '1.1.0'), false);
        assert.equal(hasChangelogEntry(text, '1.0.0'), false);
    });
});

describe('files', () => {
    test('setJsonVersion keeps indentation, key order and the lockfile root package', () => {
        const pkg = '{\n    "name": "mindpool",\n    "version": "1.0.0",\n    "main": "./dist/main.cjs"\n}\n';
        assert.equal(setJsonVersion(pkg, '1.1.0'), pkg.replace('1.0.0', '1.1.0'));
        const lock = JSON.stringify({ name: 'mindpool', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'mindpool', version: '1.0.0' }, 'node_modules/x': { version: '1.0.0' } } }, null, 2);
        const updated = JSON.parse(setJsonVersion(lock, '1.1.0')) as { version: string; packages: Record<string, { version: string }> };
        assert.equal(updated.version, '1.1.0');
        assert.equal(updated.packages['']?.version, '1.1.0');
        assert.equal(updated.packages['node_modules/x']?.version, '1.0.0');
        assert.equal(setJsonVersion('{\r\n  "version": "1.0.0"\r\n}\r\n', '2.0.0'), '{\r\n  "version": "2.0.0"\r\n}\r\n');
    });

    test('repoWebUrl normalizes package.json repository fields and drops credentials', () => {
        const expected = 'https://github.com/AiGromatics/MindPool';
        assert.equal(repoWebUrl({ type: 'git', url: 'https://github.com/AiGromatics/MindPool.git' }), expected);
        assert.equal(repoWebUrl('git+https://github.com/AiGromatics/MindPool.git'), expected);
        assert.equal(repoWebUrl('git@github.com:AiGromatics/MindPool.git'), expected);
        assert.equal(repoWebUrl('ssh://git@github.com/AiGromatics/MindPool.git'), expected);
        assert.equal(repoWebUrl('github:AiGromatics/MindPool'), expected);
        assert.equal(repoWebUrl('AiGromatics/MindPool'), expected);
        assert.equal(repoWebUrl('https://user:ghp_secret@github.com/AiGromatics/MindPool.git'), expected);
        assert.equal(repoWebUrl('gitlab:acme/tool'), 'https://gitlab.com/acme/tool');
        assert.equal(repoWebUrl('file:///tmp/repo'), undefined);
        assert.equal(repoWebUrl(undefined), undefined);
        assert.equal(repoWebUrl({ url: 42 }), undefined);
    });
});

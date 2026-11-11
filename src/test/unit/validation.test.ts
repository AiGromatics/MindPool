import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { expandFolderPath, isInside, isSafeName, repoNameFromUrl, settingTarget, validateGitUrl, validateRefName } from '../../VsCodeExtension/core/validation.ts';

describe('isSafeName', () => {
    test('accepts plain folder names', () => {
        for (const name of ['code-review', 'pdf_tools', 'v2.skill', 'A1']) {
            assert.equal(isSafeName(name), true, name);
        }
    });

    test('rejects anything that could escape mindSkills', () => {
        for (const name of ['', '.', '..', '../evil', 'a/b', 'a\\b', '.hidden', '-flag', 'x.lock', 'with space', 'a'.repeat(101)]) {
            assert.equal(isSafeName(name), false, name);
        }
    });
});

describe('validateGitUrl', () => {
    test('accepts common git URLs', () => {
        for (const url of ['https://github.com/acme/skills.git', 'git@github.com:acme/skills.git', 'ssh://git@host:2222/x.git', '/srv/git/skills.git', 'file:///tmp/x.git']) {
            assert.equal(validateGitUrl(url), undefined, url);
        }
    });

    test('rejects option injection, dangerous transports and junk', () => {
        assert.match(validateGitUrl('') ?? '', /required/);
        assert.match(validateGitUrl('--upload-pack=touch /tmp/pwned') ?? '', /must not start/);
        assert.match(validateGitUrl('ext::sh -c touch% /tmp/pwned') ?? '', /not allowed|spaces/);
        assert.match(validateGitUrl('ext::sh') ?? '', /not allowed/);
        assert.match(validateGitUrl('https://x/a b.git') ?? '', /spaces/);
    });
});

describe('validateRefName', () => {
    test('accepts usual branch and tag names', () => {
        for (const ref of ['main', 'feature/new-skill', 'v1.2.0', 'release-2026.11']) {
            assert.equal(validateRefName(ref), undefined, ref);
        }
    });

    test('rejects invalid refs', () => {
        for (const ref of ['', '-x', 'a..b', 'a b', 'a~1', 'a^', 'a:b', 'x.lock', 'end/', '/start', '@', 'a@{1}', 'a*']) {
            assert.notEqual(validateRefName(ref), undefined, ref);
        }
    });
});

describe('repoNameFromUrl', () => {
    test('derives folder names', () => {
        assert.equal(repoNameFromUrl('https://github.com/acme/team-skills.git'), 'team-skills');
        assert.equal(repoNameFromUrl('git@github.com:acme/team-skills.git'), 'team-skills');
        assert.equal(repoNameFromUrl('https://gitlab.com/acme/skills/'), 'skills');
        assert.equal(repoNameFromUrl('/srv/repos/Pool.git'), 'Pool');
        assert.equal(repoNameFromUrl('git@host:weird name!.git'), 'weird-name-');
        assert.equal(repoNameFromUrl('...'), 'skills-repo');
    });
});

describe('expandFolderPath', () => {
    const ctx = { home: '/home/me', workspaceFolder: '/work/project' };

    test('expands ~, ${userHome} and ${workspaceFolder}', () => {
        assert.equal(expandFolderPath('~', ctx).path, path.normalize('/home/me'));
        assert.equal(expandFolderPath('~/pool', ctx).path, path.normalize('/home/me/pool'));
        assert.equal(expandFolderPath('${userHome}/pool', ctx).path, path.normalize('/home/me/pool'));
        assert.equal(expandFolderPath('${workspaceFolder}/.mindpool', ctx).path, path.normalize('/work/project/.mindpool'));
    });

    test('resolves relative paths against the workspace (or home)', () => {
        assert.equal(expandFolderPath('pool', ctx).path, path.resolve('/work/project', 'pool'));
        assert.equal(expandFolderPath('pool', { home: '/home/me' }).path, path.resolve('/home/me', 'pool'));
    });

    test('reports ${workspaceFolder} without an open folder, and empty values', () => {
        assert.match(expandFolderPath('${workspaceFolder}/x', { home: '/h' }).error ?? '', /no folder is open/);
        assert.deepEqual(expandFolderPath('   ', ctx), {});
    });
});

describe('settingTarget', () => {
    test('writes to the workspace when it overrides the user setting, even with ""', () => {
        assert.equal(settingTarget({ workspaceValue: '' }), 'workspace');
        assert.equal(settingTarget({ workspaceValue: '/team/pool' }), 'workspace');
    });

    test('writes to the user settings otherwise', () => {
        assert.equal(settingTarget({ workspaceValue: undefined }), 'global');
        assert.equal(settingTarget({}), 'global');
        assert.equal(settingTarget(undefined), 'global');
    });
});

describe('isInside', () => {
    test('detects containment', () => {
        assert.equal(isInside('/a/b', '/a/b/c/d'), true);
        assert.equal(isInside('/a/b', '/a/b'), true);
        assert.equal(isInside('/a/b', '/a/bc'), false);
        assert.equal(isInside('/a/b', '/a/b/../c'), false);
    });
});

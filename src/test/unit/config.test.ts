import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cleanSettings, isBlank, sameSettings, validateConfig } from '../../VsCodeExtension/core/config.ts';

describe('validateConfig', () => {
    test('accepts a minimal config and derives the clone folder', () => {
        const result = validateConfig({ repository: 'git@github.com:acme/team-skills.git', branch: 'main' });
        assert.deepEqual(result.config, { repository: 'git@github.com:acme/team-skills.git', branch: 'main', tag: undefined, directory: 'team-skills', linkSkillsTo: [] });
        assert.equal(result.error, undefined);
    });

    test('treats empty settings like unset ones', () => {
        const result = validateConfig({ repository: 'https://x/y.git', branch: 'main', tag: '', directory: '  ', linkSkillsTo: [] });
        assert.deepEqual(result.config, { repository: 'https://x/y.git', branch: 'main', tag: undefined, directory: 'y', linkSkillsTo: [] });
    });

    test('linkSkillsTo takes a list (or one folder), trimmed and without duplicates', () => {
        const base = { repository: 'https://x/y.git', branch: 'main' };
        assert.deepEqual(validateConfig({ ...base, linkSkillsTo: ['~/.claude/skills', '', '~/.claude/skills', '/opt/skills'] }).config?.linkSkillsTo, ['~/.claude/skills', '/opt/skills']);
        assert.deepEqual(validateConfig({ ...base, linkSkillsTo: ' ~/.claude/skills ' }).config?.linkSkillsTo, ['~/.claude/skills']);
        assert.deepEqual(validateConfig({ ...base, linkSkillsTo: '' }).config?.linkSkillsTo, []);
        const wrong = validateConfig({ ...base, linkSkillsTo: [1] });
        assert.equal(wrong.config, undefined);
        assert.match(wrong.error ?? '', /"mindpool.linkSkillsTo" must be a list of folder paths/);
        assert.match(validateConfig({ ...base, linkSkillsTo: { a: 1 } }).error ?? '', /linkSkillsTo/);
    });

    test('keeps tag and directory', () => {
        const result = validateConfig({ repository: 'https://x/y.git', branch: 'develop', tag: 'v1.2.0', directory: 'pool-repo' });
        assert.equal(result.config?.tag, 'v1.2.0');
        assert.equal(result.config?.directory, 'pool-repo');
    });

    test('requires a repository and a branch', () => {
        const result = validateConfig({});
        assert.equal(result.config, undefined);
        assert.match(result.error ?? '', /Repository URL is required/);
        assert.match(result.error ?? '', /Branch is required/);
    });

    test('rejects unsafe values and keeps a draft for the form', () => {
        const result = validateConfig({ repository: '--upload-pack=x', branch: 'main', directory: '../outside' });
        assert.equal(result.config, undefined);
        assert.match(result.error ?? '', /must not start/);
        assert.match(result.error ?? '', /"mindpool.directory" must be a plain folder name/);
        assert.equal(result.draft.branch, 'main');
    });

    test('rejects mindSkills as clone folder and wrong types from a hand-edited settings.json', () => {
        assert.match(validateConfig({ repository: 'https://x/y.git', branch: 'main', directory: 'mindSkills' }).error ?? '', /plain folder name/);
        assert.match(validateConfig({ repository: 'https://x/y.git', branch: 3 }).error ?? '', /"mindpool.branch" must be a string/);
        assert.match(validateConfig([]).error ?? '', /must be an object/);
    });
});

describe('cleanSettings', () => {
    test('trims values, leaves out empty optional ones and keeps the folder name as typed', () => {
        assert.deepEqual(cleanSettings({ repository: ' https://example.com/acme/skills.git ', branch: ' main ', tag: '', directory: '', linkSkillsTo: [' ~/.claude/skills ', '~/.claude/skills'] }), {
            repository: 'https://example.com/acme/skills.git',
            branch: 'main',
            tag: undefined,
            directory: undefined,
            linkSkillsTo: ['~/.claude/skills'],
        });
        assert.equal(cleanSettings({ repository: 'https://x/y.git', branch: 'main', directory: 'pool' }).directory, 'pool');
    });

    test('refuses invalid values', () => {
        assert.throws(() => cleanSettings({ repository: '', branch: 'main' }), /Repository URL is required/);
        assert.throws(() => cleanSettings({ repository: 'https://x/y.git', branch: 'main', tag: 'bad tag' }), /not a valid git ref/);
    });
});

describe('sameSettings', () => {
    const base = { repository: 'https://x/y.git', branch: 'main' };

    test('ignores whitespace, empty versus unset values and duplicate folders', () => {
        assert.equal(sameSettings({ ...base, tag: '', directory: '', linkSkillsTo: [] }, { ...base }), true);
        assert.equal(sameSettings({ ...base, repository: ' https://x/y.git ' }, base), true);
        assert.equal(sameSettings({ ...base, linkSkillsTo: ['~/a', '~/a'] }, { ...base, linkSkillsTo: ['~/a'] }), true);
    });

    test('sees real changes, including a fix of an invalid value', () => {
        assert.equal(sameSettings({ ...base, tag: 'v1.0.0' }, base), false);
        assert.equal(sameSettings({ ...base, branch: 'develop' }, base), false);
        assert.equal(sameSettings({ ...base, linkSkillsTo: ['~/a'] }, { ...base, linkSkillsTo: ['~/b'] }), false);
        assert.equal(sameSettings({ ...base, linkSkillsTo: [1] as unknown as string[] }, { ...base, linkSkillsTo: [] }), false);
    });
});

describe('isBlank', () => {
    test('only unset and whitespace-only values are blank', () => {
        assert.deepEqual([undefined, null, '', '  ', 'x', 0].map(isBlank), [true, true, true, true, false, false]);
    });
});

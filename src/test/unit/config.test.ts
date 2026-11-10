import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { after, describe, test } from 'node:test';
import { parseConfig, readConfig, validateConfig, writeConfig } from '../../VsCodeExtension/core/config.ts';
import { Sandbox } from '../helpers.ts';

const sandbox = new Sandbox();
after(() => sandbox.cleanup());

describe('validateConfig', () => {
    test('accepts a minimal config and derives the clone folder', () => {
        const result = validateConfig({ repository: 'git@github.com:acme/team-skills.git', branch: 'main' });
        assert.deepEqual(result.config, { repository: 'git@github.com:acme/team-skills.git', branch: 'main', tag: undefined, directory: 'team-skills', linkSkillsTo: [] });
        assert.equal(result.error, undefined);
    });

    test('linkSkillsTo takes one folder or a list, trimmed and without duplicates', () => {
        const base = { repository: 'https://x/y.git', branch: 'main' };
        assert.deepEqual(validateConfig({ ...base, linkSkillsTo: ' ~/.claude/skills ' }).config?.linkSkillsTo, ['~/.claude/skills']);
        assert.deepEqual(validateConfig({ ...base, linkSkillsTo: ['~/.claude/skills', '', '~/.claude/skills', '/opt/skills'] }).config?.linkSkillsTo, ['~/.claude/skills', '/opt/skills']);
        assert.deepEqual(validateConfig({ ...base, linkSkillsTo: '' }).config?.linkSkillsTo, []);
        const wrong = validateConfig({ ...base, linkSkillsTo: [1] });
        assert.equal(wrong.config, undefined);
        assert.match(wrong.error ?? '', /"linkSkillsTo" must be a folder path or a list/);
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
        assert.match(result.error ?? '', /plain folder name/);
        assert.equal(result.draft.branch, 'main');
    });

    test('rejects mindSkills as clone folder and wrong types', () => {
        assert.match(validateConfig({ repository: 'https://x/y.git', branch: 'main', directory: 'mindSkills' }).error ?? '', /plain folder name/);
        assert.match(validateConfig({ repository: 'https://x/y.git', branch: 3 }).error ?? '', /"branch" must be a string/);
        assert.match(validateConfig([]).error ?? '', /JSON object/);
    });
});

describe('parseConfig', () => {
    test('reports invalid JSON', () => {
        assert.match(parseConfig('{ nope').error ?? '', /not valid JSON/);
    });
});

describe('readConfig / writeConfig', () => {
    test('a missing file is reported as not existing', async () => {
        const result = await readConfig(sandbox.path('empty'));
        assert.equal(result.exists, false);
    });

    test('writes, reads back and preserves unknown keys', async () => {
        const folder = sandbox.path('pool');
        sandbox.write('pool/config.json', JSON.stringify({ team: 'acme', repository: 'old', branch: 'x', tag: 'v0' }));
        const config = await writeConfig(folder, { repository: ' https://example.com/acme/skills.git ', branch: 'main', tag: '' });
        assert.equal(config.directory, 'skills');
        const raw = JSON.parse(readFileSync(sandbox.path('pool/config.json'), 'utf8'));
        assert.deepEqual(raw, { team: 'acme', repository: 'https://example.com/acme/skills.git', branch: 'main' });
        const read = await readConfig(folder);
        assert.equal(read.exists, true);
        assert.equal(read.config?.repository, 'https://example.com/acme/skills.git');
        assert.equal(typeof read.text, 'string');
    });

    test('writes linkSkillsTo as a string for one folder, a list for more, and drops it when empty', async () => {
        const folder = sandbox.path('pool-links');
        const values = { repository: 'https://example.com/acme/skills.git', branch: 'main' };
        const raw = (): Record<string, unknown> => JSON.parse(readFileSync(path.join(folder, 'config.json'), 'utf8'));
        const one = await writeConfig(folder, { ...values, linkSkillsTo: ['~/.claude/skills'] });
        assert.deepEqual(one.linkSkillsTo, ['~/.claude/skills']);
        assert.equal(raw()['linkSkillsTo'], '~/.claude/skills');
        await writeConfig(folder, { ...values, linkSkillsTo: ['~/.claude/skills', '~/.codex/skills'] });
        assert.deepEqual(raw()['linkSkillsTo'], ['~/.claude/skills', '~/.codex/skills']);
        await writeConfig(folder, { ...values, linkSkillsTo: [] });
        assert.equal('linkSkillsTo' in raw(), false);
    });

    test('refuses to write an invalid config', async () => {
        await assert.rejects(writeConfig(sandbox.path('pool2'), { repository: '', branch: 'main' }), /Repository URL is required/);
    });
});

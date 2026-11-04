import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, test } from 'node:test';
import { createManifest, describeSpec, parseManifest, parseSkillSpec, readManifest, removeSkill, specToJson, upsertSkill } from '../../VsCodeExtension/core/manifest.ts';
import { Sandbox, skillJson } from '../helpers.ts';

const sandbox = new Sandbox();
after(() => sandbox.cleanup());

describe('parseSkillSpec', () => {
    test('string shorthand: url, url#ref and url#range', () => {
        assert.deepEqual(parseSkillSpec('https://x/a.git').spec, { repository: 'https://x/a.git', kind: 'default' });
        assert.deepEqual(parseSkillSpec('https://x/a.git#develop').spec, { repository: 'https://x/a.git', kind: 'ref', value: 'develop' });
        assert.deepEqual(parseSkillSpec('https://x/a.git#v1.2.0').spec, { repository: 'https://x/a.git', kind: 'ref', value: 'v1.2.0' });
        assert.deepEqual(parseSkillSpec('git@host:a.git#^1.2.0').spec, { repository: 'git@host:a.git', kind: 'version', value: '^1.2.0' });
    });

    test('object form', () => {
        assert.deepEqual(parseSkillSpec({ repository: 'https://x/a.git', branch: 'main' }).spec, { repository: 'https://x/a.git', kind: 'branch', value: 'main' });
        assert.deepEqual(parseSkillSpec({ repository: 'https://x/a.git', tag: 'v2.0.0' }).spec, { repository: 'https://x/a.git', kind: 'tag', value: 'v2.0.0' });
        assert.deepEqual(parseSkillSpec({ repository: 'https://x/a.git', version: '~1.4' }).spec, { repository: 'https://x/a.git', kind: 'version', value: '~1.4' });
        assert.deepEqual(parseSkillSpec({ repository: 'https://x/a.git' }).spec, { repository: 'https://x/a.git', kind: 'default' });
    });

    test('errors', () => {
        assert.match(parseSkillSpec({ repository: 'https://x/a.git', tag: 'v1', branch: 'main' }).error ?? '', /only one of/);
        assert.match(parseSkillSpec({ repository: 'https://x/a.git', version: 'banana' }).error ?? '', /semver range/);
        assert.match(parseSkillSpec({ repository: '-oops' }).error ?? '', /must not start/);
        assert.match(parseSkillSpec({ repository: 'https://x/a.git', branch: 7 }).error ?? '', /must be a string/);
        assert.match(parseSkillSpec(42).error ?? '', /expected a git URL/);
        assert.match(parseSkillSpec('https://x/a.git#bad ref').error ?? '', /not a valid git ref/);
    });

    test('specToJson round-trips through parseSkillSpec', () => {
        const specs = [
            { repository: 'https://x/a.git', kind: 'default' as const },
            { repository: 'https://x/a.git', kind: 'branch' as const, value: 'dev' },
            { repository: 'https://x/a.git', kind: 'tag' as const, value: 'v1.0.0' },
            { repository: 'https://x/a.git', kind: 'version' as const, value: '^1.0.0' },
            { repository: 'https://x/a.git', kind: 'ref' as const, value: 'stable' },
        ];
        for (const spec of specs) {
            assert.deepEqual(parseSkillSpec(specToJson(spec)).spec, spec);
        }
    });

    test('describeSpec', () => {
        assert.equal(describeSpec({ repository: 'u', kind: 'version', value: '^2' }), 'version ^2');
        assert.equal(describeSpec({ repository: 'u', kind: 'default' }), 'default branch');
        assert.equal(describeSpec(undefined), '');
    });
});

describe('parseManifest', () => {
    test('collects valid and invalid entries without failing the whole file', () => {
        const result = parseManifest(
            skillJson({
                good: 'https://x/good.git',
                '../escape': 'https://x/evil.git',
                broken: { repository: 'https://x/b.git', version: 'nope' },
            }),
        );
        assert.equal(result.manifest?.name, 'team-skills');
        const entries = result.manifest?.entries ?? [];
        assert.equal(entries.length, 3);
        assert.equal(entries[0]?.spec?.kind, 'default');
        assert.match(entries[1]?.error ?? '', /not a valid skill name/);
        assert.match(entries[2]?.error ?? '', /semver range/);
    });

    test('file-level errors', () => {
        assert.match(parseManifest('[').error ?? '', /not valid JSON/);
        assert.match(parseManifest('[]').error ?? '', /JSON object/);
        assert.match(parseManifest('{"skills": []}').error ?? '', /"skills" must be an object/);
        assert.deepEqual(parseManifest('{}').manifest?.entries, []);
    });
});

describe('editing skill.json', () => {
    test('create, add, replace and remove skills while preserving other keys', async () => {
        const repo = sandbox.path('repo');
        sandbox.write('repo/.keep', '');
        assert.equal((await readManifest(repo)).exists, false);
        await createManifest(repo, 'acme');
        const created = JSON.parse(readFileSync(sandbox.path('repo/skill.json'), 'utf8'));
        assert.equal(created.name, 'acme');
        assert.deepEqual(created.skills, {});

        sandbox.write('repo/skill.json', JSON.stringify({ name: 'acme', custom: { keep: true }, skills: { first: 'https://x/first.git' } }));
        await upsertSkill(repo, 'second', { repository: 'https://x/second.git', kind: 'version', value: '^1.0.0' });
        await upsertSkill(repo, 'first', { repository: 'https://x/first.git', kind: 'branch', value: 'dev' });
        let raw = JSON.parse(readFileSync(sandbox.path('repo/skill.json'), 'utf8'));
        assert.deepEqual(raw.custom, { keep: true });
        assert.deepEqual(Object.keys(raw.skills), ['first', 'second']);
        assert.deepEqual(raw.skills.first, { repository: 'https://x/first.git', branch: 'dev' });
        assert.deepEqual(raw.skills.second, { repository: 'https://x/second.git', version: '^1.0.0' });

        assert.equal(await removeSkill(repo, 'first'), true);
        assert.equal(await removeSkill(repo, 'first'), false);
        raw = JSON.parse(readFileSync(sandbox.path('repo/skill.json'), 'utf8'));
        assert.deepEqual(Object.keys(raw.skills), ['second']);
        assert.ok(readFileSync(sandbox.path('repo/skill.json'), 'utf8').endsWith('}\n'));
    });

    test('upsertSkill validates name and spec', async () => {
        const repo = sandbox.path('repo2');
        sandbox.write('repo2/.keep', '');
        await assert.rejects(upsertSkill(repo, '../x', { repository: 'https://x/a.git', kind: 'default' }), /not a valid skill name/);
        await assert.rejects(upsertSkill(repo, 'ok', { repository: 'https://x/a.git', kind: 'tag', value: 'bad tag' }), /not a valid git ref/);
    });
});

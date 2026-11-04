import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RemoteRefs } from '../../VsCodeExtension/core/git.ts';
import { remoteInfoFromRefs, resolveSpec } from '../../VsCodeExtension/core/skillManager.ts';

const sha = (c: string): string => c.repeat(40);

const refs: RemoteRefs = {
    head: sha('a'),
    defaultBranch: 'main',
    branches: new Map([
        ['main', sha('a')],
        ['develop', sha('b')],
    ]),
    tags: new Map([
        ['v1.0.0', sha('1')],
        ['v1.1.0', sha('2')],
        ['v1.2.0', sha('3')],
        ['v2.0.0', sha('4')],
        ['v3.0.0-beta.1', sha('5')],
        ['stable', sha('6')],
    ]),
};

describe('resolveSpec', () => {
    test('default branch', () => {
        assert.deepEqual(resolveSpec({ repository: 'u', kind: 'default' }, refs), { commit: sha('a'), fetchRef: 'HEAD', label: 'main' });
    });

    test('branch', () => {
        assert.deepEqual(resolveSpec({ repository: 'u', kind: 'branch', value: 'develop' }, refs), { commit: sha('b'), fetchRef: 'refs/heads/develop', label: 'develop' });
        assert.throws(() => resolveSpec({ repository: 'u', kind: 'branch', value: 'nope' }, refs), /Branch "nope" not found. Available: main, develop/);
    });

    test('pinned tag reports newer releases but stays pinned', () => {
        const resolved = resolveSpec({ repository: 'u', kind: 'tag', value: 'v1.1.0' }, refs);
        assert.equal(resolved.commit, sha('2'));
        assert.equal(resolved.fetchRef, 'refs/tags/v1.1.0');
        assert.equal(resolved.newerVersion, 'v2.0.0');
    });

    test('tag lookup tolerates a missing v prefix', () => {
        assert.equal(resolveSpec({ repository: 'u', kind: 'tag', value: '1.2.0' }, refs).label, 'v1.2.0');
        assert.throws(() => resolveSpec({ repository: 'u', kind: 'tag', value: 'v9.9.9' }, refs), /Tag "v9.9.9" not found/);
    });

    test('semver range picks the highest match and reports versions outside the range', () => {
        const resolved = resolveSpec({ repository: 'u', kind: 'version', value: '^1.0.0' }, refs);
        assert.equal(resolved.label, 'v1.2.0');
        assert.equal(resolved.commit, sha('3'));
        assert.equal(resolved.newerVersion, 'v2.0.0');
        assert.equal(resolveSpec({ repository: 'u', kind: 'version', value: '*' }, refs).label, 'v2.0.0', 'prereleases are skipped');
        assert.throws(() => resolveSpec({ repository: 'u', kind: 'version', value: '^4.0.0' }, refs), /No tag matches "\^4.0.0" \(latest is v2.0.0\)/);
    });

    test('shorthand ref prefers tags, then branches', () => {
        assert.equal(resolveSpec({ repository: 'u', kind: 'ref', value: 'stable' }, refs).fetchRef, 'refs/tags/stable');
        assert.equal(resolveSpec({ repository: 'u', kind: 'ref', value: 'develop' }, refs).fetchRef, 'refs/heads/develop');
        assert.throws(() => resolveSpec({ repository: 'u', kind: 'ref', value: 'ghost' }, refs), /neither a tag nor a branch/);
    });

    test('empty repositories', () => {
        assert.throws(() => resolveSpec({ repository: 'u', kind: 'default' }, { branches: new Map(), tags: new Map() }), /empty/);
    });
});

describe('remoteInfoFromRefs', () => {
    test('sorts the default branch first and versions newest first', () => {
        const info = remoteInfoFromRefs(refs);
        assert.equal(info.ok, true);
        assert.deepEqual(info.branches, ['main', 'develop']);
        assert.deepEqual(info.tags.slice(0, 4), ['v2.0.0', 'v1.2.0', 'v1.1.0', 'v1.0.0']);
        assert.ok(info.tags.includes('stable'));
        assert.equal(info.latestVersion, 'v2.0.0');
    });
});

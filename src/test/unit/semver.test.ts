import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
    compareVersions,
    isValidRange,
    latestStable,
    looksLikeRange,
    maxSatisfying,
    newerStable,
    parseVersion,
    satisfies,
} from '../../VsCodeExtension/core/semver.ts';

describe('parseVersion', () => {
    test('parses plain and v-prefixed versions', () => {
        assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [], raw: '1.2.3' });
        assert.equal(parseVersion('v10.0.1')?.major, 10);
        assert.deepEqual(parseVersion('2.0.0-beta.4')?.prerelease, ['beta', 4]);
        assert.equal(parseVersion('1.0.0+build.7')?.patch, 0);
    });

    test('rejects non versions', () => {
        for (const bad of ['', 'main', '1.2', '01.2.3', 'v1.2.3.4', 'release-1.0.0']) {
            assert.equal(parseVersion(bad), undefined, bad);
        }
    });
});

describe('compareVersions', () => {
    const order = ['0.9.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
    test('follows the semver precedence rules', () => {
        for (let i = 0; i < order.length - 1; i++) {
            const a = parseVersion(order[i] as string);
            const b = parseVersion(order[i + 1] as string);
            assert.ok(a && b);
            assert.equal(compareVersions(a, b), -1, `${order[i]} < ${order[i + 1]}`);
            assert.equal(compareVersions(b, a), 1);
        }
        assert.equal(compareVersions(parseVersion('v1.2.3')!, parseVersion('1.2.3')!), 0);
    });
});

describe('satisfies', () => {
    const cases: [string, string, boolean][] = [
        ['1.2.3', '1.2.3', true],
        ['1.2.4', '1.2.3', false],
        ['1.9.0', '^1.2.3', true],
        ['2.0.0', '^1.2.3', false],
        ['1.2.2', '^1.2.3', false],
        ['0.2.9', '^0.2.3', true],
        ['0.3.0', '^0.2.3', false],
        ['0.0.3', '^0.0.3', true],
        ['0.0.4', '^0.0.3', false],
        ['1.2.9', '~1.2.3', true],
        ['1.3.0', '~1.2.3', false],
        ['1.9.9', '~1', true],
        ['1.4.0', '1.x', true],
        ['2.0.0', '1.x', false],
        ['1.2.7', '1.2.x', true],
        ['1.3.0', '1.2', false],
        ['5.0.0', '*', true],
        ['3.1.0', '>=2.0.0 <4.0.0', true],
        ['4.0.0', '>=2.0.0 <4.0.0', false],
        ['2.0.0', '>1.2', true],
        ['1.2.9', '>1.2', false],
        ['1.2.9', '<=1.2', true],
        ['1.3.0', '<=1.2', false],
        ['1.5.0', '1.0.0 - 2.0.0', true],
        ['2.0.1', '1.0.0 - 2.0.0', false],
        ['2.3.9', '1.0 - 2.3', true],
        ['2.4.0', '1.0 - 2.3', false],
        ['3.2.0', '^1.0.0 || ^3.0.0', true],
        ['2.2.0', '^1.0.0 || ^3.0.0', false],
        ['v1.4.0', '^1.0.0', true],
        ['1.2.0', '>= 1.0.0', true],
    ];
    for (const [version, range, expected] of cases) {
        test(`${version} ${expected ? 'satisfies' : 'does not satisfy'} "${range}"`, () => {
            assert.equal(satisfies(version, range), expected);
        });
    }

    test('prereleases only match when the range opts in on the same tuple', () => {
        assert.equal(satisfies('1.5.0-beta.1', '^1.0.0'), false);
        assert.equal(satisfies('1.0.0-beta.2', '>=1.0.0-beta.1 <2.0.0'), true);
        assert.equal(satisfies('2.0.0-alpha', '^1.0.0'), false);
        assert.equal(satisfies('3.0.0-rc.1', '*'), false);
    });

    test('invalid input never matches', () => {
        assert.equal(satisfies('not-a-version', '^1.0.0'), false);
        assert.equal(satisfies('1.0.0', '^^1'), false);
    });
});

describe('range helpers', () => {
    test('isValidRange', () => {
        for (const ok of ['^1.0.0', '~1.2', '>=1 <2', '1.x', '*', '1.0.0 - 2.0.0', '^1 || ^2', 'latest', '']) {
            assert.equal(isValidRange(ok), true, ok);
        }
        for (const bad of ['main', 'v1.2.3.4', '^^1', '>=a']) {
            assert.equal(isValidRange(bad), false, bad);
        }
    });

    test('looksLikeRange distinguishes ranges from tag/branch names', () => {
        for (const range of ['^1.2.0', '~1.0', '>=2', '1.x', '*', '1.0.0 - 2.0.0', '^1 || ^2']) {
            assert.equal(looksLikeRange(range), true, range);
        }
        for (const ref of ['main', 'v1.2.0', '1.2.3', 'feature/x', 'release-2024']) {
            assert.equal(looksLikeRange(ref), false, ref);
        }
    });

    const tags = ['v1.0.0', 'v1.2.0', 'v1.10.0', 'v2.0.0-beta.1', 'v2.0.0', 'nightly', '0.9.0'];

    test('maxSatisfying returns the highest matching tag in its original spelling', () => {
        assert.equal(maxSatisfying(tags, '^1.0.0'), 'v1.10.0');
        assert.equal(maxSatisfying(tags, '~1.2.0'), 'v1.2.0');
        assert.equal(maxSatisfying(tags, '>=2'), 'v2.0.0');
        assert.equal(maxSatisfying(tags, '^3.0.0'), undefined);
        assert.equal(maxSatisfying(tags, '<1.0.0'), '0.9.0');
    });

    test('latestStable and newerStable ignore prereleases and non-versions', () => {
        assert.equal(latestStable(tags), 'v2.0.0');
        assert.deepEqual(newerStable(tags, 'v1.2.0'), ['v2.0.0', 'v1.10.0']);
        assert.deepEqual(newerStable(tags, 'v2.0.0'), []);
        assert.deepEqual(newerStable(tags, 'nightly'), []);
    });
});

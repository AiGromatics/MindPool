import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createGit, GitError, parseLeftRight, parseLsRemote, parseStatusZ, summarizeGitError } from '../../VsCodeExtension/core/git.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);

describe('parseLsRemote', () => {
    test('reads the default branch, branches and peeled tags', () => {
        const output = [
            'ref: refs/heads/main\tHEAD',
            `${A}\tHEAD`,
            `${A}\trefs/heads/main`,
            `${B}\trefs/heads/develop`,
            `${C}\trefs/tags/v1.0.0`,
            `${D}\trefs/tags/v1.0.0^{}`,
            `${B}\trefs/tags/lightweight`,
            '',
        ].join('\n');
        const refs = parseLsRemote(output);
        assert.equal(refs.defaultBranch, 'main');
        assert.equal(refs.head, A);
        assert.deepEqual([...refs.branches], [['main', A], ['develop', B]]);
        assert.equal(refs.tags.get('v1.0.0'), D, 'annotated tags resolve to their commit');
        assert.equal(refs.tags.get('lightweight'), B);
    });

    test('falls back to the default branch commit when HEAD has no sha line', () => {
        const refs = parseLsRemote(`ref: refs/heads/trunk\tHEAD\n${C}\trefs/heads/trunk\n`);
        assert.equal(refs.head, C);
    });

    test('handles an empty repository', () => {
        const refs = parseLsRemote('');
        assert.equal(refs.head, undefined);
        assert.equal(refs.branches.size, 0);
    });
});

describe('parseStatusZ', () => {
    test('classifies porcelain v1 -z entries, including renames', () => {
        const output = [' M skill.json', 'A  new.md', ' D gone.md', 'R  renamed.md', 'old-name.md', '?? notes/todo.md', 'UU conflict.md', ''].join('\0');
        const changes = parseStatusZ(output);
        assert.deepEqual(
            changes.map((c) => [c.kind, c.path, c.staged, c.origPath]),
            [
                ['modified', 'skill.json', false, undefined],
                ['added', 'new.md', true, undefined],
                ['deleted', 'gone.md', false, undefined],
                ['renamed', 'renamed.md', true, 'old-name.md'],
                ['untracked', 'notes/todo.md', false, undefined],
                ['conflicted', 'conflict.md', true, undefined],
            ],
        );
    });

    test('keeps spaces and unicode in paths', () => {
        const [change] = parseStatusZ('?? my skills/日本語 file.md\0');
        assert.equal(change?.path, 'my skills/日本語 file.md');
    });
});

describe('small git helpers', () => {
    test('parseLeftRight', () => {
        assert.deepEqual(parseLeftRight('2\t5\n'), { ahead: 2, behind: 5 });
        assert.deepEqual(parseLeftRight(''), { ahead: 0, behind: 0 });
    });

    test('summarizeGitError strips noise and prefixes', () => {
        const stderr = "Cloning into 'x'...\nhint: some hint\nfatal: repository 'https://example.invalid/x.git/' not found\n";
        assert.equal(summarizeGitError(stderr, 'fallback'), "repository 'https://example.invalid/x.git/' not found");
        assert.equal(summarizeGitError('', 'fallback'), 'fallback');
    });

    test('createGit runs git and reports failures as GitError', async () => {
        const run = createGit();
        assert.match(await run(['--version']), /git version/);
        await assert.rejects(run(['definitely-not-a-command']), (error: unknown) => error instanceof GitError && error.args[0] === 'definitely-not-a-command');
    });

    test('createGit gives a clear message when git is missing', async () => {
        const run = createGit({ gitPath: '/nonexistent/git-binary' });
        await assert.rejects(run(['--version']), /Git executable not found/);
    });
});

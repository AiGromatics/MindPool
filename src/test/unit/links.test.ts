import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync } from 'node:fs';
import * as path from 'node:path';
import { after, describe, test } from 'node:test';
import { findSkillFolders, LINK_STATE_FILE, resolveLinkTargets, syncSkillLinks } from '../../VsCodeExtension/core/links.ts';
import { Sandbox } from '../helpers.ts';

const sandbox = new Sandbox('mindpool-links-');
after(() => sandbox.cleanup());
let counter = 0;

/** A fresh mindSkills folder with the given files, and an empty link folder next to it. */
function layout(files: Record<string, string>): { skillsDir: string; target: string; dir: (name: string) => string } {
    const id = `l${++counter}`;
    for (const [file, content] of Object.entries(files)) {
        sandbox.write(path.join(id, 'team', 'mindSkills', file), content);
    }
    const skillsDir = sandbox.path(id, 'team', 'mindSkills');
    mkdirSync(skillsDir, { recursive: true });
    return { skillsDir, target: sandbox.path(id, 'home', '.claude', 'skills'), dir: (name) => path.join(skillsDir, name) };
}

const isLink = (p: string): boolean => existsSync(p) && lstatSync(p).isSymbolicLink();

describe('findSkillFolders', () => {
    test('a SKILL.md at the root is one skill, linked under its skill.json name', async () => {
        const l = layout({ 'nskill/SKILL.md': '# n\n', 'nskill/skills/inner/SKILL.md': '# ignored\n' });
        assert.deepEqual(await findSkillFolders('nskill', l.dir('nskill')), [{ linkName: 'nskill', dir: l.dir('nskill'), skill: 'nskill' }]);
    });

    test('the plugin layout links every skills/<name>/ (superpowers)', async () => {
        const l = layout({
            'superpowers/README.md': '# sp\n',
            'superpowers/skills/writing-plans/SKILL.md': '# wp\n',
            'superpowers/skills/brainstorming/SKILL.md': '# b\n',
            'superpowers/skills/notes/README.md': 'not a skill\n',
            'superpowers/docs/SKILL.md': 'skills/ wins over other folders\n',
        });
        const found = await findSkillFolders('superpowers', l.dir('superpowers'));
        assert.deepEqual(
            found.map((f) => [f.linkName, path.relative(l.skillsDir, f.dir)]),
            [
                ['brainstorming', path.join('superpowers', 'skills', 'brainstorming')],
                ['writing-plans', path.join('superpowers', 'skills', 'writing-plans')],
            ],
        );
    });

    test('a plain collection links its direct sub-folders; dot folders and a lowercase skill.md are handled', async () => {
        const l = layout({ 'pack/pdf/skill.md': '# pdf\n', 'pack/.hidden/SKILL.md': '# no\n', 'pack/xlsx/SKILL.md': '# xlsx\n' });
        assert.deepEqual((await findSkillFolders('pack', l.dir('pack'))).map((f) => f.linkName), ['pdf', 'xlsx']);
    });

    test('nothing found, or a missing folder, gives an empty list', async () => {
        const l = layout({ 'empty/README.md': '# nothing\n' });
        assert.deepEqual(await findSkillFolders('empty', l.dir('empty')), []);
        assert.deepEqual(await findSkillFolders('missing', l.dir('missing')), []);
    });
});

describe('resolveLinkTargets', () => {
    const options = { poolFolder: '/pool', repoDir: '/pool/team', home: '/home/me' };

    test('expands ~ and ${userHome}, resolves relative paths from the pool folder and drops duplicates', () => {
        const result = resolveLinkTargets(['~/.claude/skills', '${userHome}/.claude/skills', '.', 'links', '/abs/skills'], options);
        assert.deepEqual(result.targets, [path.resolve('/home/me/.claude/skills'), path.resolve('/pool'), path.resolve('/pool/links'), path.resolve('/abs/skills')]);
        assert.deepEqual(result.problems, []);
    });

    test('refuses folders inside the team repository and ${workspaceFolder}', () => {
        const result = resolveLinkTargets(['team/links', '/pool/team', '${workspaceFolder}/.claude/skills'], options);
        assert.deepEqual(result.targets, []);
        assert.equal(result.problems.length, 3);
        assert.match(result.problems[0] ?? '', /inside the team repository/);
        assert.match(result.problems[2] ?? '', /workspaceFolder/);
    });
});

describe('syncSkillLinks', () => {
    test('links every skill, then keeps the links as they are on the next run', async () => {
        const l = layout({ 'nskill/SKILL.md': '# n\n', 'superpowers/skills/brainstorming/SKILL.md': '# b\n' });
        const skills = [
            { name: 'nskill', dir: l.dir('nskill') },
            { name: 'superpowers', dir: l.dir('superpowers') },
        ];
        const first = await syncSkillLinks({ skillsDir: l.skillsDir, targets: [l.target], skills });
        assert.deepEqual(first.problems, []);
        assert.deepEqual(first.targets, [{ path: l.target, linked: 2 }]);
        assert.deepEqual(first.created.map((p) => path.basename(p)).sort(), ['brainstorming', 'nskill']);
        assert.equal(readFileSync(path.join(l.target, 'nskill', 'SKILL.md'), 'utf8'), '# n\n', 'the link opens the skill');
        assert.equal(readFileSync(path.join(l.target, 'brainstorming', 'SKILL.md'), 'utf8'), '# b\n');
        assert.equal(readlinkSync(path.join(l.target, 'nskill')), l.dir('nskill'));

        const second = await syncSkillLinks({ skillsDir: l.skillsDir, targets: [l.target], skills });
        assert.deepEqual([second.created, second.removed, second.problems], [[], [], []]);
        assert.deepEqual(second.targets, [{ path: l.target, linked: 2 }]);
    });

    test('never replaces a real folder or a link that MindPool did not make', async () => {
        const l = layout({ 'mine/SKILL.md': '# mine\n', 'theirs/SKILL.md': '# theirs\n', 'ok/SKILL.md': '# ok\n' });
        sandbox.write(path.relative(sandbox.root, path.join(l.target, 'mine', 'SKILL.md')), '# my own copy\n');
        const elsewhere = sandbox.path(`elsewhere-${counter}`);
        mkdirSync(elsewhere, { recursive: true });
        symlinkSync(elsewhere, path.join(l.target, 'theirs'), 'dir');

        const result = await syncSkillLinks({
            skillsDir: l.skillsDir,
            targets: [l.target],
            skills: ['mine', 'theirs', 'ok'].map((name) => ({ name, dir: l.dir(name) })),
        });
        assert.equal(result.problems.length, 2);
        assert.ok(result.problems.every((p) => /already exists and was not made by MindPool/.test(p)));
        assert.equal(readFileSync(path.join(l.target, 'mine', 'SKILL.md'), 'utf8'), '# my own copy\n', 'real folder untouched');
        assert.equal(readlinkSync(path.join(l.target, 'theirs')), elsewhere, 'foreign link untouched');
        assert.ok(isLink(path.join(l.target, 'ok')));
        assert.deepEqual(result.targets, [{ path: l.target, linked: 1 }]);
    });

    test('removes links to skills that are gone, even dangling ones, and repoints moved skills', async () => {
        const l = layout({ 'keep/SKILL.md': '# keep\n', 'gone/SKILL.md': '# gone\n', 'moved/SKILL.md': '# moved\n' });
        await syncSkillLinks({ skillsDir: l.skillsDir, targets: [l.target], skills: ['keep', 'gone', 'moved'].map((name) => ({ name, dir: l.dir(name) })) });
        sandbox.write(path.relative(sandbox.root, path.join(l.skillsDir, 'other', 'SKILL.md')), '# moved here\n');

        const result = await syncSkillLinks({
            skillsDir: l.skillsDir,
            targets: [l.target],
            skills: [
                { name: 'keep', dir: l.dir('keep') },
                { name: 'moved', dir: l.dir('other') },
            ],
        });
        // `moved` is now its own entry with a root SKILL.md under the name "moved" → repointed.
        assert.equal(isLink(path.join(l.target, 'gone')), false);
        assert.equal(readlinkSync(path.join(l.target, 'moved')), l.dir('other'));
        assert.deepEqual(result.removed.map((p) => path.basename(p)).sort(), ['gone', 'moved']);
        assert.deepEqual(result.created.map((p) => path.basename(p)), ['moved']);
    });

    test('reports skills without SKILL.md and name clashes (the first skill wins)', async () => {
        const l = layout({ 'plain/README.md': '# no skill\n', 'a/skills/shared/SKILL.md': '# a\n', 'b/skills/shared/SKILL.md': '# b\n' });
        const result = await syncSkillLinks({ skillsDir: l.skillsDir, targets: [l.target], skills: ['plain', 'a', 'b'].map((name) => ({ name, dir: l.dir(name) })) });
        assert.match(result.problems[0] ?? '', /"plain" has no SKILL.md/);
        assert.match(result.problems[1] ?? '', /"shared" is in both a and b; the link points to a/);
        assert.equal(readFileSync(path.join(l.target, 'shared', 'SKILL.md'), 'utf8'), '# a\n');
    });

    test('cleans up a folder that is no longer configured, and forgets it', async () => {
        const l = layout({ 'nskill/SKILL.md': '# n\n' });
        const second = path.join(path.dirname(l.target), 'other');
        const skills = [{ name: 'nskill', dir: l.dir('nskill') }];
        await syncSkillLinks({ skillsDir: l.skillsDir, targets: [l.target, second], skills });
        assert.ok(isLink(path.join(second, 'nskill')));
        assert.deepEqual(JSON.parse(readFileSync(path.join(l.skillsDir, LINK_STATE_FILE), 'utf8')), { targets: [l.target, second] });

        const narrowed = await syncSkillLinks({ skillsDir: l.skillsDir, targets: [l.target], skills });
        assert.equal(isLink(path.join(second, 'nskill')), false, 'links removed from the old folder');
        assert.ok(isLink(path.join(l.target, 'nskill')));
        assert.deepEqual(narrowed.removed, [path.join(second, 'nskill')]);

        await syncSkillLinks({ skillsDir: l.skillsDir, targets: [], skills: [] });
        assert.equal(isLink(path.join(l.target, 'nskill')), false);
        assert.equal(existsSync(path.join(l.skillsDir, LINK_STATE_FILE)), false);
    });
});

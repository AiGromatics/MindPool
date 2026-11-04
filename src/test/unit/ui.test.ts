import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PoolState, SkillStatus } from '../../VsCodeExtension/core/types.ts';
import { buildHtml, createNonce } from '../../VsCodeExtension/ui/html.ts';
import { icon, ICON_NAMES } from '../../VsCodeExtension/ui/icons.ts';
import { parseWebviewMessage } from '../../VsCodeExtension/ui/messages.ts';
import { esc, initialUiState, initials, renderApp, type UiState } from '../../VsCodeExtension/ui/render.ts';
import { overallStatus, prettyUrl, relativeTime, tildify } from '../../VsCodeExtension/ui/status.ts';

const NOW = new Date('2026-11-03T12:00:00Z');

function readyState(overrides: Partial<PoolState> = {}): PoolState {
    const skills: SkillStatus[] = [
        {
            name: 'code-review',
            spec: { repository: 'https://github.com/acme/code-review.git', kind: 'version', value: '^1.0.0' },
            path: '/pool/team/mindSkills/code-review',
            health: 'ok',
            installedCommit: 'a'.repeat(40),
            remoteCommit: 'a'.repeat(40),
            resolvedLabel: 'v1.2.0',
            newerVersion: 'v2.0.0',
        },
        {
            name: 'writer',
            spec: { repository: 'git@github.com:acme/writer.git', kind: 'default' },
            path: '/pool/team/mindSkills/writer',
            health: 'outdated',
            installedCommit: 'b'.repeat(40),
            remoteCommit: 'c'.repeat(40),
            resolvedLabel: 'main',
        },
    ];
    return {
        phase: 'ready',
        poolFolder: '/home/me/pool',
        config: { repository: 'https://github.com/acme/team-skills.git', branch: 'main', directory: 'team-skills' },
        repo: {
            path: '/home/me/pool/team-skills',
            cloned: true,
            branch: 'main',
            head: 'd'.repeat(40),
            detached: false,
            readOnly: false,
            ahead: 1,
            behind: 0,
            changes: [
                { path: 'skill.json', kind: 'modified', staged: false, code: ' M' },
                { path: 'docs/new skill.md', kind: 'untracked', staged: false, code: '??' },
            ],
            newerTags: [],
        },
        manifest: { exists: true, path: '/home/me/pool/team-skills/skill.json', name: 'team' },
        skills,
        orphans: [],
        skillsDir: '/home/me/pool/team-skills/mindSkills',
        lastSync: '2026-11-03T11:58:00Z',
        log: [{ time: '2026-11-03T11:58:00Z', level: 'success', message: 'Installed writer → main (bbbbbbb)' }],
        autoUpdateSkills: true,
        ...overrides,
    };
}

function ui(overrides: Partial<UiState> = {}): UiState {
    return { ...initialUiState(), home: '/home/me', ...overrides };
}

describe('renderApp', () => {
    test('loading state before the first message', () => {
        const html = renderApp(undefined, ui(), NOW);
        assert.match(html, /Waking up MindPool/);
        assert.match(html, /skeleton/);
    });

    test('welcome screen when no folder is configured', () => {
        const html = renderApp({ phase: 'noFolder', manifest: { exists: false }, skills: [], orphans: [], log: [], autoUpdateSkills: true }, ui(), NOW);
        assert.match(html, /Welcome to MindPool/);
        assert.match(html, /data-command="selectFolder"/);
    });

    test('connect form for a fresh pool folder, and errors for an invalid config', () => {
        const fresh = renderApp({ phase: 'noConfig', poolFolder: '/home/me/pool', manifest: { exists: false }, skills: [], orphans: [], log: [], autoUpdateSkills: true }, ui(), NOW);
        assert.match(fresh, /Connect your skills repository/);
        assert.match(fresh, /~\/pool/);
        assert.match(fresh, /Save &amp; clone/);
        assert.match(fresh, /id="cfg-save"[^>]* disabled/, 'save is disabled until a URL is typed');

        const invalid = renderApp(
            { phase: 'invalidConfig', poolFolder: '/p', configError: 'Branch is required.', configDraft: { repository: 'https://x/y.git' }, manifest: { exists: false }, skills: [], orphans: [], log: [], autoUpdateSkills: true },
            ui(),
            NOW,
        );
        assert.match(invalid, /config.json needs a fix/);
        assert.match(invalid, /value="https:\/\/x\/y.git"/);
    });

    test('ready dashboard: repository, changes, skills and activity', () => {
        const html = renderApp(readyState(), ui({ commitMessage: 'Add skill' }), NOW);
        assert.match(html, /github.com\/acme\/team-skills/);
        assert.match(html, /1 to push/);
        assert.match(html, /Synced 2m ago/);
        assert.match(html, /data-command="openInNewWindow"/);
        assert.match(html, /skill\.json/);
        assert.match(html, /2\/2 selected/);
        assert.doesNotMatch(html, /id="btn-commit"[^>]* disabled/, 'commit enabled with message + files');
        assert.match(html, /code-review/);
        assert.match(html, /v2.0.0 available/);
        assert.match(html, /update ready/);
        assert.match(html, /data-action="updateSkill" data-name="writer"/);
        assert.match(html, /Installed writer/);
        assert.match(html, /class="avatar hue-\d"/);
    });

    test('commit buttons are disabled without a message or without selected files', () => {
        assert.match(renderApp(readyState(), ui(), NOW), /id="btn-commit"[^>]* disabled/);
        const none = renderApp(readyState(), ui({ commitMessage: 'x', excluded: ['skill.json', 'docs/new skill.md'] }), NOW);
        assert.match(none, /id="btn-commit"[^>]* disabled/);
        assert.match(none, /0\/2 selected/);
    });

    test('pinned release: read-only, newer release banner, no add/remove', () => {
        const state = readyState();
        state.config = { ...state.config!, tag: 'v1.0.0' };
        state.repo = { ...state.repo!, tag: 'v1.0.0', readOnly: true, branch: undefined, detached: true, ahead: 0, changes: [], newerTags: ['v1.1.0'] };
        const html = renderApp(state, ui({ addingSkill: true }), NOW);
        assert.match(html, /read-only/);
        assert.match(html, /Release v1.1.0 is out/);
        assert.match(html, /data-action="useTag" data-tag="v1.1.0"/);
        assert.match(html, /data-command="push"[^>]* disabled/);
        assert.doesNotMatch(html, /data-action="removeSkill"/);
        assert.doesNotMatch(html, /Add a skill/);
    });

    test('escapes everything that comes from the repository', () => {
        const evil = '<img src=x onerror=alert(1)>';
        const state = readyState({
            skills: [{ name: evil, path: '/x', health: 'error', error: `<script>alert("e")</script>` }],
            log: [{ time: NOW.toISOString(), level: 'error', message: `"><svg onload=alert(2)>` }],
        });
        state.repo = { ...state.repo!, changes: [{ path: `a"b<c>.md`, kind: 'modified', staged: false, code: ' M' }] };
        const html = renderApp(state, ui({ commitMessage: '</textarea><script>x</script>' }), NOW);
        assert.doesNotMatch(html, /<img src=x/);
        assert.doesNotMatch(html, /<script>/);
        assert.doesNotMatch(html, /<svg onload/);
        assert.doesNotMatch(html, /<\/textarea><script>/);
        assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
        assert.match(html, /data-path="a&quot;b&lt;c&gt;.md"/);
    });

    test('empty states: no skill.json, no skills, orphans, clean tree', () => {
        const noManifest = renderApp(readyState({ manifest: { exists: false }, skills: [] }), ui(), NOW);
        assert.match(noManifest, /Create skill.json/);
        const empty = readyState({ skills: [], orphans: ['old-skill'] });
        empty.repo = { ...empty.repo!, changes: [], ahead: 2 };
        const html = renderApp(empty, ui(), NOW);
        assert.match(html, /No skills yet/);
        assert.match(html, /old-skill/);
        assert.match(html, /data-command="pruneOrphans"/);
        assert.match(html, /Working tree clean/);
        assert.match(html, /2 commits<\/b> waiting to be pushed/);
    });

    test('add-skill form adapts to the selected version mode', () => {
        const base = initialUiState().skillDraft;
        const html = renderApp(readyState(), ui({ addingSkill: true, skillDraft: { ...base, kind: 'version', repository: 'https://x/y.git', name: 'y' } }), NOW);
        assert.match(html, /Add a skill/);
        assert.match(html, /aria-checked="true" class="seg active" data-action="skillKind" data-kind="version"/);
        assert.match(html, /Semver range/);
        assert.match(html, /id="skill-add"[^>]* disabled/, 'a range value is required');
        const latest = renderApp(readyState(), ui({ addingSkill: true, skillDraft: { ...base, repository: 'https://x/y.git', name: 'y' } }), NOW);
        assert.doesNotMatch(latest, /id="skill-add"[^>]* disabled/);
    });

    test('filter box appears for long skill lists and filters', () => {
        const many = Array.from({ length: 7 }, (_, i): SkillStatus => ({ name: `skill-${i}`, path: `/x/${i}`, health: 'ok', spec: { repository: `https://x/s${i}.git`, kind: 'default' } }));
        const html = renderApp(readyState({ skills: many }), ui({ filter: 'skill-3' }), NOW);
        assert.match(html, /Filter skills/);
        assert.match(html, /data-skill="skill-3"/);
        assert.doesNotMatch(html, /data-skill="skill-4"/);
    });

    test('collapsed sections only render their header', () => {
        const html = renderApp(readyState(), ui({ collapsed: ['skills'] }), NOW);
        assert.match(html, /data-section="skills"/);
        assert.doesNotMatch(html, /data-skill="code-review"/);
    });
});

describe('overallStatus', () => {
    test('picks the most important thing to say', () => {
        assert.equal(overallStatus(undefined).tone, 'busy');
        assert.equal(overallStatus(readyState({ busy: 'Syncing' })).label, 'Syncing');
        assert.equal(overallStatus(readyState()).label, 'Updates available');
        const synced = readyState({ skills: [] });
        synced.repo = { ...synced.repo!, ahead: 0, changes: [] };
        assert.equal(overallStatus(synced).tone, 'ok');
        const local = readyState({ skills: [] });
        assert.equal(overallStatus(local).label, 'Local changes');
        const offline = readyState({ skills: [] });
        offline.repo = { ...offline.repo!, upstreamError: 'could not resolve host' };
        assert.equal(overallStatus(offline).label, 'Offline');
        assert.equal(overallStatus(readyState({ lastError: 'boom' })).tone, 'error');
        assert.equal(overallStatus(readyState({ phase: 'invalidConfig', configError: 'x' })).tone, 'error');
    });
});

describe('formatting helpers', () => {
    test('relativeTime', () => {
        assert.equal(relativeTime(undefined, NOW), 'never');
        assert.equal(relativeTime('2026-11-03T11:59:50Z', NOW), 'just now');
        assert.equal(relativeTime('2026-11-03T11:45:00Z', NOW), '15m ago');
        assert.equal(relativeTime('2026-11-03T09:00:00Z', NOW), '3h ago');
        assert.equal(relativeTime('2026-10-30T12:00:00Z', NOW), '4d ago');
    });

    test('prettyUrl, tildify, initials, esc', () => {
        assert.equal(prettyUrl('https://github.com/acme/skills.git'), 'github.com/acme/skills');
        assert.equal(prettyUrl('git@github.com:acme/skills.git'), 'github.com/acme/skills');
        assert.equal(prettyUrl('ssh://git@host:2222/x.git'), 'host:2222/x');
        assert.equal(tildify('/home/me/pool', '/home/me'), '~/pool');
        assert.equal(tildify('/home/meow', '/home/me'), '/home/meow');
        assert.equal(initials('code-review'), 'CR');
        assert.equal(initials('writer'), 'WR');
        assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    });

    test('every icon renders as an accessible, theme-aware svg', () => {
        for (const name of ICON_NAMES) {
            const svg = icon(name);
            assert.match(svg, /^<svg class="icon icon-[a-zA-Z]+" viewBox="0 0 24 24"/);
            assert.match(svg, /stroke="currentColor"/);
            assert.match(svg, /aria-hidden="true"/);
        }
    });
});

describe('webview shell', () => {
    test('strict CSP with a nonce, inline script escaped', () => {
        const nonce = createNonce();
        assert.match(nonce, /^[A-Za-z0-9]{32}$/);
        assert.notEqual(createNonce(), nonce);
        const html = buildHtml({ nonce, cspSource: 'vscode-resource:', script: 'console.log("</script><b>")' });
        assert.match(html, new RegExp(`script-src 'nonce-${nonce}'`));
        assert.match(html, /default-src 'none'/);
        assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
        assert.match(html, /<\\\/script><b>/);
        assert.equal(html.match(/<\/script>/g)?.length, 1, 'only the real closing tag');
        assert.match(html, /<div id="app">/);
    });
});

describe('parseWebviewMessage', () => {
    test('accepts well-formed messages', () => {
        assert.deepEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
        assert.deepEqual(parseWebviewMessage({ type: 'run', command: 'sync' }), { type: 'run', command: 'sync' });
        assert.deepEqual(parseWebviewMessage({ type: 'commit', message: 'm', files: ['a'], push: true }), { type: 'commit', message: 'm', files: ['a'], push: true });
        assert.deepEqual(parseWebviewMessage({ type: 'saveConfig', config: { repository: 'u', branch: 'main', tag: '  ', directory: 'd' } }), {
            type: 'saveConfig',
            config: { repository: 'u', branch: 'main', tag: undefined, directory: 'd' },
        });
        assert.deepEqual(parseWebviewMessage({ type: 'addSkill', name: 'n', spec: { repository: 'u', kind: 'tag', value: 'v1' } }), {
            type: 'addSkill',
            name: 'n',
            spec: { repository: 'u', kind: 'tag', value: 'v1' },
        });
        assert.deepEqual(parseWebviewMessage({ type: 'updateSkill', name: 'n', reinstall: 'yes' }), { type: 'updateSkill', name: 'n', reinstall: false });
    });

    test('rejects malformed or unknown messages', () => {
        for (const bad of [
            null,
            'ready',
            [],
            { type: 'nope' },
            { type: 'run', command: 'rm -rf' },
            { type: 'commit', message: 1, files: [] },
            { type: 'commit', message: 'x', files: [1] },
            { type: 'saveConfig', config: null },
            { type: 'inspectRemote', url: 'u', requestId: '1', purpose: 'config' },
            { type: 'addSkill', name: 'n', spec: { repository: 'u', kind: 'sudo' } },
            { type: 'removeSkill' },
            { type: 'openChange', path: 'x'.repeat(5000) },
        ]) {
            assert.equal(parseWebviewMessage(bad), undefined, JSON.stringify(bad));
        }
    });
});

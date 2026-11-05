/**
 * Builds film.build.html from film.html: inlines the AIgromatics fonts, the product's own icons
 * and logo, and two snapshots of the real dashboard (rendered by the extension's own renderApp
 * and STYLES), so every label in the film is the product's real wording.
 *
 * Usage: node promo/explainer/build.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolState, SkillStatus } from '../../src/VsCodeExtension/core/types.ts';
import { brandMark, icon, type IconName } from '../../src/VsCodeExtension/ui/icons.ts';
import { initialUiState, renderApp } from '../../src/VsCodeExtension/ui/render.ts';
import { STYLES } from '../../src/VsCodeExtension/ui/styles.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const NOW = new Date('2026-11-05T12:00:00Z');

const font = (file: string) => readFileSync(path.join(repo, 'media/fonts', file)).toString('base64');
const FONTS =
    `@font-face{font-family:"Schibsted Grotesk";font-weight:400 800;src:url(data:font/woff2;base64,${font('SchibstedGrotesk-Variable-latin.woff2')}) format("woff2")}` +
    `@font-face{font-family:"IBM Plex Mono";font-weight:400;src:url(data:font/woff2;base64,${font('IBMPlexMono-Regular-latin.woff2')}) format("woff2")}` +
    `@font-face{font-family:"IBM Plex Mono";font-weight:600;src:url(data:font/woff2;base64,${font('IBMPlexMono-SemiBold-latin.woff2')}) format("woff2")}`;

const VSCODE_VARS = '--vscode-font-family:-apple-system,BlinkMacSystemFont,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Menlo,monospace;--vscode-focusBorder:#6CC1B2';

function sha(seed: string): string {
    return seed.repeat(40).slice(0, 40);
}

const SKILLS: SkillStatus[] = [
    { name: 'code-review', spec: { repository: 'https://github.com/acme/skill-code-review.git', kind: 'default' }, path: '', health: 'ok', installedCommit: sha('7c41e9a'), remoteCommit: sha('7c41e9a'), resolvedLabel: 'main' },
    { name: 'pdf-tools', spec: { repository: 'https://github.com/acme/pdf-tools.git', kind: 'version', value: '^2.1.0' }, path: '', health: 'ok', installedCommit: sha('4f2a9c1'), remoteCommit: sha('4f2a9c1'), resolvedLabel: 'v2.3.0' },
    { name: 'writer', spec: { repository: 'git@github.com:acme/writer.git', kind: 'branch', value: 'develop' }, path: '', health: 'ok', installedCommit: sha('b83d0f2'), remoteCommit: sha('b83d0f2'), resolvedLabel: 'develop' },
    { name: 'planner', spec: { repository: 'https://github.com/acme/planner.git', kind: 'tag', value: 'v1.4.0' }, path: '', health: 'ok', installedCommit: sha('e19c5d7'), remoteCommit: sha('e19c5d7'), resolvedLabel: 'v1.4.0', newerVersion: 'v1.5.0' },
    { name: 'translator', spec: { repository: 'https://github.com/acme/translator.git', kind: 'version', value: '~1.2' }, path: '', health: 'ok', installedCommit: sha('2d6b8e4'), remoteCommit: sha('2d6b8e4'), resolvedLabel: 'v1.2.4' },
];

function readyState(skills: SkillStatus[], overrides: Partial<PoolState> = {}): PoolState {
    return {
        phase: 'ready',
        poolFolder: '/Users/you/MindPool',
        config: { repository: 'git@github.com:acme/team-skills.git', branch: 'main', directory: 'team-skills' },
        repo: {
            path: '/Users/you/MindPool/team-skills', cloned: true, branch: 'main', head: sha('9f3c2a1'), detached: false, readOnly: false,
            ahead: 0, behind: 0,
            changes: [{ path: 'skill.json', kind: 'modified', staged: false, code: ' M' }],
            newerTags: [],
        },
        manifest: { exists: true, path: '/Users/you/MindPool/team-skills/skill.json', name: 'acme-team-skills' },
        skills,
        orphans: [],
        skillsDir: '/Users/you/MindPool/team-skills/mindSkills',
        lastSync: '2026-11-05T11:59:00Z',
        log: [
            { time: '2026-11-05T11:59:00Z', level: 'success', message: 'Updated pdf-tools → v2.3.0 (4f2a9c1)' },
            { time: '2026-11-05T11:59:00Z', level: 'success', message: 'Pulled 2 new commits from origin/main' },
            { time: '2026-11-05T11:44:00Z', level: 'success', message: 'Added planner to skill.json. Commit & push to share it with the team.' },
            { time: '2026-11-05T11:40:00Z', level: 'success', message: 'Cloned git@github.com:acme/team-skills.git (main)' },
        ],
        autoUpdateSkills: true,
        ...overrides,
    } as PoolState;
}

const ui = { ...initialUiState(), home: '/Users/you' };

function frameDoc(theme: string, zoom: number, body: string, extraCss = ''): string {
    const doc =
        `<!doctype html><html style="${VSCODE_VARS}"><head><meta charset="utf-8"><style>${FONTS}${STYLES}` +
        `html{zoom:${zoom}}body{overflow:hidden}${extraCss}</style></head>` +
        `<body class="${theme}" data-entered>${body}</body></html>`;
    return doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// The S7 dashboard: the real sidebar, dark theme.
const dashboard = renderApp(readyState(SKILLS), { ...ui, commitMessage: 'feat: add planner' }, NOW);
const DASH_SRCDOC = frameDoc('vscode-dark', 2, `<div id="app">${dashboard}</div>`, '#app{will-change:transform}');

// The S6 rows: pdf-tools before and after a sync, and translator with local edits, light theme.
function skillRow(skill: SkillStatus): string {
    const html = renderApp(readyState([skill]), ui, NOW);
    const match = html.match(/<li class="skill[\s\S]*?<\/li>/);
    if (!match) {
        throw new Error(`no skill row rendered for ${skill.name}`);
    }
    return match[0];
}
const pdfOld = skillRow({ ...SKILLS[1], health: 'outdated', installedCommit: sha('a07e3b5'), resolvedLabel: 'v2.1.0' });
const pdfNew = skillRow(SKILLS[1]);
const translatorDirty = skillRow({ ...SKILLS[4], health: 'dirty' });
const ROWS_SRCDOC = frameDoc(
    'vscode-light',
    1.8,
    `<ul class="skills"><li class="stack"><div id="pdfOld">${pdfOld.replace(/^<li/, '<div').replace(/<\/li>$/, '</div>')}</div>` +
        `<div id="pdfNew">${pdfNew.replace(/^<li/, '<div').replace(/<\/li>$/, '</div>')}</div></li>${translatorDirty}</ul>`,
    'body{margin:0;padding:0;background:transparent}.skills{margin:0;gap:8px}.stack{display:grid}.stack>div{grid-area:1/1}#pdfNew{opacity:0}.skill{background:#FAFBFA}',
);

const ICON_NAMES: IconName[] = ['folder', 'file', 'clock', 'lock', 'sync', 'rocket', 'check', 'branch', 'tag', 'commit', 'sparkle', 'skill', 'eye', 'alert', 'pull', 'push', 'plus', 'link', 'list', 'logo'];
const ICONS = Object.fromEntries(ICON_NAMES.map((name) => [name, icon(name)]));

let html = readFileSync(path.join(here, 'film.html'), 'utf8');
html = html
    .replace('/*@FONTS@*/', () => FONTS)
    .replace('@DASH_SRCDOC@', () => DASH_SRCDOC)
    .replace('@ROWS_SRCDOC@', () => ROWS_SRCDOC)
    .replace('/*@ICONS@*/', () => `window.ICONS = ${JSON.stringify(ICONS)};`)
    .replace(/<!--@MARK@-->/g, () => brandMark())
    .replace(/@ACT_MASK@/g, () => `data:image/svg+xml;base64,${readFileSync(path.join(repo, 'media/mindpool.svg')).toString('base64')}`);
writeFileSync(path.join(here, 'film.build.html'), html);
console.log(`✔ film.build.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);

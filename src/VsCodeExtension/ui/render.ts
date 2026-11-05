import { describeSpec, shortSha } from '../core/format.ts';
import type { FileChange, LogEntry, PoolState, RemoteInfo, RepoStatus, SkillHealth, SkillStatus } from '../core/types.ts';
import { brandMark, icon, type IconName } from './icons.ts';
import { overallStatus, prettyUrl, relativeTime, tildify } from './status.ts';

/**
 * Pure HTML rendering of the dashboard. It runs inside the webview (bundled into the client
 * script) and in unit tests. Every dynamic value goes through `esc()`: file names, commit
 * messages and skill names come from a shared repository and are untrusted.
 */

export type SkillFormKind = 'default' | 'branch' | 'tag' | 'version';

export interface ConfigDraft {
    repository: string;
    branch: string;
    tag: string;
    directory: string;
}

export interface SkillDraft {
    name: string;
    repository: string;
    kind: SkillFormKind;
    value: string;
    /** The user typed a name: stop deriving it from the URL. */
    nameTouched?: boolean;
}

export interface RemoteLookup {
    loading: boolean;
    url: string;
    info?: RemoteInfo;
}

export interface UiState {
    commitMessage: string;
    /** Paths the user un-ticked in the changes list. */
    excluded: string[];
    editingConfig: boolean;
    configDraft?: ConfigDraft;
    addingSkill: boolean;
    skillDraft: SkillDraft;
    collapsed: string[];
    filter: string;
    showAllLog: boolean;
    remote: { config?: RemoteLookup; skill?: RemoteLookup };
    home?: string;
}

export function initialUiState(): UiState {
    return {
        commitMessage: '',
        excluded: [],
        editingConfig: false,
        addingSkill: false,
        skillDraft: { name: '', repository: '', kind: 'default', value: '' },
        collapsed: [],
        filter: '',
        showAllLog: false,
        remote: {},
    };
}

export function esc(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function attr(name: string, value: string | number | boolean | undefined): string {
    if (value === undefined || value === false) {
        return '';
    }
    return value === true ? ` ${name}` : ` ${name}="${esc(value)}"`;
}

interface ButtonOptions {
    label?: string;
    iconName?: IconName;
    title?: string;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    action: string;
    data?: Record<string, string>;
    disabled?: boolean;
    badge?: number | string;
    id?: string;
}

function button(options: ButtonOptions): string {
    const iconOnly = !options.label;
    const classes = ['btn', options.variant ?? 'secondary', iconOnly ? 'icon-only' : ''].filter(Boolean).join(' ');
    const data = Object.entries(options.data ?? {})
        .map(([key, value]) => attr(`data-${key}`, value))
        .join('');
    const title = options.title ?? options.label;
    return (
        `<button type="button" class="${classes}"${attr('id', options.id)} data-action="${esc(options.action)}"${data}` +
        `${attr('title', title)}${iconOnly ? attr('aria-label', title) : ''}${attr('disabled', options.disabled)}>` +
        `${options.iconName ? icon(options.iconName) : ''}${options.label ? `<span>${esc(options.label)}</span>` : ''}` +
        `${options.badge ? `<span class="badge">${esc(options.badge)}</span>` : ''}</button>`
    );
}

function command(name: string, rest: Omit<ButtonOptions, 'action' | 'data'> & { data?: Record<string, string> } = {}): string {
    return button({ ...rest, action: 'run', data: { command: name, ...(rest.data ?? {}) } });
}

function chip(text: string, iconName?: IconName, title?: string, tone = ''): string {
    return `<span class="chip${tone ? ` tone-${tone}` : ''}"${attr('title', title ?? text)}>${iconName ? icon(iconName) : ''}${esc(text)}</span>`;
}

function banner(tone: 'info' | 'warn' | 'error' | 'ok', iconName: IconName, html: string, actions = ''): string {
    return `<div class="banner tone-${tone}" role="${tone === 'error' ? 'alert' : 'status'}">${icon(iconName)}<div class="banner-body">${html}</div>${actions ? `<div class="banner-actions">${actions}</div>` : ''}</div>`;
}

function cardHead(id: string, iconName: IconName, title: string, ui: UiState, extra = '', count?: number): string {
    const collapsed = ui.collapsed.includes(id);
    return (
        `<div class="card-head">` +
        `<button type="button" class="card-title" data-action="toggleSection" data-section="${esc(id)}" aria-expanded="${collapsed ? 'false' : 'true'}">` +
        `<span class="chevron${collapsed ? '' : ' open'}">›</span>${icon(iconName)}<h2>${esc(title)}</h2>` +
        `${count !== undefined ? `<span class="count">${count}</span>` : ''}</button>` +
        `<div class="card-actions">${extra}</div></div>`
    );
}

function card(id: string, ui: UiState, head: string, body: string, extraClass = ''): string {
    const collapsed = ui.collapsed.includes(id);
    return `<section class="card${extraClass ? ` ${extraClass}` : ''}${collapsed ? ' collapsed' : ''}" data-section="${esc(id)}">${head}${collapsed ? '' : `<div class="card-body">${body}</div>`}</section>`;
}

// ── header ─────────────────────────────────────────────────────────────────────

function renderHeader(state: PoolState | undefined): string {
    const status = overallStatus(state);
    const busy = status.tone === 'busy';
    return (
        `<header class="hero tone-${status.tone}">` +
        `<div class="brand"><span class="logo${busy ? ' logo-busy' : ''}">${brandMark()}</span>` +
        `<div class="brand-text"><h1>MindPool <span class="byline">by AIgromatics</span></h1><p class="subtitle" title="${esc(status.detail)}">${esc(status.detail)}</p></div></div>` +
        `<span class="pill tone-${status.tone}" role="status" aria-live="polite" title="${esc(status.detail)}">` +
        `${busy ? icon('sync', 'spin') : `<span class="dot"></span>`}<span>${esc(status.label)}</span></span>` +
        `</header>`
    );
}

// ── welcome / config ───────────────────────────────────────────────────────────

function renderWelcome(): string {
    return (
        `<section class="card welcome">` +
        `<div class="welcome-art" aria-hidden="true">${brandMark()}</div>` +
        `<h2>Welcome to MindPool</h2>` +
        `<p>Keep your team's AI skills in one private Git repository and sync them everywhere, without publishing anything to the wild web.</p>` +
        `<ol class="steps">` +
        `<li><b>Pick a pool folder.</b> MindPool keeps its <code>config.json</code> there.</li>` +
        `<li><b>Connect</b> your team repository: a branch, and a release tag if you want one.</li>` +
        `<li><b>Relax.</b> Skills from <code>skill.json</code> land in <code>mindSkills/</code> and stay fresh.</li>` +
        `</ol>` +
        command('selectFolder', { label: 'Choose pool folder', iconName: 'folder', variant: 'primary' }) +
        `</section>`
    );
}

function remoteHint(lookup: RemoteLookup | undefined): string {
    if (!lookup) {
        return '';
    }
    if (lookup.loading) {
        return `<span class="hint">${icon('sync', 'spin')} Checking…</span>`;
    }
    const info = lookup.info;
    if (!info) {
        return '';
    }
    if (!info.ok) {
        return `<span class="hint tone-error">${icon('alert')} ${esc(info.error ?? 'Repository not reachable')}</span>`;
    }
    const parts = [`${info.branches.length} branch${info.branches.length === 1 ? '' : 'es'}`, `${info.tags.length} tag${info.tags.length === 1 ? '' : 's'}`];
    if (info.latestVersion) {
        parts.push(`latest ${info.latestVersion}`);
    }
    return `<span class="hint tone-ok">${icon('check')} Reachable · ${esc(parts.join(' · '))}</span>`;
}

function datalist(id: string, values: readonly string[]): string {
    return `<datalist id="${esc(id)}">${values.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
}

export function configDraftFromState(state: PoolState): ConfigDraft {
    const draft = state.configDraft ?? {};
    return {
        repository: draft.repository ?? state.config?.repository ?? '',
        branch: draft.branch ?? state.config?.branch ?? 'main',
        tag: draft.tag ?? state.config?.tag ?? '',
        directory: draft.directory ?? '',
    };
}

function renderConfigForm(state: PoolState, ui: UiState): string {
    const draft = ui.configDraft ?? configDraftFromState(state);
    const info = ui.remote.config?.info;
    const isEdit = state.phase === 'ready' || state.phase === 'notCloned';
    const head = cardHead('config', 'link', isEdit ? 'Repository settings' : 'Connect your skills repository', ui);
    const body =
        (state.configError ? banner('error', 'alert', `<b>config.json needs a fix.</b> ${esc(state.configError)}`) : '') +
        `<p class="muted">MindPool clones the repository next to <code>config.json</code> in ` +
        `<span class="path" title="${esc(state.poolFolder)}">${esc(tildify(state.poolFolder, ui.home))}</span>. ` +
        `<a href="#" data-action="run" data-command="selectFolder">Change folder</a></p>` +
        `<form class="form" data-form="config" autocomplete="off">` +
        `<label class="field"><span>Repository URL</span>` +
        `<input id="cfg-repository" data-field="config.repository" type="text" spellcheck="false" placeholder="https://github.com/acme/team-skills.git" value="${esc(draft.repository)}"></label>` +
        `<div class="row">${button({ label: 'Check repository', iconName: 'search', action: 'inspect', data: { purpose: 'config' }, variant: 'ghost', disabled: !draft.repository.trim() })}${remoteHint(ui.remote.config)}</div>` +
        `<div class="grid2">` +
        `<label class="field"><span>Branch</span><input id="cfg-branch" data-field="config.branch" type="text" spellcheck="false" list="cfg-branches" placeholder="main" value="${esc(draft.branch)}"></label>` +
        `<label class="field"><span>Release tag <em>optional</em></span><input id="cfg-tag" data-field="config.tag" type="text" spellcheck="false" list="cfg-tags" placeholder="v1.0.0" value="${esc(draft.tag)}"></label>` +
        `</div>` +
        `<label class="field"><span>Folder name <em>optional</em></span><input id="cfg-directory" data-field="config.directory" type="text" spellcheck="false" placeholder="derived from the URL" value="${esc(draft.directory)}"></label>` +
        `<p class="muted small">${icon('lock')} With a release tag the repository is pinned to that release and becomes read-only.</p>` +
        datalist('cfg-branches', info?.branches ?? []) +
        datalist('cfg-tags', info?.tags ?? []) +
        `<div class="toolbar">` +
        button({ label: isEdit ? 'Save & sync' : 'Save & clone', iconName: 'download', action: 'saveConfig', variant: 'primary', id: 'cfg-save', disabled: !draft.repository.trim() || !draft.branch.trim() }) +
        (isEdit && state.phase === 'ready' ? button({ label: 'Cancel', action: 'cancelConfig', variant: 'ghost' }) : '') +
        command('openConfig', { label: 'Edit JSON', iconName: 'file', variant: 'ghost' }) +
        `</div></form>`;
    return card('config', ui, head, body);
}

// ── repository ─────────────────────────────────────────────────────────────────

function renderRepo(state: PoolState, ui: UiState, now: Date): string {
    const repo = state.repo as RepoStatus;
    const config = state.config;
    const head = cardHead('repo', 'folder', 'Repository', ui, button({ iconName: 'gear', title: 'Repository settings', action: 'editConfig', variant: 'ghost' }));
    const chips: string[] = [];
    if (repo.tag) {
        chips.push(chip(repo.tag, 'tag', `Pinned to release ${repo.tag}`, 'accent'));
    } else if (repo.branch) {
        chips.push(chip(repo.branch, 'branch', `On branch ${repo.branch}`, 'accent'));
    } else if (repo.cloned) {
        chips.push(chip('detached', 'branch', 'Detached HEAD'));
    }
    if (repo.head) {
        chips.push(chip(shortSha(repo.head), 'commit', `HEAD ${repo.head}`));
    }
    if (repo.ahead > 0) {
        chips.push(chip(`${repo.ahead} to push`, 'arrowUp', `${repo.ahead} local commit(s) not pushed yet`, 'info'));
    }
    if (repo.behind > 0) {
        chips.push(chip(`${repo.behind} to pull`, 'arrowDown', `${repo.behind} remote commit(s) not pulled yet`, 'warn'));
    }
    if (repo.readOnly) {
        chips.push(chip('read-only', 'lock', 'Pinned release: commits and pushes are disabled'));
    }

    const banners: string[] = [];
    if (!repo.cloned) {
        banners.push(
            banner(
                'error',
                'download',
                `<b>The repository is not cloned yet.</b>${state.lastError ? ` ${esc(state.lastError)}` : ''}`,
                command('sync', { label: 'Retry', iconName: 'sync', variant: 'primary' }),
            ),
        );
    }
    if (repo.upstreamError) {
        banners.push(banner('warn', 'cloudOff', `<b>Offline?</b> ${esc(repo.upstreamError)}`));
    }
    if (repo.operation) {
        banners.push(
            banner(
                'error',
                'alert',
                `<b>A ${esc(repo.operation)} is in progress.</b> Finish it with the full Git tools.`,
                command('openInNewWindow', { label: 'Open', iconName: 'window', variant: 'primary' }),
            ),
        );
    }
    const newest = repo.newerTags[0];
    if (newest) {
        banners.push(
            banner(
                'info',
                'rocket',
                `<b>Release ${esc(newest)} is out!</b> You are on ${esc(repo.tag ?? '')}.`,
                button({ label: `Use ${newest}`, action: 'useTag', data: { tag: newest }, variant: 'primary' }),
            ),
        );
    }
    if (repo.ahead > 0 && repo.behind > 0) {
        banners.push(banner('warn', 'branch', `Local and remote both moved. <b>Pull</b> to rebase your ${repo.ahead} commit(s), then push.`));
    }

    const body =
        `<div class="repo-url" title="${esc(config?.repository)}">${icon('link')}<span>${esc(prettyUrl(config?.repository ?? ''))}</span></div>` +
        `<div class="chips">${chips.join('')}</div>` +
        `<div class="meta">${icon('clock')}<span>Synced ${esc(relativeTime(state.lastSync, now))}</span><span class="sep">·</span>` +
        `<a href="#" class="path" data-action="run" data-command="openInNewWindow" title="${esc(repo.path)}">${esc(tildify(repo.path, ui.home))}</a></div>` +
        banners.join('') +
        `<div class="toolbar">` +
        command('sync', { label: 'Sync', iconName: 'sync', variant: 'primary', title: 'Fetch, fast-forward and update skills' }) +
        command('pull', { label: 'Pull', iconName: 'pull', badge: repo.behind || undefined, disabled: !repo.cloned, title: 'Pull (rebase) from the remote' }) +
        command('push', { label: 'Push', iconName: 'push', badge: repo.ahead || undefined, disabled: !repo.cloned || repo.readOnly, title: repo.readOnly ? 'Pinned release: read-only' : 'Push your commits' }) +
        command('openInNewWindow', { label: 'Open', iconName: 'window', disabled: !repo.cloned, title: 'Open the repository in a new VS Code window' }) +
        `</div>`;
    return card('repo', ui, head, body);
}

// ── changes ────────────────────────────────────────────────────────────────────

const CHANGE_LETTER: Record<FileChange['kind'], string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    untracked: 'U',
    conflicted: '!',
    typechange: 'T',
};

function splitPath(file: string): { name: string; dir: string } {
    const index = file.lastIndexOf('/');
    return index < 0 ? { name: file, dir: '' } : { name: file.slice(index + 1), dir: file.slice(0, index) };
}

function renderChanges(state: PoolState, ui: UiState): string {
    const repo = state.repo as RepoStatus;
    const changes = repo.changes;
    const head = cardHead(
        'changes',
        'commit',
        'Changes',
        ui,
        changes.length > 1 ? `<a href="#" class="mini" data-action="selectAll">all</a><a href="#" class="mini" data-action="selectNone">none</a>` : '',
        changes.length,
    );
    if (repo.readOnly) {
        return card('changes', ui, head, `<p class="empty">${icon('lock')} Pinned to release <b>${esc(repo.tag ?? '')}</b>. Remove the tag in the settings to edit and push.</p>`);
    }
    if (changes.length === 0) {
        const pushHint =
            repo.ahead > 0
                ? banner('info', 'push', `<b>${repo.ahead} commit${repo.ahead === 1 ? '' : 's'}</b> waiting to be pushed.`, command('push', { label: 'Push', iconName: 'push', variant: 'primary' }))
                : '';
        return card('changes', ui, head, `<p class="empty">${icon('sparkle')} Working tree clean. Edit <code>skill.json</code> or add files, then commit them here.</p>${pushHint}`);
    }
    const excluded = new Set(ui.excluded);
    const selected = changes.filter((c) => !excluded.has(c.path)).length;
    const items = changes
        .map((change) => {
            const { name, dir } = splitPath(change.path);
            const checked = !excluded.has(change.path);
            const title = change.origPath ? `${change.origPath} → ${change.path}` : change.path;
            return (
                `<li class="file kind-${change.kind}">` +
                `<label title="${esc(title)}"><input type="checkbox" data-action="toggleFile" data-path="${esc(change.path)}"${checked ? ' checked' : ''}>` +
                `<span class="letter" title="${esc(change.kind)}">${CHANGE_LETTER[change.kind]}</span>` +
                `<span class="fname">${esc(name)}</span>${dir ? `<span class="fdir">${esc(dir)}</span>` : ''}</label>` +
                (change.kind === 'deleted' ? '' : button({ iconName: 'eye', title: `Open ${change.path}`, action: 'openChange', data: { path: change.path }, variant: 'ghost' })) +
                `</li>`
            );
        })
        .join('');
    const canCommit = selected > 0 && ui.commitMessage.trim().length > 0 && !state.busy;
    const body =
        `<ul class="files">${items}</ul>` +
        `<label class="field"><span class="sr-only">Commit message</span>` +
        `<textarea id="commit-message" data-field="commitMessage" rows="2" placeholder="What did you change? (⌘/Ctrl+Enter to commit)">${esc(ui.commitMessage)}</textarea></label>` +
        `<div class="toolbar">` +
        button({ label: 'Commit', iconName: 'commit', action: 'commit', disabled: !canCommit, id: 'btn-commit', data: { requires: 'commit' } }) +
        button({ label: 'Commit & Push', iconName: 'rocket', action: 'commitPush', variant: 'primary', disabled: !canCommit, id: 'btn-commit-push', data: { requires: 'commit' } }) +
        `<span class="hint">${selected}/${changes.length} selected</span>` +
        `</div>`;
    return card('changes', ui, head, body);
}

// ── skills ─────────────────────────────────────────────────────────────────────

function hashName(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return hash;
}

export function initials(name: string): string {
    const parts = name.split(/[-_. ]+/).filter(Boolean);
    const letters = parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2);
    return letters.toUpperCase() || '?';
}

const HEALTH: Record<SkillHealth, { label: string; tone: string; iconName: IconName }> = {
    ok: { label: 'up to date', tone: 'ok', iconName: 'check' },
    outdated: { label: 'update ready', tone: 'warn', iconName: 'rocket' },
    missing: { label: 'not installed', tone: 'warn', iconName: 'download' },
    dirty: { label: 'local changes', tone: 'warn', iconName: 'alert' },
    unknown: { label: 'not checked', tone: 'idle', iconName: 'clock' },
    error: { label: 'error', tone: 'error', iconName: 'alert' },
};

function healthBadge(skill: SkillStatus): string {
    if (skill.changed && skill.health === 'ok') {
        const label = skill.changed === 'installed' ? 'new' : 'updated';
        return `<span class="health tone-ok pop">${icon('sparkle')}${label}</span>`;
    }
    const h = HEALTH[skill.health];
    return `<span class="health tone-${h.tone}">${icon(h.iconName)}${esc(h.label)}</span>`;
}

function renderSkill(skill: SkillStatus, readOnly: boolean): string {
    const actions: string[] = [];
    if (skill.health === 'outdated' || skill.health === 'missing') {
        actions.push(button({ iconName: 'rocket', title: `Install ${skill.name} now`, action: 'updateSkill', data: { name: skill.name }, variant: 'primary' }));
    }
    if (skill.health === 'dirty') {
        actions.push(button({ iconName: 'sync', title: `Reinstall ${skill.name} (drops local changes)`, action: 'reinstallSkill', data: { name: skill.name }, variant: 'danger' }));
    }
    if (skill.health === 'error' && skill.spec) {
        actions.push(button({ iconName: 'sync', title: `Retry ${skill.name}`, action: 'updateSkill', data: { name: skill.name } }));
    }
    if (skill.installedCommit) {
        actions.push(button({ iconName: 'folder', title: `Reveal mindSkills/${skill.name}`, action: 'revealSkill', data: { name: skill.name }, variant: 'ghost' }));
    }
    if (!readOnly) {
        actions.push(button({ iconName: 'trash', title: `Remove ${skill.name} from skill.json`, action: 'removeSkill', data: { name: skill.name }, variant: 'ghost' }));
    }
    const meta: string[] = [];
    if (skill.resolvedLabel) {
        meta.push(chip(skill.resolvedLabel, skill.spec?.kind === 'branch' || skill.spec?.kind === 'default' ? 'branch' : 'tag'));
    }
    if (skill.installedCommit) {
        meta.push(chip(shortSha(skill.installedCommit), 'commit', `Installed commit ${skill.installedCommit}`));
    }
    if (skill.newerVersion) {
        meta.push(chip(`${skill.newerVersion} available`, 'rocket', `A newer release exists outside "${describeSpec(skill.spec)}"`, 'info'));
    }
    return (
        `<li class="skill health-${skill.health}${skill.changed ? ' just-changed' : ''}" data-skill="${esc(skill.name)}">` +
        `<div class="avatar hue-${hashName(skill.name) % 8}" aria-hidden="true">${esc(initials(skill.name))}</div>` +
        `<div class="skill-main">` +
        `<div class="skill-title"><span class="skill-name">${esc(skill.name)}</span>${healthBadge(skill)}</div>` +
        (skill.spec ? `<div class="skill-sub" title="${esc(skill.spec.repository)}">${esc(prettyUrl(skill.spec.repository))} · ${esc(describeSpec(skill.spec))}</div>` : '') +
        (meta.length ? `<div class="chips">${meta.join('')}</div>` : '') +
        (skill.error ? `<div class="skill-error">${esc(skill.error)}</div>` : '') +
        `</div><div class="skill-actions">${actions.join('')}</div></li>`
    );
}

const KIND_LABELS: Record<SkillFormKind, { label: string; field: string; placeholder: string }> = {
    default: { label: 'Latest', field: '', placeholder: '' },
    branch: { label: 'Branch', field: 'Branch', placeholder: 'main' },
    tag: { label: 'Tag', field: 'Tag', placeholder: 'v1.2.0' },
    version: { label: 'Version', field: 'Semver range', placeholder: '^1.0.0' },
};

function renderSkillForm(ui: UiState): string {
    const draft = ui.skillDraft;
    const info = ui.remote.skill?.info;
    const kinds = (Object.keys(KIND_LABELS) as SkillFormKind[])
        .map(
            (kind) =>
                `<button type="button" role="radio" aria-checked="${draft.kind === kind}" class="seg${draft.kind === kind ? ' active' : ''}" data-action="skillKind" data-kind="${kind}">${esc(KIND_LABELS[kind].label)}</button>`,
        )
        .join('');
    const kindInfo = KIND_LABELS[draft.kind];
    const options = draft.kind === 'branch' ? (info?.branches ?? []) : (info?.tags ?? []);
    const valueField =
        draft.kind === 'default'
            ? `<p class="muted small">${icon('branch')} Tracks the newest commit of the default branch${info?.defaultBranch ? ` (<b>${esc(info.defaultBranch)}</b>)` : ''}.</p>`
            : `<label class="field"><span>${esc(kindInfo.field)}</span><input id="skill-value" data-field="skill.value" type="text" spellcheck="false" list="skill-options" placeholder="${esc(
                  draft.kind === 'version' && info?.latestVersion ? `^${info.latestVersion.replace(/^v/i, '')}` : kindInfo.placeholder,
              )}" value="${esc(draft.value)}"></label>` +
              (draft.kind === 'version' ? `<p class="muted small">Like package.json: <code>^1.2.0</code>, <code>~1.2</code>, <code>&gt;=2 &lt;3</code>, <code>1.x</code>. It auto-upgrades inside the range.</p>` : '') +
              datalist('skill-options', options);
    const valid = draft.name.trim() && draft.repository.trim() && (draft.kind === 'default' || draft.value.trim());
    return (
        `<form class="form add-skill" data-form="skill" autocomplete="off">` +
        `<div class="form-title">${icon('wand')} Add a skill</div>` +
        `<label class="field"><span>Git repository</span><input id="skill-repository" data-field="skill.repository" type="text" spellcheck="false" placeholder="https://github.com/acme/skill-code-review.git" value="${esc(draft.repository)}"></label>` +
        `<div class="row">${button({ label: 'Check', iconName: 'search', action: 'inspect', data: { purpose: 'skill' }, variant: 'ghost', disabled: !draft.repository.trim() })}${remoteHint(ui.remote.skill)}</div>` +
        `<label class="field"><span>Name</span><input id="skill-name" data-field="skill.name" type="text" spellcheck="false" placeholder="code-review" value="${esc(draft.name)}"></label>` +
        `<div class="segmented" role="radiogroup" aria-label="Version selection">${kinds}</div>` +
        valueField +
        `<div class="toolbar">` +
        button({ label: 'Add skill', iconName: 'plus', action: 'addSkill', variant: 'primary', disabled: !valid, id: 'skill-add' }) +
        button({ label: 'Cancel', action: 'toggleAddSkill', variant: 'ghost' }) +
        `</div></form>`
    );
}

function renderSkills(state: PoolState, ui: UiState): string {
    const repo = state.repo as RepoStatus;
    const readOnly = repo.readOnly;
    const actions =
        (readOnly || !state.manifest.exists ? '' : button({ iconName: 'plus', title: 'Add a skill', action: 'toggleAddSkill', variant: 'ghost' })) +
        command('updateSkills', { iconName: 'rocket', title: 'Update all skills now', variant: 'ghost', disabled: state.skills.length === 0 }) +
        command('revealSkillsFolder', { iconName: 'folder', title: 'Reveal the mindSkills folder', variant: 'ghost' }) +
        command('openManifest', { iconName: 'file', title: 'Open skill.json', variant: 'ghost', disabled: !state.manifest.exists });
    const head = cardHead('skills', 'skill', 'Skills', ui, actions, state.skills.length);
    const parts: string[] = [];
    if (ui.addingSkill && !readOnly) {
        parts.push(renderSkillForm(ui));
    }
    if (!state.manifest.exists) {
        parts.push(
            `<div class="empty-state"><div class="empty-art" aria-hidden="true">${icon('file')}</div><p>This repository has no <code>skill.json</code> yet. It lists the skills your team shares, like dependencies in a package.json.</p>` +
                (readOnly ? '' : command('createManifest', { label: 'Create skill.json', iconName: 'wand', variant: 'primary' })) +
                `</div>`,
        );
    } else if (state.manifest.error) {
        parts.push(banner('error', 'alert', `<b>skill.json has a problem.</b> ${esc(state.manifest.error)}`, command('openManifest', { label: 'Open', iconName: 'file' })));
    } else if (state.skills.length === 0 && !ui.addingSkill) {
        parts.push(
            `<div class="empty-state"><div class="empty-art" aria-hidden="true">${icon('skill')}</div><p>No skills yet. Add the first one and your whole team gets it on the next sync.</p>` +
                (readOnly ? '' : button({ label: 'Add a skill', iconName: 'plus', action: 'toggleAddSkill', variant: 'primary' })) +
                `</div>`,
        );
    }
    if (state.skills.length > 5) {
        parts.push(
            `<label class="search">${icon('search')}<span class="sr-only">Filter skills</span><input id="skill-filter" data-field="filter" type="search" placeholder="Filter skills…" value="${esc(ui.filter)}"></label>`,
        );
    }
    const filter = ui.filter.trim().toLowerCase();
    const visible = filter ? state.skills.filter((s) => s.name.toLowerCase().includes(filter) || (s.spec?.repository ?? '').toLowerCase().includes(filter)) : state.skills;
    if (visible.length > 0) {
        parts.push(`<ul class="skills">${visible.map((s) => renderSkill(s, readOnly)).join('')}</ul>`);
    } else if (filter) {
        parts.push(`<p class="empty">No skill matches “${esc(ui.filter)}”.</p>`);
    }
    if (state.orphans.length > 0) {
        parts.push(
            banner(
                'info',
                'broom',
                `<b>${state.orphans.length} folder${state.orphans.length === 1 ? '' : 's'}</b> in mindSkills ${state.orphans.length === 1 ? 'is' : 'are'} not in skill.json: ${state.orphans.map((o) => `<code>${esc(o)}</code>`).join(' ')}`,
                command('pruneOrphans', { label: 'Clean up', iconName: 'broom' }),
            ),
        );
    }
    if (!state.autoUpdateSkills) {
        parts.push(`<p class="muted small">${icon('clock')} Auto-update is off: updates are listed, install them with ${icon('rocket')}. <a href="#" data-action="run" data-command="openSettings">Settings</a></p>`);
    }
    return card('skills', ui, head, parts.join(''));
}

// ── activity ───────────────────────────────────────────────────────────────────

const LOG_ICON: Record<LogEntry['level'], IconName> = { info: 'list', success: 'check', warn: 'alert', error: 'alert' };

function renderActivity(state: PoolState, ui: UiState, now: Date): string {
    const entries = ui.showAllLog ? state.log : state.log.slice(0, 6);
    const actions =
        command('showLog', { iconName: 'list', title: 'Show the full git log output', variant: 'ghost' }) +
        command('clearLog', { iconName: 'trash', title: 'Clear activity', variant: 'ghost', disabled: state.log.length === 0 });
    const head = cardHead('activity', 'clock', 'Activity', ui, actions);
    const body =
        entries.length === 0
            ? `<p class="empty">${icon('sparkle')} Nothing happened yet. Hit Sync!</p>`
            : `<ul class="log">${entries
                  .map(
                      (e) =>
                          `<li class="log-${e.level}">${icon(LOG_ICON[e.level])}<span class="log-msg">${esc(e.message)}</span><time datetime="${esc(e.time)}" title="${esc(new Date(e.time).toLocaleString())}">${esc(relativeTime(e.time, now))}</time></li>`,
                  )
                  .join('')}</ul>` +
              (state.log.length > 6 ? `<a href="#" class="mini" data-action="toggleLog">${ui.showAllLog ? 'show less' : `show all ${state.log.length}`}</a>` : '');
    return card('activity', ui, head, body);
}

function renderFooter(state: PoolState, ui: UiState): string {
    return (
        `<footer class="footer">` +
        `<span title="${esc(state.poolFolder)}">${icon('folder')} ${esc(tildify(state.poolFolder, ui.home))}</span>` +
        `<span class="footer-links"><a href="#" data-action="run" data-command="selectFolder">Change folder</a>` +
        `<a href="#" data-action="run" data-command="openSettings">Settings</a></span>` +
        `</footer>`
    );
}

// ── entry point ────────────────────────────────────────────────────────────────

export function renderLoading(): string {
    return `${renderHeader(undefined)}<section class="card skeleton"><div class="shimmer"></div><div class="shimmer short"></div></section>`;
}

export function renderApp(state: PoolState | undefined, ui: UiState, now: Date = new Date()): string {
    if (!state) {
        return renderLoading();
    }
    const parts = [renderHeader(state)];
    switch (state.phase) {
        case 'noFolder':
            parts.push(renderWelcome());
            break;
        case 'noConfig':
        case 'invalidConfig':
            parts.push(renderConfigForm(state, ui));
            parts.push(renderActivity(state, ui, now));
            parts.push(renderFooter(state, ui));
            break;
        case 'notCloned':
        case 'ready':
            if (state.repo) {
                parts.push(renderRepo(state, ui, now));
            }
            if (ui.editingConfig || state.phase === 'notCloned') {
                parts.push(renderConfigForm(state, ui));
            }
            if (state.phase === 'ready' && state.repo) {
                parts.push(renderChanges(state, ui));
                parts.push(renderSkills(state, ui));
            }
            parts.push(renderActivity(state, ui, now));
            parts.push(renderFooter(state, ui));
            break;
    }
    return parts.join('');
}

/**
 * Webview client: runs inside the MindPool dashboard (browser sandbox). It renders the state
 * pushed by the extension host and turns clicks into messages. Bundled by scripts/build.ts
 * and inlined into the extension bundle.
 */
import type { HostCommand, HostToWebview, PoolState, RemotePurpose, WebviewToHost } from '../core/types.ts';
import { configDraftFromState, initialUiState, renderApp, splitLinkFolders, type ConfigDraft, type SkillFormKind, type UiState } from './render.ts';

interface VsCodeApi {
    postMessage(message: WebviewToHost): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById('app') as HTMLElement;
let state: PoolState | undefined;
let ui: UiState = restoreUi();
let requestSeq = 0;
const latestRequest: Record<RemotePurpose, number> = { config: 0, skill: 0 };

function restoreUi(): UiState {
    const base = initialUiState();
    const saved = vscode.getState();
    if (saved && typeof saved === 'object') {
        const restored = { ...base, ...(saved as Partial<UiState>), remote: {} };
        restored.skillDraft = { ...base.skillDraft, ...restored.skillDraft };
        if (restored.configDraft) {
            // Drafts saved by an older version have no linkSkillsTo field.
            restored.configDraft = { ...restored.configDraft, linkSkillsTo: restored.configDraft.linkSkillsTo ?? '' };
        }
        return restored;
    }
    return base;
}

function persist(): void {
    vscode.setState({ ...ui, remote: {} });
}

function post(message: WebviewToHost): void {
    vscode.postMessage(message);
}

// ── rendering with focus preservation ─────────────────────────────────────────

function focusKey(el: Element | null): string | undefined {
    if (!(el instanceof HTMLElement) || el === document.body) {
        return undefined;
    }
    if (el.id) {
        return `#${el.id}`;
    }
    const d = el.dataset;
    if (d['action']) {
        return `${d['action']}|${d['command'] ?? d['name'] ?? d['path'] ?? d['section'] ?? d['kind'] ?? d['purpose'] ?? ''}`;
    }
    return undefined;
}

function findByKey(key: string): HTMLElement | undefined {
    if (key.startsWith('#')) {
        return document.getElementById(key.slice(1)) ?? undefined;
    }
    return Array.from(root.querySelectorAll<HTMLElement>('[data-action]')).find((el) => focusKey(el) === key);
}

function render(): void {
    const active = document.activeElement;
    const key = focusKey(active);
    let selection: [number | null, number | null] | undefined;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        try {
            selection = [active.selectionStart, active.selectionEnd];
        } catch {
            selection = undefined;
        }
    }
    root.innerHTML = renderApp(state, ui);
    markEntered();
    if (key) {
        const el = findByKey(key);
        if (el) {
            el.focus({ preventScroll: true });
            if (selection && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
                try {
                    el.setSelectionRange(selection[0], selection[1]);
                } catch {
                    // some input types do not support selection
                }
            }
        }
    }
    persist();
}

/**
 * The dashboard re-renders on every state update, so entrance animations would replay on
 * each sync tick. They play once, when the first real state arrives; after that the
 * body carries data-entered and the CSS turns them off.
 */
let entering = false;
function markEntered(): void {
    if (entering || !state) {
        return;
    }
    entering = true;
    setTimeout(() => {
        document.body.dataset.entered = '';
    }, 700);
}

function focus(id: string): void {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
}

// ── drafts ─────────────────────────────────────────────────────────────────────

function configDraft(): ConfigDraft {
    if (!ui.configDraft) {
        ui.configDraft = state ? configDraftFromState(state) : { repository: '', branch: 'main', tag: '', directory: '', linkSkillsTo: '' };
    }
    return ui.configDraft;
}

function deriveName(url: string): string {
    const last = url.trim().replace(/[/\\]+$/, '').replace(/\.git$/i, '').split(/[/\\:]/).pop() ?? '';
    return last
        .replace(/^skill[-_.]?/i, '')
        .replace(/[^A-Za-z0-9._-]/g, '-')
        .replace(/^[.-]+/, '')
        .slice(0, 60);
}

function skillFormValid(): boolean {
    const d = ui.skillDraft;
    return Boolean(d.name.trim() && d.repository.trim() && (d.kind === 'default' || d.value.trim()));
}

function canCommit(): boolean {
    const changes = state?.repo?.changes ?? [];
    const selected = changes.filter((c) => !ui.excluded.includes(c.path)).length;
    return selected > 0 && ui.commitMessage.trim().length > 0 && !state?.busy;
}

function setDisabled(selector: string, disabled: boolean): void {
    root.querySelectorAll<HTMLButtonElement>(selector).forEach((b) => {
        b.disabled = disabled;
    });
}

/** Updates button states while typing without re-rendering (keeps IME and datalists happy). */
function refreshControls(): void {
    setDisabled('[data-requires="commit"]', !canCommit());
    const draft = ui.configDraft;
    if (draft) {
        setDisabled('#cfg-save', !draft.repository.trim() || !draft.branch.trim());
        setDisabled('[data-action="inspect"][data-purpose="config"]', !draft.repository.trim());
    }
    setDisabled('#skill-add', !skillFormValid());
    setDisabled('[data-action="inspect"][data-purpose="skill"]', !ui.skillDraft.repository.trim());
}

function setField(field: string, value: string): void {
    if (field === 'commitMessage') {
        ui.commitMessage = value;
    } else if (field === 'filter') {
        ui.filter = value;
        render();
        return;
    } else if (field.startsWith('config.')) {
        const key = field.slice('config.'.length) as keyof ConfigDraft;
        configDraft()[key] = value;
    } else if (field.startsWith('skill.')) {
        const key = field.slice('skill.'.length);
        const draft = ui.skillDraft;
        if (key === 'name') {
            draft.name = value;
            draft.nameTouched = value.trim().length > 0;
        } else if (key === 'repository') {
            draft.repository = value;
            if (!draft.nameTouched) {
                draft.name = deriveName(value);
                const nameInput = document.getElementById('skill-name') as HTMLInputElement | null;
                if (nameInput) {
                    nameInput.value = draft.name;
                }
            }
        } else if (key === 'value') {
            draft.value = value;
        }
    }
    persist();
    refreshControls();
}

// ── actions ────────────────────────────────────────────────────────────────────

function saveConfig(override?: Partial<ConfigDraft>): void {
    const d = { ...configDraft(), ...override };
    post({
        type: 'saveConfig',
        config: {
            repository: d.repository.trim(),
            branch: d.branch.trim(),
            tag: d.tag.trim() || undefined,
            directory: d.directory.trim() || undefined,
            linkSkillsTo: splitLinkFolders(d.linkSkillsTo),
        },
    });
}

function commit(push: boolean): void {
    if (!state?.repo || !canCommit()) {
        return;
    }
    const files = state.repo.changes.filter((c) => !ui.excluded.includes(c.path)).map((c) => c.path);
    post({ type: 'commit', message: ui.commitMessage, files, push });
}

function addSkill(): void {
    if (!skillFormValid()) {
        return;
    }
    const d = ui.skillDraft;
    post({
        type: 'addSkill',
        name: d.name.trim(),
        spec: { repository: d.repository.trim(), kind: d.kind, value: d.kind === 'default' ? undefined : d.value.trim() },
    });
}

function inspect(purpose: RemotePurpose): void {
    const url = purpose === 'config' ? configDraft().repository.trim() : ui.skillDraft.repository.trim();
    if (!url) {
        return;
    }
    const requestId = ++requestSeq;
    latestRequest[purpose] = requestId;
    ui.remote = { ...ui.remote, [purpose]: { loading: true, url } };
    post({ type: 'inspectRemote', url, requestId, purpose });
    render();
}

function handleAction(el: HTMLElement): void {
    const d = el.dataset;
    switch (d['action']) {
        case 'run':
            post({ type: 'run', command: d['command'] as HostCommand });
            break;
        case 'toggleSection': {
            const id = d['section'] ?? '';
            ui.collapsed = ui.collapsed.includes(id) ? ui.collapsed.filter((s) => s !== id) : [...ui.collapsed, id];
            render();
            break;
        }
        case 'editConfig':
            ui.editingConfig = !ui.editingConfig;
            ui.configDraft = ui.editingConfig && state ? configDraftFromState(state) : undefined;
            ui.collapsed = ui.collapsed.filter((s) => s !== 'config');
            render();
            if (ui.editingConfig) {
                focus('cfg-repository');
            }
            break;
        case 'cancelConfig':
            ui.editingConfig = false;
            ui.configDraft = undefined;
            render();
            break;
        case 'saveConfig':
            saveConfig();
            break;
        case 'useTag':
            if (state?.config) {
                ui.configDraft = { ...configDraftFromState(state), tag: d['tag'] ?? '' };
                saveConfig();
            }
            break;
        case 'inspect':
            inspect(d['purpose'] === 'skill' ? 'skill' : 'config');
            break;
        case 'toggleAddSkill':
            ui.addingSkill = !ui.addingSkill;
            ui.collapsed = ui.collapsed.filter((s) => s !== 'skills');
            render();
            if (ui.addingSkill) {
                focus('skill-repository');
            }
            break;
        case 'skillKind':
            ui.skillDraft = { ...ui.skillDraft, kind: (d['kind'] as SkillFormKind) ?? 'default', value: '' };
            render();
            focus('skill-value');
            break;
        case 'addSkill':
            addSkill();
            break;
        case 'removeSkill':
            post({ type: 'removeSkill', name: d['name'] ?? '' });
            break;
        case 'updateSkill':
            post({ type: 'updateSkill', name: d['name'] ?? '', reinstall: false });
            break;
        case 'reinstallSkill':
            post({ type: 'updateSkill', name: d['name'] ?? '', reinstall: true });
            break;
        case 'revealSkill':
            post({ type: 'revealSkill', name: d['name'] ?? '' });
            break;
        case 'openChange':
            post({ type: 'openChange', path: d['path'] ?? '' });
            break;
        case 'commit':
            commit(false);
            break;
        case 'commitPush':
            commit(true);
            break;
        case 'selectAll':
            ui.excluded = [];
            render();
            break;
        case 'selectNone':
            ui.excluded = (state?.repo?.changes ?? []).map((c) => c.path);
            render();
            break;
        case 'toggleLog':
            ui.showAllLog = !ui.showAllLog;
            render();
            break;
        default:
            break;
    }
}

// ── events ─────────────────────────────────────────────────────────────────────

root.addEventListener('click', (event) => {
    const el = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!el || el.matches(':disabled') || el.dataset['action'] === 'toggleFile') {
        return;
    }
    if (el.tagName === 'A') {
        event.preventDefault();
    }
    handleAction(el);
});

root.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset['action'] !== 'toggleFile') {
        return;
    }
    const path = input.dataset['path'] ?? '';
    ui.excluded = input.checked ? ui.excluded.filter((p) => p !== path) : [...ui.excluded, path];
    render();
});

root.addEventListener('input', (event) => {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement;
    const field = el.dataset['field'];
    if (field) {
        setField(field, el.value);
    }
});

root.addEventListener('submit', (event) => event.preventDefault());

root.addEventListener('keydown', (event) => {
    const el = event.target as HTMLElement;
    if (event.key !== 'Enter' || event.isComposing) {
        return;
    }
    if (el.id === 'commit-message' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commit(event.shiftKey);
        return;
    }
    if (el instanceof HTMLInputElement) {
        const form = el.closest<HTMLElement>('[data-form]')?.dataset['form'];
        if (form === 'config') {
            event.preventDefault();
            const draft = configDraft();
            if (draft.repository.trim() && draft.branch.trim()) {
                saveConfig();
            }
        } else if (form === 'skill') {
            event.preventDefault();
            addSkill();
        }
    }
});

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
    const message = event.data;
    switch (message.type) {
        case 'state': {
            state = message.state;
            if (message.home) {
                ui.home = message.home;
            }
            const paths = new Set((state.repo?.changes ?? []).map((c) => c.path));
            ui.excluded = ui.excluded.filter((p) => paths.has(p));
            if (state.repo?.readOnly) {
                ui.addingSkill = false;
            }
            render();
            break;
        }
        case 'remoteInfo': {
            if (message.requestId !== latestRequest[message.purpose]) {
                return;
            }
            const lookup = ui.remote[message.purpose];
            ui.remote = { ...ui.remote, [message.purpose]: { loading: false, url: lookup?.url ?? '', info: message.info } };
            const info = message.info;
            if (message.purpose === 'config' && info.ok && info.defaultBranch) {
                const draft = configDraft();
                if (!draft.branch.trim() || !info.branches.includes(draft.branch.trim())) {
                    draft.branch = info.defaultBranch;
                }
            }
            render();
            break;
        }
        case 'result':
            if (!message.ok) {
                break;
            }
            if (message.op === 'commit') {
                ui.commitMessage = '';
                ui.excluded = [];
            } else if (message.op === 'addSkill') {
                ui.addingSkill = false;
                ui.skillDraft = initialUiState().skillDraft;
                ui.remote = { ...ui.remote, skill: undefined };
            } else if (message.op === 'saveConfig') {
                ui.editingConfig = false;
                ui.configDraft = undefined;
                ui.remote = { ...ui.remote, config: undefined };
            }
            render();
            break;
    }
});

// Keep "2m ago" labels fresh, but never while the user is typing.
setInterval(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
        render();
    }
}, 30_000);

render();
post({ type: 'ready' });

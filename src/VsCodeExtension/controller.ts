import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { sameSettings, SETTING_KEYS } from './core/config.ts';
import { MindPoolEngine } from './core/engine.ts';
import { createGit, type GitExec } from './core/git.ts';
import { inspectRemote } from './core/skillManager.ts';
import type { HostCommand, HostToWebview, LogEntry, PoolSettings, PoolState, SkillRefKind, SkillSpec, TrackedOperation, WebviewToHost } from './core/types.ts';
import { expandFolderPath, isInside, isSafeName, repoNameFromUrl, settingTarget, validateGitUrl } from './core/validation.ts';

/** Shows only MindPool's settings in the Settings editor. */
const SETTINGS_QUERY = '@ext:aigromatics.mindpool';

interface Settings {
    poolFolder: string;
    autoSync: boolean;
    intervalMinutes: number;
    autoUpdateSkills: boolean;
    gitPath: string;
    /** `mindpool.repository`, `mindpool.branch`, … */
    repository: Partial<PoolSettings>;
}

/** Public API returned by `activate()`, handy for tests and other extensions. */
export interface MindPoolApi {
    readonly state: PoolState;
    readonly onDidChangeState: vscode.Event<PoolState>;
    sync(): Promise<PoolState>;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function noFolderState(error?: string): PoolState {
    return { phase: 'noFolder', manifest: { exists: false }, skills: [], orphans: [], log: [], autoUpdateSkills: true, lastError: error };
}

/**
 * Glue between VS Code and the {@link MindPoolEngine}: settings, commands, file watchers,
 * the auto-sync timer, notifications and webview messages.
 */
export class MindPoolController implements vscode.Disposable {
    private readonly output: vscode.LogOutputChannel;
    private readonly emitter = new vscode.EventEmitter<PoolState>();
    readonly onDidChangeState: vscode.Event<PoolState> = this.emitter.event;
    private readonly disposables: vscode.Disposable[] = [];
    private engine?: MindPoolEngine;
    private engineSubscription?: () => void;
    private engineGitPath?: string;
    private git: GitExec;
    private fallbackState: PoolState = noFolderState();
    private watchers: vscode.Disposable[] = [];
    private watchedKey?: string;
    private timer?: ReturnType<typeof setInterval>;
    private readonly debouncers = new Map<string, ReturnType<typeof setTimeout>>();
    private settingsCache: Settings;
    /** Set while the dashboard writes the repository settings, one key at a time. */
    private writingSettings = false;

    constructor(output: vscode.LogOutputChannel) {
        this.output = output;
        this.settingsCache = this.readSettings();
        this.git = this.createGit(this.settingsCache.gitPath);
    }

    get state(): PoolState {
        return this.engine?.state ?? this.fallbackState;
    }

    api(): MindPoolApi {
        const getState = (): PoolState => this.state;
        return {
            get state() {
                return getState();
            },
            onDidChangeState: this.onDidChangeState,
            sync: () => this.sync(false),
        };
    }

    start(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('mindpool')) {
                    this.reload();
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.reload()),
            vscode.window.onDidChangeWindowState((event) => {
                if (event.focused) {
                    void this.refreshLocal();
                }
            }),
        );
        this.reload();
    }

    // ── settings / engine lifecycle ─────────────────────────────────────────────

    private readSettings(): Settings {
        const c = vscode.workspace.getConfiguration('mindpool');
        return {
            poolFolder: c.get<string>('poolFolder', ''),
            autoSync: c.get<boolean>('autoSync', true),
            intervalMinutes: Math.max(0, c.get<number>('syncIntervalMinutes', 15)),
            autoUpdateSkills: c.get<boolean>('autoUpdateSkills', true),
            gitPath: c.get<string>('gitPath', 'git'),
            repository: {
                repository: c.get<string>('repository', ''),
                branch: c.get<string>('branch', 'main'),
                tag: c.get<string>('tag', ''),
                directory: c.get<string>('directory', ''),
                linkSkillsTo: c.get<string[]>('linkSkillsTo', []),
            },
        };
    }

    /**
     * Saves the repository settings from the dashboard where VS Code reads them back: in the
     * workspace settings when they already override a value, in the user settings otherwise.
     * Keys are written one by one; the change events fired in between are not turned into syncs,
     * because the engine syncs once with the final values right after.
     */
    private async writeRepositorySettings(values: PoolSettings): Promise<void> {
        const c = vscode.workspace.getConfiguration('mindpool');
        this.writingSettings = true;
        try {
            for (const key of SETTING_KEYS) {
                const value = values[key];
                const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
                const inWorkspace = settingTarget(c.inspect(key)) === 'workspace';
                // Removing a workspace value would bring the user value back, so clear it instead.
                const stored = !empty ? value : inWorkspace ? (key === 'linkSkillsTo' ? [] : '') : undefined;
                await c.update(key, stored, inWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
            }
        } finally {
            this.writingSettings = false;
            // Change events that arrive late now compare equal and are ignored.
            this.settingsCache = this.readSettings();
        }
    }

    private createGit(gitPath: string): GitExec {
        return createGit({ gitPath, onCommand: (line) => this.output.trace(line) });
    }

    private reload(): void {
        const previous = this.settingsCache;
        const settings = this.readSettings();
        this.settingsCache = settings;
        const folder = expandFolderPath(settings.poolFolder, {
            home: os.homedir(),
            workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        });

        if (!folder.path) {
            this.disposeEngine();
            this.fallbackState = noFolderState(folder.error);
            this.emitter.fire(this.state);
            return;
        }

        const resolved = path.resolve(folder.path);
        if (!this.engine || this.engine.poolFolder !== resolved || this.engineGitPath !== settings.gitPath) {
            this.disposeEngine();
            this.git = this.createGit(settings.gitPath);
            this.engineGitPath = settings.gitPath;
            const engine = new MindPoolEngine({
                poolFolder: resolved,
                git: this.git,
                autoUpdateSkills: settings.autoUpdateSkills,
                settings: {
                    read: () => this.readSettings().repository,
                    write: (values) => this.writeRepositorySettings(values),
                },
                onLog: (entry) => this.writeLog(entry),
            });
            this.engine = engine;
            this.engineSubscription = engine.onDidChange((state) => {
                this.emitter.fire(state);
                this.updateWatchers(state);
            });
            this.output.info(`Pool folder: ${resolved}`);
            this.emitter.fire(engine.state);
            void (settings.autoSync ? engine.sync() : engine.refreshLocal());
        } else {
            this.engine.setAutoUpdateSkills(settings.autoUpdateSkills);
            if (!this.writingSettings && !sameSettings(previous.repository, settings.repository)) {
                this.output.info('Repository settings changed');
                void (settings.autoSync ? this.engine.sync() : this.engine.refreshLocal());
            }
        }
        this.resetTimer(settings);
    }

    private disposeEngine(): void {
        this.engineSubscription?.();
        this.engineSubscription = undefined;
        this.engine = undefined;
        this.disposeWatchers();
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    private resetTimer(settings: Settings): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        if (settings.autoSync && settings.intervalMinutes > 0) {
            this.timer = setInterval(() => {
                if (this.engine && !this.engine.isBusy) {
                    void this.engine.sync();
                }
            }, settings.intervalMinutes * 60_000);
        }
    }

    private writeLog(entry: LogEntry): void {
        switch (entry.level) {
            case 'error':
                this.output.error(entry.message);
                break;
            case 'warn':
                this.output.warn(entry.message);
                break;
            default:
                this.output.info(entry.message);
        }
    }

    // ── file watchers ───────────────────────────────────────────────────────────

    private disposeWatchers(): void {
        this.watchers.forEach((w) => w.dispose());
        this.watchers = [];
        this.watchedKey = undefined;
    }

    private debounce(key: string, ms: number, task: () => void): void {
        const existing = this.debouncers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        this.debouncers.set(
            key,
            setTimeout(() => {
                this.debouncers.delete(key);
                task();
            }, ms),
        );
    }

    /** skill.json edits trigger a sync; other edits refresh the changes list. */
    private onFileEvent(kind: 'manifest' | 'local'): void {
        const engine = this.engine;
        if (!engine) {
            return;
        }
        if (kind === 'local') {
            this.debounce('local', 1200, () => void engine.refreshLocal());
            return;
        }
        this.debounce(kind, 800, async () => {
            if (this.engine !== engine || !(await engine.hasManifestChanged())) {
                return;
            }
            void (this.settingsCache.autoSync ? engine.sync() : engine.refreshLocal());
        });
    }

    private updateWatchers(state: PoolState): void {
        const repoPath = state.repo?.cloned ? state.repo.path : undefined;
        const key = repoPath ?? '';
        if (key === this.watchedKey) {
            return;
        }
        this.disposeWatchers();
        this.watchedKey = key;

        if (repoPath) {
            const repoWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(repoPath), '**/*'));
            const onRepo = (uri: vscode.Uri): void => {
                const relative = path.relative(repoPath, uri.fsPath).split(path.sep).join('/');
                if (relative === '.git' || relative.startsWith('.git/') || relative === 'mindSkills' || relative.startsWith('mindSkills/')) {
                    return;
                }
                this.onFileEvent(relative === 'skill.json' ? 'manifest' : 'local');
            };
            this.watchers.push(repoWatcher, repoWatcher.onDidChange(onRepo), repoWatcher.onDidCreate(onRepo), repoWatcher.onDidDelete(onRepo));
        }
    }

    // ── operations ──────────────────────────────────────────────────────────────

    refreshLocal(): Promise<unknown> {
        return this.engine?.refreshLocal() ?? Promise.resolve(this.state);
    }

    private requireEngine(): MindPoolEngine | undefined {
        if (!this.engine) {
            void vscode.window
                .showInformationMessage('MindPool: choose a pool folder first.', 'Choose Folder')
                .then((choice) => (choice ? this.selectFolder() : undefined));
        }
        return this.engine;
    }

    /** Runs a user operation and reports failures with helpful follow-up actions. */
    private async guard<T>(task: () => Promise<T>): Promise<T | undefined> {
        try {
            return await task();
        } catch (error) {
            this.showError(errorMessage(error));
            return undefined;
        }
    }

    private showError(message: string): void {
        const actions = this.state.repo?.cloned ? ['Open in New Window', 'Show Log'] : ['Show Log'];
        void vscode.window.showErrorMessage(`MindPool: ${message}`, ...actions).then((choice) => {
            if (choice === 'Open in New Window') {
                void this.openInNewWindow();
            } else if (choice === 'Show Log') {
                this.output.show(true);
            }
        });
    }

    private celebrate(before: PoolState, after: PoolState): void {
        const changed = after.skills.filter((s) => s.changed && !before.skills.some((b) => b.name === s.name && b.installedCommit === s.installedCommit));
        if (changed.length > 0) {
            vscode.window.setStatusBarMessage(`$(sparkle) MindPool: ${changed.map((s) => s.name).join(', ')} ${changed.length === 1 ? 'is' : 'are'} fresh`, 5000);
        }
    }

    async sync(interactive = true): Promise<PoolState> {
        const engine = interactive ? this.requireEngine() : this.engine;
        if (!engine) {
            return this.state;
        }
        const before = engine.state;
        const after = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'MindPool: syncing' }, () => engine.sync());
        this.celebrate(before, after);
        if (interactive && after.lastError) {
            this.showError(after.lastError);
        } else if (interactive) {
            vscode.window.setStatusBarMessage('$(check) MindPool: synced', 3000);
        }
        return after;
    }

    async selectFolder(): Promise<void> {
        const current = this.state.poolFolder;
        const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Use as MindPool folder',
            title: 'Choose the folder where MindPool clones your team repository',
            defaultUri: current ? vscode.Uri.file(current) : vscode.Uri.file(os.homedir()),
        });
        const folder = picked?.[0];
        if (!folder) {
            return;
        }
        const settings = vscode.workspace.getConfiguration('mindpool');
        const inWorkspace = settingTarget(settings.inspect<string>('poolFolder')) === 'workspace';
        await settings.update('poolFolder', folder.fsPath, inWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
        if (inWorkspace) {
            void vscode.window.showInformationMessage(
                "MindPool: the pool folder was saved in this workspace's settings, because they override mindpool.poolFolder from your user settings.",
            );
        }
        await vscode.commands.executeCommand('mindpool.dashboard.focus');
    }

    async openInNewWindow(): Promise<void> {
        const target = this.state.repo?.cloned ? this.state.repo.path : this.state.poolFolder;
        if (!target) {
            this.requireEngine();
            return;
        }
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), { forceNewWindow: true });
    }

    async openSettings(): Promise<void> {
        await vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS_QUERY);
    }

    async openManifest(): Promise<void> {
        const manifest = this.state.manifest;
        if (manifest.exists && manifest.path) {
            await vscode.window.showTextDocument(vscode.Uri.file(manifest.path));
            return;
        }
        const choice = await vscode.window.showInformationMessage('MindPool: this repository has no skill.json yet.', 'Create skill.json');
        if (choice && this.engine) {
            const state = await this.guard(() => (this.engine as MindPoolEngine).createManifest());
            if (state?.manifest.path) {
                await vscode.window.showTextDocument(vscode.Uri.file(state.manifest.path));
            }
        }
    }

    async revealSkillsFolder(): Promise<void> {
        const dir = this.state.skillsDir;
        if (!dir) {
            this.requireEngine();
            return;
        }
        await fs.mkdir(dir, { recursive: true });
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
    }

    async commitInteractive(): Promise<void> {
        const engine = this.requireEngine();
        const changes = this.state.repo?.changes ?? [];
        if (!engine) {
            return;
        }
        if (changes.length === 0) {
            void vscode.window.showInformationMessage('MindPool: nothing to commit, the working tree is clean.');
            return;
        }
        const message = await vscode.window.showInputBox({
            title: `Commit ${changes.length} change${changes.length === 1 ? '' : 's'} to the team repository`,
            prompt: changes.slice(0, 5).map((c) => c.path).join(', ') + (changes.length > 5 ? ', …' : ''),
            placeHolder: 'What did you change?',
            validateInput: (value) => (value.trim() ? undefined : 'A commit message is required'),
        });
        if (!message) {
            return;
        }
        const state = await this.guard(() => engine.commit(message, [], false));
        if (state) {
            const choice = await vscode.window.showInformationMessage('MindPool: committed. Push it to the team now?', 'Push');
            if (choice === 'Push') {
                await this.guard(() => engine.push());
            }
        }
    }

    /** Palette flow: URL → name → how to pick the version → value. */
    async addSkillInteractive(): Promise<void> {
        const engine = this.requireEngine();
        if (!engine) {
            return;
        }
        const repository = await vscode.window.showInputBox({
            title: 'Add skill (1/3): git repository',
            placeHolder: 'https://github.com/acme/skill-code-review.git',
            ignoreFocusOut: true,
            validateInput: (value) => validateGitUrl(value),
        });
        if (!repository) {
            return;
        }
        const info = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'MindPool: checking repository…' },
            () => inspectRemote(this.git, repository),
        );
        if (!info.ok) {
            const go = await vscode.window.showWarningMessage(`MindPool: ${info.error ?? 'repository not reachable'}`, 'Add anyway');
            if (!go) {
                return;
            }
        }
        const name = await vscode.window.showInputBox({
            title: 'Add skill (2/3): name',
            value: repoNameFromUrl(repository).replace(/^skill[-_.]?/i, ''),
            ignoreFocusOut: true,
            validateInput: (value) => (isSafeName(value.trim()) ? undefined : 'Use letters, digits, ".", "_" and "-"'),
        });
        if (!name) {
            return;
        }
        type KindItem = vscode.QuickPickItem & { refKind: SkillRefKind };
        const kindItems: KindItem[] = [
            { label: '$(git-branch) Latest', description: `newest commit of ${info.defaultBranch ?? 'the default branch'}`, refKind: 'default' },
            { label: '$(rocket) Version range', description: info.latestVersion ? `e.g. ^${info.latestVersion.replace(/^v/i, '')}` : 'e.g. ^1.0.0', refKind: 'version' },
            { label: '$(tag) Exact tag', description: `${info.tags.length} tags`, refKind: 'tag' },
            { label: '$(git-branch) Branch', description: `${info.branches.length} branches`, refKind: 'branch' },
        ];
        const kind = await vscode.window.showQuickPick(kindItems, { title: 'Add skill (3/3): which version?', ignoreFocusOut: true });
        if (!kind) {
            return;
        }
        let value: string | undefined;
        if (kind.refKind === 'tag' || kind.refKind === 'branch') {
            const options = kind.refKind === 'tag' ? info.tags : info.branches;
            value = options.length
                ? (await vscode.window.showQuickPick(options, { title: `Pick a ${kind.refKind}`, ignoreFocusOut: true })) ?? undefined
                : await vscode.window.showInputBox({ title: `${kind.refKind} name`, ignoreFocusOut: true });
            if (!value) {
                return;
            }
        } else if (kind.refKind === 'version') {
            value = await vscode.window.showInputBox({
                title: 'Semver range',
                value: info.latestVersion ? `^${info.latestVersion.replace(/^v/i, '')}` : '^1.0.0',
                ignoreFocusOut: true,
            });
            if (!value) {
                return;
            }
        }
        const spec: SkillSpec = { repository: repository.trim(), kind: kind.refKind, value };
        await this.guard(() => engine.addSkill(name.trim(), spec));
    }

    private async confirm(message: string, detail: string, action: string): Promise<boolean> {
        const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, action);
        return choice === action;
    }

    async runHostCommand(command: HostCommand): Promise<void> {
        const engine = this.engine;
        switch (command) {
            case 'sync':
                await this.sync(true);
                return;
            case 'selectFolder':
                await this.selectFolder();
                return;
            case 'openInNewWindow':
                await this.openInNewWindow();
                return;
            case 'openManifest':
                await this.openManifest();
                return;
            case 'revealSkillsFolder':
                await this.revealSkillsFolder();
                return;
            case 'openSettings':
                await this.openSettings();
                return;
            case 'showLog':
                this.output.show(true);
                return;
            case 'clearLog':
                engine?.clearLog();
                return;
            default:
                break;
        }
        if (!this.requireEngine() || !engine) {
            return;
        }
        switch (command) {
            case 'pull':
                await this.guard(() => engine.pull());
                return;
            case 'push':
                await this.guard(() => engine.push());
                return;
            case 'createManifest':
                await this.guard(() => engine.createManifest());
                return;
            case 'updateSkills': {
                const before = engine.state;
                const after = await this.guard(() => engine.updateAllSkills());
                if (after) {
                    this.celebrate(before, after);
                }
                return;
            }
            case 'pruneOrphans':
                if (await this.confirm('Delete unused skill folders?', this.state.orphans.map((o) => `mindSkills/${o}`).join('\n'), 'Delete')) {
                    await this.guard(() => engine.pruneOrphans());
                }
                return;
            default:
                return;
        }
    }

    /** Messages from the dashboard webview. */
    async handleMessage(message: WebviewToHost, reply: (message: HostToWebview) => void): Promise<void> {
        const track = async (op: TrackedOperation, task: () => Promise<unknown>): Promise<void> => {
            const result = await this.guard(task);
            reply({ type: 'result', op, ok: result !== undefined });
        };
        switch (message.type) {
            case 'run':
                await this.runHostCommand(message.command);
                return;
            case 'inspectRemote': {
                const info = await inspectRemote(this.git, message.url);
                reply({ type: 'remoteInfo', requestId: message.requestId, purpose: message.purpose, info });
                return;
            }
            case 'openChange': {
                const repo = this.state.repo;
                if (!repo?.cloned) {
                    return;
                }
                const target = path.resolve(repo.path, message.path);
                if (isInside(repo.path, target)) {
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target));
                }
                return;
            }
            case 'revealSkill': {
                const skill = this.state.skills.find((s) => s.name === message.name);
                if (skill && this.state.skillsDir && isInside(this.state.skillsDir, skill.path)) {
                    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(skill.path));
                }
                return;
            }
            default:
                break;
        }
        const engine = this.requireEngine();
        if (!engine) {
            return;
        }
        switch (message.type) {
            case 'saveConfig':
                await track('saveConfig', () => engine.saveConfig(message.config));
                return;
            case 'commit':
                await track('commit', () => engine.commit(message.message, message.files, message.push));
                return;
            case 'addSkill':
                await track('addSkill', () => engine.addSkill(message.name, message.spec));
                return;
            case 'removeSkill':
                if (await this.confirm(`Remove "${message.name}"?`, 'It is removed from skill.json and deleted from mindSkills. Commit & push to share the change.', 'Remove')) {
                    await this.guard(() => engine.removeSkill(message.name));
                }
                return;
            case 'updateSkill':
                if (message.reinstall && !(await this.confirm(`Reinstall "${message.name}"?`, 'Local changes inside mindSkills will be discarded.', 'Reinstall'))) {
                    return;
                }
                await this.guard(() => engine.updateSkill(message.name, message.reinstall));
                return;
            default:
                return;
        }
    }

    registerCommands(): vscode.Disposable[] {
        const register = (id: string, run: () => Promise<unknown>): vscode.Disposable =>
            vscode.commands.registerCommand(id, () => run());
        return [
            register('mindpool.sync', () => this.sync(true)),
            register('mindpool.selectFolder', () => this.selectFolder()),
            register('mindpool.pull', () => this.runHostCommand('pull')),
            register('mindpool.push', () => this.runHostCommand('push')),
            register('mindpool.commit', () => this.commitInteractive()),
            register('mindpool.openInNewWindow', () => this.openInNewWindow()),
            register('mindpool.openSettings', () => this.openSettings()),
            register('mindpool.openManifest', () => this.openManifest()),
            register('mindpool.addSkill', () => this.addSkillInteractive()),
            register('mindpool.updateSkills', () => this.runHostCommand('updateSkills')),
            register('mindpool.revealSkillsFolder', () => this.revealSkillsFolder()),
        ];
    }

    dispose(): void {
        this.disposeEngine();
        this.debouncers.forEach((t) => clearTimeout(t));
        this.debouncers.clear();
        this.disposables.forEach((d) => d.dispose());
        this.emitter.dispose();
    }
}

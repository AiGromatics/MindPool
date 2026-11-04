import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { CONFIG_FILE, readConfig, writeConfig } from './config.ts';
import { shortSha, type GitExec, type RemoteRefs } from './git.ts';
import { createManifest, MANIFEST_FILE, readManifest, removeSkill, SKILLS_DIR, upsertSkill } from './manifest.ts';
import { PoolRepository } from './poolRepository.ts';
import { inspectRemote, resolveSpec, SkillDirtyError, SkillManager } from './skillManager.ts';
import type {
    LogEntry,
    LogLevel,
    ManifestEntry,
    PoolConfig,
    PoolConfigFile,
    PoolState,
    RemoteInfo,
    SkillSpec,
    SkillStatus,
} from './types.ts';

const MAX_LOG = 60;

export interface EngineOptions {
    poolFolder: string;
    git: GitExec;
    autoUpdateSkills?: boolean;
    /** Parallel skill checks (ls-remote / fetch). */
    concurrency?: number;
    onLog?: (entry: LogEntry) => void;
    now?: () => Date;
}

export interface SyncOptions {
    /** Contact remotes (fetch, ls-remote). Defaults to true. */
    network?: boolean;
    /** Install/upgrade skills that are missing or outdated. Defaults to the autoUpdateSkills option. */
    updateSkills?: boolean;
}

interface SkillContext {
    network: boolean;
    update: boolean;
    previous: Map<string, SkillStatus>;
    refs: Map<string, Promise<RemoteRefs>>;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index] as T);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return results;
}

function sameSpec(a: SkillSpec | undefined, b: SkillSpec | undefined): boolean {
    return a?.repository === b?.repository && a?.kind === b?.kind && a?.value === b?.value;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The heart of MindPool: keeps the team repository (next to config.json) in sync with its
 * remote, and keeps every skill declared in skill.json downloaded inside `mindSkills/`.
 * All operations are serialised through a single queue, so timers, file watchers and
 * button clicks can never run git commands concurrently on the same repository.
 */
export class MindPoolEngine {
    readonly poolFolder: string;
    private readonly git: GitExec;
    private readonly concurrency: number;
    private readonly onLog?: (entry: LogEntry) => void;
    private readonly now: () => Date;
    private autoUpdate: boolean;
    private current: PoolState;
    private readonly listeners = new Set<(state: PoolState) => void>();
    private queue: Promise<unknown> = Promise.resolve();
    private pendingSync?: Promise<PoolState>;
    private config?: PoolConfig;
    private repo?: PoolRepository;
    private skills?: SkillManager;
    private lastConfigText?: string;
    private lastManifestText?: string;

    constructor(options: EngineOptions) {
        this.poolFolder = path.resolve(options.poolFolder);
        this.git = options.git;
        this.concurrency = options.concurrency ?? 4;
        this.onLog = options.onLog;
        this.now = options.now ?? (() => new Date());
        this.autoUpdate = options.autoUpdateSkills ?? true;
        this.current = {
            phase: 'noConfig',
            poolFolder: this.poolFolder,
            manifest: { exists: false },
            skills: [],
            orphans: [],
            log: [],
            autoUpdateSkills: this.autoUpdate,
        };
    }

    get state(): PoolState {
        return this.current;
    }

    get isBusy(): boolean {
        return this.current.busy !== undefined;
    }

    onDidChange(listener: (state: PoolState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    setAutoUpdateSkills(value: boolean): void {
        this.autoUpdate = value;
        this.patch({ autoUpdateSkills: value });
    }

    // ── state helpers ────────────────────────────────────────────────────────────

    private patch(partial: Partial<PoolState>): void {
        this.current = { ...this.current, ...partial };
        for (const listener of this.listeners) {
            listener(this.current);
        }
    }

    private log(level: LogLevel, message: string): void {
        const entry: LogEntry = { time: this.now().toISOString(), level, message };
        this.onLog?.(entry);
        this.patch({ log: [entry, ...this.current.log].slice(0, MAX_LOG) });
    }

    clearLog(): void {
        this.patch({ log: [] });
    }

    /**
     * True when config.json / skill.json differ from what the engine last processed. Lets file
     * watchers ignore the engine's own writes instead of triggering a second sync.
     */
    async hasFileChanged(which: 'config' | 'manifest'): Promise<boolean> {
        const file = which === 'config' ? path.join(this.poolFolder, CONFIG_FILE) : this.repo ? path.join(this.repo.dir, MANIFEST_FILE) : undefined;
        if (!file) {
            return true;
        }
        const text = await fs.readFile(file, 'utf8').catch(() => undefined);
        return text !== (which === 'config' ? this.lastConfigText : this.lastManifestText);
    }

    /** Serialises work; `label` (when given) is shown as the busy indicator. */
    private enqueue<T>(label: string | undefined, task: () => Promise<T>, reportErrors = true): Promise<T> {
        const run = async (): Promise<T> => {
            if (label) {
                this.patch({ busy: label });
            }
            try {
                return await task();
            } catch (error) {
                if (reportErrors) {
                    this.log('error', errorMessage(error));
                    this.patch({ lastError: errorMessage(error) });
                }
                throw error;
            } finally {
                if (label) {
                    this.patch({ busy: undefined });
                }
            }
        };
        const result = this.queue.then(run, run);
        this.queue = result.catch(() => undefined);
        return result;
    }

    // ── sync ─────────────────────────────────────────────────────────────────────

    /** Full sync. Concurrent requests made before the queued sync starts share its result. */
    sync(options: SyncOptions = {}): Promise<PoolState> {
        if (this.pendingSync) {
            return this.pendingSync;
        }
        const promise = this.enqueue(
            'Syncing',
            async () => {
                this.pendingSync = undefined;
                await this.doSync(options);
                return this.current;
            },
            false,
        );
        this.pendingSync = promise;
        return promise;
    }

    /** Cheap, offline refresh (no fetch): working tree changes and installed skills. */
    refreshLocal(): Promise<PoolState> {
        return this.enqueue(
            undefined,
            async () => {
                const config = await this.loadConfig();
                if (config) {
                    await this.refreshRepoStatus(config);
                    await this.syncSkills({ network: false, update: false });
                }
                return this.current;
            },
            false,
        );
    }

    private async doSync(options: SyncOptions): Promise<void> {
        const network = options.network ?? true;
        const update = options.updateSkills ?? this.autoUpdate;
        try {
            const config = await this.loadConfig();
            if (!config || !this.repo) {
                return;
            }
            const repo = this.repo;
            let upstreamError: string | undefined;

            if (!(await repo.isCloned())) {
                if (!network) {
                    await this.refreshRepoStatus(config);
                    return;
                }
                this.patch({ busy: 'Cloning repository' });
                try {
                    await repo.clone(config);
                    this.log('success', `Cloned ${config.repository} (${config.tag ? `release ${config.tag}` : config.branch})`);
                } catch (error) {
                    this.log('error', `Clone failed: ${errorMessage(error)}`);
                    this.patch({ lastError: errorMessage(error) });
                    await this.refreshRepoStatus(config, { error: errorMessage(error) });
                    return;
                } finally {
                    this.patch({ busy: 'Syncing' });
                }
            } else {
                if (await repo.ensureRemote(config.repository)) {
                    this.log('info', `Remote updated to ${config.repository}`);
                }
                if (network) {
                    try {
                        await repo.fetch();
                    } catch (error) {
                        upstreamError = errorMessage(error);
                        this.log('warn', `Could not reach the repository: ${upstreamError}`);
                    }
                }
                await this.alignRepository(config, repo);
            }

            await repo.ensureSkillsExcluded();
            await this.refreshRepoStatus(config, { error: upstreamError });
            await this.syncSkills({ network, update });
            this.patch({ lastSync: this.now().toISOString(), lastError: upstreamError });
        } catch (error) {
            this.log('error', `Sync failed: ${errorMessage(error)}`);
            this.patch({ lastError: errorMessage(error) });
        }
    }

    /** Puts the checkout where config.json says: the release tag, or the tip of the branch. */
    private async alignRepository(config: PoolConfig, repo: PoolRepository): Promise<void> {
        if (config.tag) {
            const target = await repo.tagCommit(config.tag);
            if (!target) {
                this.log('error', `Release tag "${config.tag}" was not found in the repository.`);
                return;
            }
            const branch = await repo.currentBranch();
            if (branch !== undefined || (await repo.head()) !== target) {
                try {
                    await repo.checkoutTag(config.tag);
                    this.log('success', `Checked out release ${config.tag}`);
                } catch (error) {
                    this.log('error', `Cannot check out release ${config.tag}: ${errorMessage(error)}`);
                }
            }
            return;
        }
        try {
            if (await repo.ensureBranch(config.branch)) {
                this.log('info', `Switched to branch ${config.branch}`);
            }
        } catch (error) {
            this.log('error', `Cannot switch to branch ${config.branch}: ${errorMessage(error)}`);
            return;
        }
        const result = await repo.fastForward(config.branch);
        switch (result.kind) {
            case 'fastForwarded':
                this.log('success', `Pulled ${result.commits} new commit${result.commits === 1 ? '' : 's'} from origin/${config.branch}`);
                break;
            case 'diverged':
                this.log('warn', `Your branch and origin/${config.branch} have diverged (${result.ahead} local, ${result.behind} remote). Use Pull to rebase.`);
                break;
            case 'blocked':
                this.log('warn', `Automatic update skipped: ${result.reason}`);
                break;
            case 'upToDate':
                break;
        }
    }

    private async loadConfig(): Promise<PoolConfig | undefined> {
        const result = await readConfig(this.poolFolder);
        this.lastConfigText = result.text;
        const reset: Partial<PoolState> = {
            configPath: result.path,
            config: undefined,
            repo: undefined,
            skills: [],
            orphans: [],
            skillsDir: undefined,
            manifest: { exists: false },
        };
        if (!result.exists) {
            this.config = undefined;
            this.patch({ ...reset, phase: 'noConfig', configDraft: {}, configError: undefined });
            return undefined;
        }
        if (!result.config) {
            this.config = undefined;
            this.patch({ ...reset, phase: 'invalidConfig', configDraft: result.draft, configError: result.error });
            return undefined;
        }
        const config = result.config;
        const repoDir = path.join(this.poolFolder, config.directory);
        if (!this.repo || this.repo.dir !== repoDir) {
            this.repo = new PoolRepository(this.git, repoDir);
            this.skills = new SkillManager(this.git, path.join(repoDir, SKILLS_DIR));
            this.patch({ skills: [], orphans: [] });
        }
        this.config = config;
        this.patch({
            configPath: result.path,
            config,
            configDraft: result.draft,
            configError: undefined,
            skillsDir: this.skills?.skillsDir,
        });
        return config;
    }

    /**
     * Re-reads the local repository status. `upstream` replaces the last fetch error; when it is
     * omitted the previous one is kept (local refreshes do not contact the remote).
     */
    private async refreshRepoStatus(config: PoolConfig, upstream?: { error?: string }): Promise<void> {
        if (!this.repo) {
            return;
        }
        const upstreamError = upstream ? upstream.error : this.current.repo?.upstreamError;
        const repo = await this.repo.status(config, upstreamError);
        this.patch({ repo, phase: repo.cloned ? 'ready' : 'notCloned' });
    }

    // ── skills ───────────────────────────────────────────────────────────────────

    private async syncSkills(options: { network: boolean; update: boolean; only?: string }): Promise<void> {
        if (!this.repo || !this.skills || !this.current.repo?.cloned) {
            return;
        }
        const manifestResult = await readManifest(this.repo.dir);
        this.lastManifestText = manifestResult.text;
        const manifest = {
            exists: manifestResult.exists,
            path: manifestResult.path,
            name: manifestResult.manifest?.name,
            error: manifestResult.error,
        };
        const entries = manifestResult.manifest?.entries ?? [];
        const previous = new Map(this.current.skills.map((s) => [s.name, s]));
        const context: SkillContext = { network: options.network, update: options.update, previous, refs: new Map() };

        const skills = await mapLimit(entries, this.concurrency, async (entry) => {
            if (options.only !== undefined && entry.name !== options.only) {
                const kept = previous.get(entry.name);
                if (kept && sameSpec(kept.spec, entry.spec)) {
                    return kept;
                }
                return this.evaluateSkill(entry, { ...context, network: false, update: false });
            }
            return this.evaluateSkill(entry, context);
        });

        // Skills that left skill.json are pruned, like `npm prune`. Only when the manifest is
        // valid (a broken skill.json must never wipe the folder) and never with local changes.
        const declared = new Set(entries.map((e) => e.name));
        const orphans: string[] = [];
        for (const name of await this.skills.listInstalled()) {
            if (declared.has(name)) {
                continue;
            }
            const canPrune = options.update && manifestResult.manifest !== undefined && options.only === undefined;
            if (canPrune && !(await this.skills.isDirty(name).catch(() => true))) {
                await this.skills.remove(name);
                this.log('info', `Removed ${name} (no longer listed in skill.json)`);
            } else {
                orphans.push(name);
            }
        }
        this.patch({ skills, orphans, manifest, skillsDir: this.skills.skillsDir });
    }

    private async evaluateSkill(entry: ManifestEntry, context: SkillContext): Promise<SkillStatus> {
        const skills = this.skills as SkillManager;
        const base: SkillStatus = {
            name: entry.name,
            spec: entry.spec,
            path: entry.spec ? skills.pathFor(entry.name) : path.join(skills.skillsDir, '_invalid_'),
            health: 'unknown',
        };
        if (!entry.spec) {
            return { ...base, health: 'error', error: entry.error };
        }
        const spec = entry.spec;
        const installedCommit = await skills.installedCommit(entry.name);

        if (!context.network) {
            const prev = context.previous.get(entry.name);
            if (prev && sameSpec(prev.spec, spec) && prev.remoteCommit) {
                if (prev.installedCommit === installedCommit) {
                    return prev;
                }
                return {
                    ...prev,
                    installedCommit,
                    changed: undefined,
                    health: installedCommit === prev.remoteCommit ? 'ok' : installedCommit ? 'outdated' : 'missing',
                };
            }
            return { ...base, installedCommit, health: installedCommit ? 'unknown' : 'missing' };
        }

        let status: SkillStatus = { ...base, installedCommit };
        try {
            let refs = context.refs.get(spec.repository);
            if (!refs) {
                refs = skills.lsRemote(spec.repository);
                context.refs.set(spec.repository, refs);
            }
            const resolved = resolveSpec(spec, await refs);
            status = {
                ...status,
                remoteCommit: resolved.commit,
                resolvedLabel: resolved.label,
                newerVersion: resolved.newerVersion,
            };
            if (installedCommit === resolved.commit) {
                return { ...status, health: 'ok' };
            }
            if (!context.update) {
                return { ...status, health: installedCommit ? 'outdated' : 'missing' };
            }
            const { outcome, commit } = await skills.install(entry.name, spec, resolved);
            if (outcome !== 'unchanged') {
                this.log('success', `${outcome === 'installed' ? 'Installed' : 'Updated'} ${entry.name} → ${resolved.label} (${shortSha(commit)})`);
            }
            return {
                ...status,
                installedCommit: commit,
                health: 'ok',
                changed: outcome === 'unchanged' ? undefined : outcome,
            };
        } catch (error) {
            if (error instanceof SkillDirtyError) {
                this.log('warn', error.message);
                return { ...status, health: 'dirty', error: error.message };
            }
            this.log('error', `${entry.name}: ${errorMessage(error)}`);
            return { ...status, health: 'error', error: errorMessage(error) };
        }
    }

    // ── user operations ─────────────────────────────────────────────────────────

    private requireRepo(writable: boolean): { config: PoolConfig; repo: PoolRepository } {
        if (!this.config || !this.repo || this.current.phase !== 'ready') {
            throw new Error('Connect a skills repository first.');
        }
        if (writable && this.config.tag) {
            throw new Error(`The repository is pinned to release ${this.config.tag} (read-only). Remove "tag" from config.json to edit it.`);
        }
        return { config: this.config, repo: this.repo };
    }

    pull(): Promise<PoolState> {
        return this.enqueue('Pulling', async () => {
            const { config, repo } = this.requireRepo(false);
            if (config.tag) {
                await this.doSync({ network: true });
                return this.current;
            }
            if (await repo.operationInProgress()) {
                throw new Error('A merge or rebase is in progress. Open the repository in a new window to finish it.');
            }
            await repo.ensureBranch(config.branch);
            await repo.pull(config.branch);
            this.log('success', `Pulled origin/${config.branch}`);
            await this.refreshRepoStatus(config, {});
            await this.syncSkills({ network: true, update: this.autoUpdate });
            this.patch({ lastSync: this.now().toISOString(), lastError: undefined });
            return this.current;
        });
    }

    push(): Promise<PoolState> {
        return this.enqueue('Pushing', async () => {
            const { config, repo } = this.requireRepo(true);
            await this.pushInternal(config, repo);
            return this.current;
        });
    }

    private async pushInternal(config: PoolConfig, repo: PoolRepository): Promise<void> {
        const { ahead } = await repo.aheadBehind(config.branch);
        await repo.push(config.branch);
        this.log('success', ahead > 0 ? `Pushed ${ahead} commit${ahead === 1 ? '' : 's'} to origin/${config.branch}` : `origin/${config.branch} is up to date`);
        await this.refreshRepoStatus(config);
        this.patch({ lastError: undefined });
    }

    /**
     * Commits the selected files (paths as listed in `state.repo.changes`), or every change
     * when `files` is empty, and optionally pushes right after.
     */
    commit(message: string, files: readonly string[] = [], push = false): Promise<PoolState> {
        return this.enqueue(push ? 'Committing & pushing' : 'Committing', async () => {
            const { config, repo } = this.requireRepo(true);
            if (!message.trim()) {
                throw new Error('Write a commit message first.');
            }
            if (await repo.operationInProgress()) {
                throw new Error('A merge or rebase is in progress. Open the repository in a new window to finish it.');
            }
            const changes = await repo.changes();
            if (changes.length === 0) {
                throw new Error('Nothing to commit: the working tree is clean.');
            }
            let paths: string[] = [];
            if (files.length > 0) {
                const selected = new Set(files);
                paths = changes.filter((c) => selected.has(c.path)).flatMap((c) => (c.origPath ? [c.path, c.origPath] : [c.path]));
                if (paths.length === 0) {
                    throw new Error('None of the selected files have changes any more.');
                }
            }
            const sha = await repo.commit(message, paths);
            const firstLine = message.trim().split(/\r?\n/)[0] ?? '';
            this.log('success', `Committed ${shortSha(sha)} “${firstLine}”`);
            await this.refreshRepoStatus(config);
            if (push) {
                await this.pushInternal(config, repo);
            }
            await this.syncSkills({ network: false, update: false });
            return this.current;
        });
    }

    saveConfig(values: PoolConfigFile): Promise<PoolState> {
        return this.enqueue('Saving config', async () => {
            await writeConfig(this.poolFolder, values);
            this.log('success', 'Saved config.json');
            await this.doSync({ network: true });
            return this.current;
        });
    }

    createManifest(): Promise<PoolState> {
        return this.enqueue('Creating skill.json', async () => {
            const { config, repo } = this.requireRepo(true);
            await createManifest(repo.dir, config.directory);
            this.log('success', 'Created skill.json. Add skills, then commit & push to share them.');
            await this.refreshRepoStatus(config);
            await this.syncSkills({ network: false, update: false });
            return this.current;
        });
    }

    addSkill(name: string, spec: SkillSpec): Promise<PoolState> {
        return this.enqueue(`Adding ${name}`, async () => {
            const { config, repo } = this.requireRepo(true);
            await upsertSkill(repo.dir, name.trim(), { ...spec, repository: spec.repository.trim(), value: spec.value?.trim() || undefined });
            this.log('success', `Added ${name} to skill.json. Commit & push to share it with the team.`);
            await this.refreshRepoStatus(config);
            await this.syncSkills({ network: true, update: true, only: name.trim() });
            return this.current;
        });
    }

    removeSkill(name: string): Promise<PoolState> {
        return this.enqueue(`Removing ${name}`, async () => {
            const { config, repo } = this.requireRepo(true);
            const removed = await removeSkill(repo.dir, name);
            if (this.skills) {
                await this.skills.remove(name);
            }
            this.log('success', removed ? `Removed ${name} from skill.json` : `Deleted mindSkills/${name}`);
            await this.refreshRepoStatus(config);
            await this.syncSkills({ network: false, update: false });
            return this.current;
        });
    }

    /** Installs/updates one skill now. `reinstall` wipes the local copy first (drops local changes). */
    updateSkill(name: string, reinstall = false): Promise<PoolState> {
        return this.enqueue(`Updating ${name}`, async () => {
            this.requireRepo(false);
            if (reinstall && this.skills) {
                await this.skills.remove(name);
                this.log('info', `Reinstalling ${name}`);
            }
            await this.syncSkills({ network: true, update: true, only: name });
            const status = this.current.skills.find((s) => s.name === name);
            if (status?.health === 'error' || status?.health === 'dirty') {
                throw new Error(status.error ?? `Could not update ${name}.`);
            }
            return this.current;
        });
    }

    updateAllSkills(): Promise<PoolState> {
        return this.enqueue('Updating skills', async () => {
            this.requireRepo(false);
            await this.syncSkills({ network: true, update: true });
            const failed = this.current.skills.filter((s) => s.health === 'error' || s.health === 'dirty');
            this.log(failed.length ? 'warn' : 'success', failed.length ? `${failed.length} skill(s) could not be updated` : 'All skills are up to date');
            return this.current;
        });
    }

    /** Deletes folders in mindSkills that skill.json no longer declares. */
    pruneOrphans(): Promise<PoolState> {
        return this.enqueue('Cleaning mindSkills', async () => {
            this.requireRepo(false);
            for (const name of this.current.orphans) {
                await this.skills?.remove(name);
                this.log('info', `Deleted mindSkills/${name}`);
            }
            this.patch({ orphans: [] });
            await this.syncSkills({ network: false, update: false });
            return this.current;
        });
    }

    /** Lists branches and tags of any git URL (used by the forms). Not queued: read-only. */
    inspectRemote(url: string): Promise<RemoteInfo> {
        return inspectRemote(this.git, url);
    }
}

/**
 * Shared types used by the core engine, the VS Code host and the webview.
 * Everything here must stay JSON-serialisable because it is posted to the webview.
 */

/** Repository settings, stored in the VS Code settings as `mindpool.<key>`. */
export interface PoolSettings {
    /** Git URL of the team skills repository. */
    repository: string;
    /** Branch to track (required). */
    branch: string;
    /** Optional release tag: when set the repository is pinned (read-only) to that tag. */
    tag?: string;
    /** Optional folder name (inside the pool folder) where the repository is cloned. */
    directory?: string;
    /**
     * Optional folders where every installed skill gets a link, e.g. `~/.claude/skills`, so AI
     * tools that only look one level deep find the skills downloaded in mindSkills.
     */
    linkSkillsTo?: string[];
}

/** Validated config with every default resolved. */
export interface PoolConfig {
    repository: string;
    branch: string;
    tag?: string;
    directory: string;
    /** Folders from `linkSkillsTo`, as written (not expanded yet). Empty when links are off. */
    linkSkillsTo: string[];
}

/**
 * How a skill version is selected:
 * - `default`: the remote default branch (HEAD)
 * - `branch`: latest commit of a branch
 * - `tag`: an exact tag (pinned; newer tags are only reported)
 * - `version`: a semver range resolved against the repository tags (auto-upgrades inside the range)
 * - `ref`: shorthand `url#name`, resolved as a tag first, then as a branch
 */
export type SkillRefKind = 'default' | 'branch' | 'tag' | 'version' | 'ref';

export interface SkillSpec {
    repository: string;
    kind: SkillRefKind;
    value?: string;
}

export interface ManifestEntry {
    name: string;
    spec?: SkillSpec;
    error?: string;
}

export type SkillHealth =
    | 'ok' // installed at the resolved commit
    | 'outdated' // installed, but a newer commit was resolved and not installed
    | 'missing' // declared but not installed
    | 'dirty' // has local modifications, update skipped
    | 'unknown' // installed, remote not checked yet
    | 'error';

export interface SkillStatus {
    name: string;
    spec?: SkillSpec;
    path: string;
    health: SkillHealth;
    installedCommit?: string;
    remoteCommit?: string;
    /** Branch or tag that was resolved, e.g. `main` or `v1.2.0`. */
    resolvedLabel?: string;
    /** A newer semver tag that is outside the pinned tag / range. */
    newerVersion?: string;
    error?: string;
    /** Set when the last sync installed or updated this skill. */
    changed?: 'installed' | 'updated';
}

export type FileChangeKind =
    | 'modified'
    | 'added'
    | 'deleted'
    | 'renamed'
    | 'copied'
    | 'untracked'
    | 'conflicted'
    | 'typechange';

export interface FileChange {
    path: string;
    origPath?: string;
    kind: FileChangeKind;
    staged: boolean;
    /** Raw two-letter porcelain code, e.g. ` M` or `??`. */
    code: string;
}

export interface RepoStatus {
    path: string;
    cloned: boolean;
    branch?: string;
    head?: string;
    detached: boolean;
    /** Tag the repository is pinned to (the `mindpool.tag` setting). */
    tag?: string;
    readOnly: boolean;
    ahead: number;
    behind: number;
    changes: FileChange[];
    /** Semver tags newer than the pinned tag. */
    newerTags: string[];
    /** Last fetch problem (offline, auth, …). */
    upstreamError?: string;
    /** In-progress git operation that needs manual resolution. */
    operation?: 'merge' | 'rebase' | 'cherry-pick';
    remoteUrl?: string;
}

export type PoolPhase = 'noFolder' | 'noConfig' | 'invalidConfig' | 'notCloned' | 'ready';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
    time: string;
    level: LogLevel;
    message: string;
}

export interface LinkTargetStatus {
    /** Absolute folder that receives the links. */
    path: string;
    /** Skill links currently in place there. */
    linked: number;
}

/** Skill links requested by the `mindpool.linkSkillsTo` setting. */
export interface LinkState {
    targets: LinkTargetStatus[];
    /** Links that could not be created (name taken, no SKILL.md, invalid folder, …). */
    problems: string[];
}

export interface ManifestInfo {
    exists: boolean;
    path?: string;
    name?: string;
    error?: string;
}

export interface PoolState {
    phase: PoolPhase;
    poolFolder?: string;
    config?: PoolConfig;
    /** Raw setting values, used to pre-fill the edit form even when invalid. */
    configDraft?: Partial<PoolSettings>;
    configError?: string;
    repo?: RepoStatus;
    manifest: ManifestInfo;
    skills: SkillStatus[];
    /** Folders inside mindSkills that are no longer declared in skill.json. */
    orphans: string[];
    skillsDir?: string;
    /** Set when `mindpool.linkSkillsTo` names folders (or links are still being cleaned up). */
    links?: LinkState;
    busy?: string;
    lastSync?: string;
    lastError?: string;
    log: LogEntry[];
    autoUpdateSkills: boolean;
}

export interface RemoteInfo {
    ok: boolean;
    defaultBranch?: string;
    branches: string[];
    tags: string[];
    latestVersion?: string;
    error?: string;
}

/** Commands the webview can ask the host to run. */
export const HOST_COMMANDS = [
    'sync',
    'pull',
    'push',
    'openInNewWindow',
    'selectFolder',
    'openManifest',
    'createManifest',
    'updateSkills',
    'revealSkillsFolder',
    'openSettings',
    'showLog',
    'clearLog',
    'pruneOrphans',
] as const;

export type HostCommand = (typeof HOST_COMMANDS)[number];

export type RemotePurpose = 'config' | 'skill';

export type WebviewToHost =
    | { type: 'ready' }
    | { type: 'run'; command: HostCommand }
    | { type: 'commit'; message: string; files: string[]; push: boolean }
    | { type: 'saveConfig'; config: PoolSettings }
    | { type: 'inspectRemote'; url: string; requestId: number; purpose: RemotePurpose }
    | { type: 'addSkill'; name: string; spec: SkillSpec }
    | { type: 'removeSkill'; name: string }
    | { type: 'updateSkill'; name: string; reinstall: boolean }
    | { type: 'revealSkill'; name: string }
    | { type: 'openChange'; path: string };

/** Operations whose outcome the webview waits for (to clear a draft or close a form). */
export type TrackedOperation = 'commit' | 'addSkill' | 'saveConfig';

export type HostToWebview =
    | { type: 'state'; state: PoolState; home?: string }
    | { type: 'remoteInfo'; requestId: number; purpose: RemotePurpose; info: RemoteInfo }
    | { type: 'result'; op: TrackedOperation; ok: boolean };

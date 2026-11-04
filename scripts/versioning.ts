/**
 * Release rules for `npm run bump`. They decide whether MindPool needs a new version, which one,
 * and what goes into CHANGELOG.md.
 *
 * Everything here is pure (no git, no file system), so every rule is unit-tested. The command
 * line that reads git and writes files is scripts/bump.ts.
 *
 * How a commit counts (Semantic Versioning + Conventional Commits):
 *
 *   feat: …                                       → minor
 *   fix: … · perf: … · revert: …                  → patch
 *   type!: … or a "BREAKING CHANGE:" footer       → major (minor while the version is 0.x)
 *   docs · test · ci · chore · build · style · refactor → no release
 *   anything else (not Conventional Commits)      → patch if it touches shipped files,
 *                                                   otherwise no release
 */
import { compareVersions, parseVersion, type SemVer } from '../src/VsCodeExtension/core/semver.ts';

export type BumpLevel = 'major' | 'minor' | 'patch';
/** `initial`: first release ever. `pending`: package.json was bumped by hand but never tagged. */
export type ReleaseKind = BumpLevel | 'initial' | 'pending' | 'manual';
export type ChangeGroup = 'breaking' | 'feat' | 'fix' | 'perf' | 'revert' | 'other';

export const TAG_PREFIX = 'v';

/** `git log --name-only` format understood by parseGitLog. */
export const LOG_FORMAT = '%x1e%H%x1f%s%x1f%b%x1f';

export interface RawCommit {
    sha: string;
    subject: string;
    body: string;
    files: readonly string[];
}

export interface ClassifiedCommit extends RawCommit {
    /** Conventional Commits type, lower case. Undefined for other messages. */
    type?: string;
    scope?: string;
    description: string;
    breaking: boolean;
    /** Undefined when the commit doesn't need a release. */
    level?: BumpLevel;
    group?: ChangeGroup;
    /** Why the commit does or doesn't count, for the report. */
    note: string;
}

export interface ReleasePlan {
    needed: boolean;
    /** Version in package.json. */
    current: string;
    /** Last released version (from the newest tag), undefined before the first release. */
    previous?: string;
    /** Version to release, when one is needed. */
    next?: string;
    kind?: ReleaseKind;
    reason: string;
    commits: ClassifiedCommit[];
}

// ── shipped files ──────────────────────────────────────────────────────────────

/**
 * Paths whose changes reach users: the sources bundled into dist/main.cjs and the files that
 * .vscodeignore ships in the .vsix. Only used for commits that don't follow Conventional Commits.
 */
const SHIPPED_PREFIXES = ['src/', 'media/', 'schemas/'];
const SHIPPED_FILES = new Set(['package.json', 'scripts/build.ts']);
const NOT_SHIPPED_PREFIXES = ['src/test/'];

export function isShippedPath(file: string): boolean {
    const p = file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (NOT_SHIPPED_PREFIXES.some((prefix) => p.startsWith(prefix))) {
        return false;
    }
    return SHIPPED_FILES.has(p) || SHIPPED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

// ── commits ────────────────────────────────────────────────────────────────────

const HEADER_RE = /^(?<type>[A-Za-z]+)(?:\((?<scope>[^()\r\n]*)\))?(?<bang>!)?:[ \t]*(?<description>\S.*)$/;
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:[ \t]*\S/m;
const PATCH_TYPES = new Map<string, ChangeGroup>([
    ['fix', 'fix'],
    ['perf', 'perf'],
    ['revert', 'revert'],
]);
const SILENT_TYPES = new Set(['docs', 'test', 'tests', 'ci', 'chore', 'build', 'style', 'refactor']);

export function classifyCommit(commit: RawCommit): ClassifiedCommit {
    const subject = commit.subject.trim();
    const match = HEADER_RE.exec(subject);
    if (match?.groups) {
        const type = (match.groups['type'] ?? '').toLowerCase();
        const scope = match.groups['scope']?.trim() || undefined;
        const description = (match.groups['description'] ?? '').trim();
        const breaking = match.groups['bang'] === '!' || BREAKING_FOOTER_RE.test(commit.body);
        const base = { ...commit, type, scope, description, breaking };
        if (breaking) {
            return { ...base, level: 'major', group: 'breaking', note: 'breaking change' };
        }
        if (type === 'feat') {
            return { ...base, level: 'minor', group: 'feat', note: 'new feature' };
        }
        const patchGroup = PATCH_TYPES.get(type);
        if (patchGroup) {
            return { ...base, level: 'patch', group: patchGroup, note: type === 'fix' ? 'bug fix' : type };
        }
        if (SILENT_TYPES.has(type)) {
            return { ...base, note: `${type}: no release` };
        }
        // Unknown type (e.g. "wip:"): judge it by the files it touches, like any other message.
    }
    const base = { ...commit, description: subject, breaking: false };
    if (commit.files.some(isShippedPath)) {
        return { ...base, level: 'patch', group: 'other', note: 'changes shipped files' };
    }
    return { ...base, note: 'no shipped files changed' };
}

/** Parses `git log --name-only --format=${LOG_FORMAT}`. */
export function parseGitLog(output: string): RawCommit[] {
    const commits: RawCommit[] = [];
    for (const record of output.split('\x1e')) {
        if (!record.trim()) {
            continue;
        }
        const [sha = '', subject = '', body = '', rest = ''] = record.split('\x1f');
        commits.push({
            sha: sha.trim(),
            subject: subject.trim(),
            body: body.trim(),
            files: rest
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
        });
    }
    return commits;
}

// ── versions ───────────────────────────────────────────────────────────────────

const LEVEL_RANK: Record<BumpLevel, number> = { patch: 1, minor: 2, major: 3 };
const LEVEL_WORDS: Record<BumpLevel, string> = { major: 'breaking change', minor: 'new feature', patch: 'fix' };

function formatVersion(v: SemVer): string {
    return `${v.major}.${v.minor}.${v.patch}`;
}

/** Parses a plain X.Y.Z version. The VS Code Marketplace doesn't accept pre-release versions. */
function parsePlain(version: string, what: string): SemVer {
    const v = parseVersion(version);
    if (!v || v.prerelease.length > 0 || /^[vV=]/.test(version.trim())) {
        throw new Error(`${what} "${version}" is not a plain X.Y.Z version.`);
    }
    return v;
}

export function bumpVersion(version: string, level: BumpLevel): string {
    const v = parsePlain(version, 'Version');
    switch (level) {
        case 'major':
            return `${v.major + 1}.0.0`;
        case 'minor':
            return `${v.major}.${v.minor + 1}.0`;
        case 'patch':
            return `${v.major}.${v.minor}.${v.patch + 1}`;
    }
}

/** Newest `vX.Y.Z` tag among `names` (pre-releases and other tags are ignored). */
export function latestReleaseTag(names: readonly string[]): string | undefined {
    let best: { name: string; version: SemVer } | undefined;
    for (const raw of names) {
        const name = raw.trim();
        const rest = name.slice(TAG_PREFIX.length);
        if (!name.startsWith(TAG_PREFIX) || !/^\d/.test(rest)) {
            continue;
        }
        const version = parseVersion(rest);
        if (!version || version.prerelease.length > 0) {
            continue;
        }
        if (!best || compareVersions(version, best.version) > 0) {
            best = { name, version };
        }
    }
    return best?.name;
}

export interface DecideInput {
    packageVersion: string;
    /** Newest release tag reachable from HEAD, e.g. "v1.2.0". */
    lastTag?: string;
    /** Commits since that tag (all commits when there is no tag). */
    commits: readonly RawCommit[];
    /** major | minor | patch | X.Y.Z: overrides the automatic choice. */
    releaseAs?: string;
}

export function decideRelease(input: DecideInput): ReleasePlan {
    const current = parsePlain(input.packageVersion, 'package.json version');
    const commits = input.commits.map(classifyCommit);
    const lastVersion = input.lastTag ? parseVersion(input.lastTag.slice(TAG_PREFIX.length)) : undefined;
    const previous = lastVersion ? formatVersion(lastVersion) : undefined;
    const base = { current: input.packageVersion, previous, commits };

    if (lastVersion && compareVersions(current, lastVersion) < 0) {
        throw new Error(`package.json (${input.packageVersion}) is older than the latest release tag ${input.lastTag}.`);
    }

    if (input.releaseAs !== undefined) {
        const wanted = input.releaseAs.trim();
        const next = wanted === 'major' || wanted === 'minor' || wanted === 'patch' ? bumpVersion(input.packageVersion, wanted) : formatVersion(parsePlain(wanted, '--release-as'));
        const nextVersion = parsePlain(next, 'Version');
        if (lastVersion && compareVersions(nextVersion, lastVersion) <= 0) {
            throw new Error(`${next} is not newer than the latest release ${input.lastTag}.`);
        }
        if (compareVersions(nextVersion, current) < 0) {
            throw new Error(`${next} is lower than the version in package.json (${input.packageVersion}).`);
        }
        return { ...base, needed: true, next, kind: 'manual', reason: `Version chosen with --release-as ${wanted}.` };
    }

    if (!lastVersion) {
        return {
            ...base,
            needed: true,
            next: formatVersion(current),
            kind: 'initial',
            reason: `There is no ${TAG_PREFIX}X.Y.Z tag yet, so ${formatVersion(current)} from package.json becomes the first release.`,
        };
    }

    if (compareVersions(current, lastVersion) > 0) {
        return {
            ...base,
            needed: true,
            next: formatVersion(current),
            kind: 'pending',
            reason: `package.json is already at ${formatVersion(current)}, which has no tag yet.`,
        };
    }

    if (commits.length === 0) {
        return { ...base, needed: false, reason: `No commits since ${input.lastTag}.` };
    }
    const releasable = commits.filter((c) => c.level !== undefined);
    const counted = `${commits.length} commit${commits.length === 1 ? '' : 's'} since ${input.lastTag}`;
    if (releasable.length === 0) {
        return { ...base, needed: false, reason: `${counted}, but none of them change the extension (docs, tests, tooling…).` };
    }
    let level: BumpLevel = 'patch';
    for (const commit of releasable) {
        if (commit.level && LEVEL_RANK[commit.level] > LEVEL_RANK[level]) {
            level = commit.level;
        }
    }
    // Semantic Versioning 0.x: breaking changes only bump the minor version.
    const effective: BumpLevel = current.major === 0 && level === 'major' ? 'minor' : level;
    return {
        ...base,
        needed: true,
        next: bumpVersion(input.packageVersion, effective),
        kind: effective,
        reason: `${releasable.length} of ${counted} change the extension. The biggest is a ${LEVEL_WORDS[level]}.`,
    };
}

// ── changelog ──────────────────────────────────────────────────────────────────

export const CHANGELOG_HEADER = [
    '# Changelog',
    '',
    'All notable changes to MindPool are documented here. Versions follow',
    '[Semantic Versioning](https://semver.org), and entries are generated by `npm run bump` from',
    '[Conventional Commits](https://www.conventionalcommits.org).',
    '',
].join('\n');

const GROUP_ORDER: readonly ChangeGroup[] = ['breaking', 'feat', 'fix', 'perf', 'revert', 'other'];
const GROUP_TITLES: Record<ChangeGroup, string> = {
    breaking: '💥 Breaking changes',
    feat: '✨ Features',
    fix: '🐛 Bug fixes',
    perf: '⚡ Performance',
    revert: '⏪ Reverts',
    other: '🔧 Other changes',
};

export interface ChangelogOptions {
    /** YYYY-MM-DD */
    date: string;
    /** Web address of the repository, for commit and compare links. */
    webUrl?: string;
}

export function renderChangelogSection(plan: ReleasePlan, options: ChangelogOptions): string {
    if (!plan.next) {
        throw new Error('No version to release.');
    }
    const tag = `${TAG_PREFIX}${plan.next}`;
    const { webUrl } = options;
    const target = webUrl ? (plan.previous ? `${webUrl}/compare/${TAG_PREFIX}${plan.previous}...${tag}` : `${webUrl}/tree/${tag}`) : undefined;
    const lines = [`## ${target ? `[${plan.next}](${target})` : plan.next} (${options.date})`, ''];

    if (plan.kind === 'initial') {
        lines.push('🎉 First release.', '');
        return lines.join('\n');
    }
    let listed = 0;
    for (const group of GROUP_ORDER) {
        const items = plan.commits.filter((c) => c.group === group);
        if (items.length === 0) {
            continue;
        }
        listed += items.length;
        lines.push(`### ${GROUP_TITLES[group]}`, '');
        for (const c of items) {
            const short = c.sha.slice(0, 7);
            const link = webUrl ? `[${short}](${webUrl}/commit/${c.sha})` : short;
            lines.push(`- ${c.scope ? `**${c.scope}:** ` : ''}${c.description} (${link})`);
        }
        lines.push('');
    }
    if (listed === 0) {
        lines.push('Maintenance release.', '');
    }
    return lines.join('\n');
}

/** Puts `section` above the newest entry, creating the file content when there is none. */
export function insertChangelog(existing: string | undefined, section: string): string {
    if (!existing?.trim()) {
        return `${CHANGELOG_HEADER}\n${section}`;
    }
    const index = existing.search(/^## /m);
    if (index === -1) {
        return `${existing.trimEnd()}\n\n${section}`;
    }
    return `${existing.slice(0, index)}${section}\n${existing.slice(index)}`;
}

export function hasChangelogEntry(changelog: string, version: string): boolean {
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^## \\[?${escaped}[\\]\\s(]`, 'm').test(changelog);
}

// ── files ──────────────────────────────────────────────────────────────────────

/**
 * Sets "version" in package.json or package-lock.json text (the lockfile also stores it under
 * packages[""]), keeping the file's indentation and line endings.
 */
export function setJsonVersion(text: string, version: string): string {
    const data = JSON.parse(text) as Record<string, unknown>;
    data['version'] = version;
    const packages = data['packages'];
    if (packages && typeof packages === 'object') {
        const rootPackage = (packages as Record<string, unknown>)[''];
        if (rootPackage && typeof rootPackage === 'object') {
            (rootPackage as Record<string, unknown>)['version'] = version;
        }
    }
    const indent = /^[{[]\r?\n([ \t]+)/.exec(text)?.[1] ?? '  ';
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let out = JSON.stringify(data, null, indent);
    if (eol !== '\n') {
        out = out.replace(/\n/g, eol);
    }
    return /\r?\n$/.test(text) ? `${out}${eol}` : out;
}

/**
 * Web address of the repository from package.json's "repository" field (string or { url }).
 * Credentials embedded in the URL are dropped, so they never end up in the changelog.
 */
export function repoWebUrl(repository: unknown): string | undefined {
    let raw: string | undefined;
    if (typeof repository === 'string') {
        raw = repository;
    } else if (repository && typeof repository === 'object') {
        const url = (repository as { url?: unknown }).url;
        raw = typeof url === 'string' ? url : undefined;
    }
    if (!raw?.trim()) {
        return undefined;
    }
    let url = raw.trim().replace(/^git\+/, '');
    const hosts: Record<string, string> = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' };
    const shorthand = /^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/.exec(url);
    if (shorthand) {
        url = `https://${hosts[shorthand[1] ?? 'github']}/${shorthand[2]}`;
    }
    const scp = /^[\w.-]+@([^:/\s]+):(?!\/)(.+)$/.exec(url);
    if (scp) {
        url = `https://${scp[1]}/${scp[2]}`;
    }
    const ssh = /^(?:ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(url);
    if (ssh) {
        url = `https://${ssh[1]}/${ssh[2]}`;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return undefined;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return undefined;
    }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '').replace(/\.git$/, '');
}

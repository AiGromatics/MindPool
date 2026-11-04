/**
 * Smart version bump for MindPool.
 *
 *   npm run bump:check   Shows whether a release is needed and which version (changes nothing).
 *   npm run bump         Makes the release: updates package.json, package-lock.json and
 *                        CHANGELOG.md, commits "chore(release): vX.Y.Z" and tags vX.Y.Z.
 *
 * Options (after `--`, e.g. `npm run bump -- --release-as minor`):
 *   --release-as <major|minor|patch|X.Y.Z>   choose the version yourself
 *   --no-git                                 only update the files (no commit, no tag)
 *   --json                                   machine-readable output, e.g. for CI
 *
 * The version is chosen from the commits since the last vX.Y.Z tag. The rules are in
 * scripts/versioning.ts. Nothing is ever pushed: run `git push --follow-tags` when you're happy.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import {
    type ClassifiedCommit,
    decideRelease,
    hasChangelogEntry,
    insertChangelog,
    latestReleaseTag,
    LOG_FORMAT,
    parseGitLog,
    type ReleasePlan,
    renderChangelogSection,
    repoWebUrl,
    setJsonVersion,
    TAG_PREFIX,
} from './versioning.ts';

const USAGE = 'Usage: node scripts/bump.ts [--apply] [--no-git] [--release-as major|minor|patch|X.Y.Z] [--json]';
const root = process.cwd();

function fail(message: string): never {
    process.stderr.write(`✖ ${message}\n`);
    process.exit(1);
}

function git(args: readonly string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

function tryGit(args: readonly string[]): string | undefined {
    try {
        return git(args).trim();
    } catch {
        return undefined;
    }
}

function gitErrorText(error: unknown): string {
    const stderr = (error as { stderr?: unknown }).stderr;
    return (typeof stderr === 'string' && stderr.trim()) || (error as Error).message;
}

function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ── options ────────────────────────────────────────────────────────────────────

let values: { apply?: boolean; 'no-git'?: boolean; 'release-as'?: string; json?: boolean; help?: boolean };
try {
    ({ values } = parseArgs({
        options: {
            apply: { type: 'boolean' },
            'no-git': { type: 'boolean' },
            'release-as': { type: 'string' },
            json: { type: 'boolean' },
            help: { type: 'boolean', short: 'h' },
        },
        strict: true,
    }));
} catch (error) {
    fail(`${(error as Error).message}\n${USAGE}`);
}
if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
}

// ── gather ─────────────────────────────────────────────────────────────────────

if (tryGit(['rev-parse', '--is-inside-work-tree']) !== 'true') {
    fail('Run this inside the MindPool git repository.');
}
if (!tryGit(['rev-parse', '-q', '--verify', 'HEAD'])) {
    fail('The repository has no commits yet.');
}
const packagePath = path.join(root, 'package.json');
if (!existsSync(packagePath)) {
    fail(`No package.json in ${root}.`);
}
const packageText = readFileSync(packagePath, 'utf8');
const packageJson = JSON.parse(packageText) as { version?: unknown; repository?: unknown };
if (typeof packageJson.version !== 'string') {
    fail('package.json has no "version".');
}
const packageVersion = packageJson.version;

const lastTag = latestReleaseTag(git(['tag', '--merged', 'HEAD', '--list', `${TAG_PREFIX}*`]).split('\n'));
const commits = parseGitLog(git(['log', '--no-merges', '--name-only', `--format=${LOG_FORMAT}`, lastTag ? `${lastTag}..HEAD` : 'HEAD']));

let plan: ReleasePlan;
try {
    plan = decideRelease({ packageVersion, lastTag, commits, releaseAs: values['release-as'] });
} catch (error) {
    fail((error as Error).message);
}

const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
const branch = tryGit(['symbolic-ref', '--short', '-q', 'HEAD']) || undefined;
const upstream = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) || undefined;
const behind = upstream ? Number(tryGit(['rev-list', '--count', 'HEAD..@{u}']) ?? '0') : 0;
const warnings: string[] = [];
if (dirty > 0) {
    warnings.push(`${plural(dirty, 'uncommitted change')} ${dirty === 1 ? 'is' : 'are'} not part of this check. Commit them first.`);
}
if (!branch) {
    warnings.push('HEAD is detached. Check out a branch before releasing.');
}
if (behind > 0) {
    warnings.push(`${branch} is ${plural(behind, 'commit')} behind ${upstream} (as of the last fetch). Pull first.`);
}

// ── report ─────────────────────────────────────────────────────────────────────

const ICONS: Record<string, string> = { breaking: '💥', feat: '✨', fix: '🐛', perf: '⚡', revert: '⏪', other: '🔧' };

function commitLine(c: ClassifiedCommit): string {
    const marker = c.group ? `${ICONS[c.group] ?? '•'} ${(c.level ?? '').padEnd(5)}` : ' ·      ';
    const note = c.level ? '' : `   (${c.note})`;
    return `  ${marker}  ${c.sha.slice(0, 7)}  ${c.subject}${note}`;
}

function report(): void {
    if (values.json) {
        const out = {
            needed: plan.needed,
            current: plan.current,
            previous: plan.previous ?? null,
            next: plan.next ?? null,
            tag: plan.next ? `${TAG_PREFIX}${plan.next}` : null,
            kind: plan.kind ?? null,
            reason: plan.reason,
            commits: plan.commits.map((c) => ({ sha: c.sha, subject: c.subject, level: c.level ?? null, group: c.group ?? null, note: c.note })),
            warnings,
        };
        process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
        return;
    }
    const counted = plan.commits.filter((c) => c.level).length;
    const lines = [
        '',
        'MindPool release check',
        '',
        `  package.json    ${plan.current}`,
        `  last release    ${lastTag ?? 'none yet'}`,
        `  commits         ${plan.commits.length}${lastTag ? ` since ${lastTag}` : ' in total'}${plan.kind === 'initial' ? '' : ` (${counted} need a release)`}`,
        '',
    ];
    if (plan.kind !== 'initial' && plan.commits.length > 0) {
        const shown = plan.commits.slice(0, 30);
        lines.push(...shown.map(commitLine));
        if (plan.commits.length > shown.length) {
            lines.push(`  … and ${plan.commits.length - shown.length} more`);
        }
        lines.push('');
    }
    if (plan.needed && plan.next) {
        const headline = plan.previous ? `→ Release needed: ${plan.previous} → ${plan.next}` : `→ First release: ${plan.next}`;
        lines.push(headline, `  ${plan.reason}`, '');
        if (!values.apply) {
            lines.push(`  Run \`npm run bump\` to update the version and CHANGELOG.md, then commit and tag ${TAG_PREFIX}${plan.next}.`, '');
        }
    } else {
        lines.push(`✔ No release needed. ${plan.reason}`, '');
    }
    for (const warning of warnings) {
        lines.push(`⚠ ${warning}`);
    }
    if (warnings.length > 0) {
        lines.push('');
    }
    process.stdout.write(lines.join('\n'));
}

report();

// ── apply ──────────────────────────────────────────────────────────────────────

/** Progress messages. With --json they go to stderr, so stdout stays valid JSON. */
function say(text: string): void {
    (values.json ? process.stderr : process.stdout).write(text);
}

function apply(next: string): void {
    const tag = `${TAG_PREFIX}${next}`;
    const useGit = !values['no-git'];
    if (useGit) {
        if (!branch) {
            fail('HEAD is detached. Check out the branch you release from.');
        }
        if (dirty > 0) {
            fail('The working tree has uncommitted changes. Commit or stash them first (or use --no-git).');
        }
        if (behind > 0) {
            fail(`${branch} is behind ${upstream}. Pull first.`);
        }
        if (tryGit(['rev-parse', '-q', '--verify', `refs/tags/${tag}`])) {
            fail(`Tag ${tag} already exists.`);
        }
    }
    const changelogPath = path.join(root, 'CHANGELOG.md');
    const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : undefined;
    if (changelog && hasChangelogEntry(changelog, next)) {
        fail(`CHANGELOG.md already has an entry for ${next}.`);
    }

    const written: string[] = [];
    for (const file of ['package.json', 'package-lock.json']) {
        const full = path.join(root, file);
        if (!existsSync(full)) {
            continue;
        }
        const text = readFileSync(full, 'utf8');
        const version = (JSON.parse(text) as { version?: unknown }).version;
        if (version !== next) {
            writeFileSync(full, setJsonVersion(text, next));
            written.push(file);
        }
    }
    const section = renderChangelogSection(plan, { date: today(), webUrl: repoWebUrl(packageJson.repository) });
    writeFileSync(changelogPath, insertChangelog(changelog, section));
    written.push('CHANGELOG.md');
    say(`✔ Updated ${written.join(', ')}\n`);

    if (!useGit) {
        say(`\nReview the files, then commit them and run \`git tag -a ${tag} -m "MindPool ${tag}"\`.\n`);
        return;
    }
    try {
        git(['add', '--', ...written]);
        git(['commit', '--quiet', '-m', `chore(release): ${tag}`]);
        git(['tag', '-a', tag, '-m', `MindPool ${tag}`]);
    } catch (error) {
        fail(`git failed: ${gitErrorText(error)}\nThe files above were updated. Finish the commit and tag by hand.`);
    }
    say(
        [
            `✔ Committed "chore(release): ${tag}" and tagged ${tag}`,
            '',
            'Next steps:',
            '  git push --follow-tags     publish the commit and the tag',
            `  npm run package            build mindpool-${next}.vsix`,
            '',
        ].join('\n'),
    );
}

if (values.apply) {
    if (plan.needed && plan.next) {
        apply(plan.next);
    } else {
        say('Nothing to release.\n');
    }
}

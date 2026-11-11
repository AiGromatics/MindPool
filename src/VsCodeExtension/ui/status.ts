import type { PoolState } from '../core/types.ts';

export type Tone = 'ok' | 'busy' | 'info' | 'warn' | 'error' | 'idle';

export interface OverallStatus {
    tone: Tone;
    label: string;
    detail: string;
    emoji: string;
}

/** One-line summary of the pool, shared by the status bar and the dashboard pill. */
export function overallStatus(state: PoolState | undefined): OverallStatus {
    if (!state) {
        return { tone: 'busy', label: 'Starting', detail: 'Waking up MindPool…', emoji: '🧠' };
    }
    if (state.busy) {
        return { tone: 'busy', label: state.busy, detail: `${state.busy}…`, emoji: '🌀' };
    }
    switch (state.phase) {
        case 'noFolder':
            return { tone: 'idle', label: 'Setup', detail: 'Choose a pool folder to get started', emoji: '👋' };
        case 'noConfig':
            return { tone: 'idle', label: 'Setup', detail: 'Connect your team skills repository', emoji: '🔌' };
        case 'invalidConfig':
            return { tone: 'error', label: 'Config error', detail: state.configError ?? 'The repository settings are invalid', emoji: '🧯' };
        case 'notCloned':
            return { tone: 'error', label: 'Not cloned', detail: state.lastError ?? 'The repository has not been downloaded yet', emoji: '📦' };
        case 'ready':
            break;
    }
    const repo = state.repo;
    const broken = state.skills.filter((s) => s.health === 'error' || s.health === 'dirty').length;
    const pending = state.skills.filter((s) => s.health === 'outdated' || s.health === 'missing').length;
    if (repo?.operation) {
        return { tone: 'error', label: 'Needs attention', detail: `A ${repo.operation} is in progress`, emoji: '🧩' };
    }
    if (state.lastError && !repo?.upstreamError) {
        return { tone: 'error', label: 'Needs attention', detail: state.lastError, emoji: '🧯' };
    }
    if (broken > 0) {
        return { tone: 'warn', label: `${broken} skill issue${broken === 1 ? '' : 's'}`, detail: 'Some skills could not be updated', emoji: '⚠️' };
    }
    if (repo?.upstreamError) {
        return { tone: 'warn', label: 'Offline', detail: repo.upstreamError, emoji: '📡' };
    }
    if ((repo?.behind ?? 0) > 0 || pending > 0) {
        const parts: string[] = [];
        if (repo && repo.behind > 0) {
            parts.push(`${repo.behind} commit${repo.behind === 1 ? '' : 's'} to pull`);
        }
        if (pending > 0) {
            parts.push(`${pending} skill update${pending === 1 ? '' : 's'}`);
        }
        return { tone: 'warn', label: 'Updates available', detail: parts.join(' · '), emoji: '🚀' };
    }
    if ((repo?.ahead ?? 0) > 0 || (repo?.changes.length ?? 0) > 0) {
        const parts: string[] = [];
        if (repo && repo.changes.length > 0) {
            parts.push(`${repo.changes.length} change${repo.changes.length === 1 ? '' : 's'}`);
        }
        if (repo && repo.ahead > 0) {
            parts.push(`${repo.ahead} to push`);
        }
        return { tone: 'info', label: 'Local changes', detail: parts.join(' · '), emoji: '✏️' };
    }
    const count = state.skills.length;
    return { tone: 'ok', label: 'All synced', detail: `${count} skill${count === 1 ? '' : 's'} up to date`, emoji: '✨' };
}

export function relativeTime(iso: string | undefined, now: Date = new Date()): string {
    if (!iso) {
        return 'never';
    }
    const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
    if (Number.isNaN(seconds)) {
        return 'never';
    }
    if (seconds < 45) {
        return 'just now';
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m ago`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return `${hours}h ago`;
    }
    return `${Math.round(hours / 24)}d ago`;
}

/** Shortens `/Users/me/pool` to `~/pool` for display. */
export function tildify(target: string | undefined, home: string | undefined): string {
    if (!target) {
        return '';
    }
    if (home && (target === home || target.startsWith(`${home}/`) || target.startsWith(`${home}\\`))) {
        return `~${target.slice(home.length)}`;
    }
    return target;
}

/** Turns a git URL into something short: `github.com/acme/skills`. */
export function prettyUrl(url: string): string {
    return url
        .trim()
        .replace(/^[a-z+]+:\/\//i, '')
        .replace(/^[^@/]+@/, '')
        .replace(/^([^/:]+):(?!\d)/, '$1/')
        .replace(/\.git$/i, '');
}

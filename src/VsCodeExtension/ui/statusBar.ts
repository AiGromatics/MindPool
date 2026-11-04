import * as vscode from 'vscode';
import type { PoolState } from '../core/types.ts';
import { overallStatus, prettyUrl, relativeTime, type Tone } from './status.ts';

const TONE_ICON: Record<Tone, string> = {
    ok: '$(sparkle)',
    busy: '$(sync~spin)',
    info: '$(git-commit)',
    warn: '$(rocket)',
    error: '$(error)',
    idle: '$(plug)',
};

/** Status bar entry: a glanceable health indicator that opens the dashboard on click. */
export class MindPoolStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly subscription: vscode.Disposable;

    constructor(getState: () => PoolState, onDidChange: vscode.Event<PoolState>) {
        this.item = vscode.window.createStatusBarItem('mindpool.status', vscode.StatusBarAlignment.Left, 40);
        this.item.name = 'MindPool';
        this.item.command = 'mindpool.dashboard.focus';
        this.subscription = onDidChange((state) => this.update(state));
        this.update(getState());
        this.item.show();
    }

    update(state: PoolState): void {
        const status = overallStatus(state);
        let iconText = TONE_ICON[status.tone];
        if (status.tone === 'warn' && status.label === 'Offline') {
            iconText = '$(cloud)';
        } else if (status.tone === 'warn' && status.label.includes('issue')) {
            iconText = '$(warning)';
        }
        const badge = state.phase === 'ready' && status.tone !== 'busy' ? ` ${state.skills.length}` : '';
        this.item.text = `${iconText} MindPool${badge}`;
        this.item.backgroundColor = status.tone === 'error' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;

        const tooltip = new vscode.MarkdownString(undefined, true);
        tooltip.appendMarkdown(`**MindPool** ${status.emoji} ${escapeMd(status.label)}\n\n${escapeMd(status.detail)}\n\n`);
        if (state.config) {
            const where = state.config.tag ? `release \`${state.config.tag}\`` : `branch \`${state.config.branch}\``;
            tooltip.appendMarkdown(`$(repo) ${escapeMd(prettyUrl(state.config.repository))} · ${where}\n\n`);
            tooltip.appendMarkdown(`$(sparkle) ${state.skills.length} skill${state.skills.length === 1 ? '' : 's'} · $(history) synced ${relativeTime(state.lastSync)}\n\n`);
        }
        tooltip.appendMarkdown('_Click to open the dashboard_');
        this.item.tooltip = tooltip;
    }

    dispose(): void {
        this.subscription.dispose();
        this.item.dispose();
    }
}

function escapeMd(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

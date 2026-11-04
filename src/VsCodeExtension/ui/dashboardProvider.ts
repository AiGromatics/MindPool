import * as os from 'node:os';
import * as vscode from 'vscode';
import type { HostToWebview, PoolState, WebviewToHost } from '../core/types.ts';
import { buildHtml, createNonce } from './html.ts';
import { parseWebviewMessage } from './messages.ts';

export interface DashboardHost {
    readonly state: PoolState;
    readonly onDidChangeState: vscode.Event<PoolState>;
    handleMessage(message: WebviewToHost, reply: (message: HostToWebview) => void): Promise<void>;
    refreshLocal(): Promise<unknown>;
}

/** The interactive sidebar dashboard (activity bar → MindPool). */
export class DashboardViewProvider implements vscode.WebviewViewProvider {
    static readonly viewId = 'mindpool.dashboard';
    private readonly host: DashboardHost;
    private view?: vscode.WebviewView;
    private postTimer?: ReturnType<typeof setTimeout>;

    constructor(host: DashboardHost) {
        this.host = host;
    }

    get isResolved(): boolean {
        return this.view !== undefined;
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [] };
        view.webview.html = buildHtml({ nonce: createNonce(), cspSource: view.webview.cspSource });

        const subscriptions = [
            view.webview.onDidReceiveMessage((raw: unknown) => {
                const message = parseWebviewMessage(raw);
                if (!message) {
                    return;
                }
                if (message.type === 'ready') {
                    this.postState();
                    return;
                }
                void this.host.handleMessage(message, (reply) => this.post(reply));
            }),
            this.host.onDidChangeState(() => this.schedulePost()),
            view.onDidChangeVisibility(() => {
                if (view.visible) {
                    this.postState();
                    void this.host.refreshLocal();
                }
            }),
        ];
        view.onDidDispose(() => {
            subscriptions.forEach((s) => s.dispose());
            this.view = undefined;
        });
    }

    /** The engine emits many small updates during a sync; coalesce them into one post. */
    private schedulePost(): void {
        if (this.postTimer) {
            return;
        }
        this.postTimer = setTimeout(() => {
            this.postTimer = undefined;
            this.postState();
        }, 40);
    }

    private postState(): void {
        this.post({ type: 'state', state: this.host.state, home: os.homedir() });
    }

    private post(message: HostToWebview): void {
        void this.view?.webview.postMessage(message);
    }
}

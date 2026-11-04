import * as vscode from 'vscode';
import { MindPoolController, type MindPoolApi } from './controller.ts';
import { DashboardViewProvider } from './ui/dashboardProvider.ts';
import { MindPoolStatusBar } from './ui/statusBar.ts';

export type { MindPoolApi } from './controller.ts';

export function activate(context: vscode.ExtensionContext): MindPoolApi {
    const output = vscode.window.createOutputChannel('MindPool', { log: true });
    const controller = new MindPoolController(output);
    const dashboard = new DashboardViewProvider(controller);

    context.subscriptions.push(
        output,
        controller,
        vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, dashboard),
        new MindPoolStatusBar(() => controller.state, controller.onDidChangeState),
        ...controller.registerCommands(),
    );

    controller.start();
    return controller.api();
}

export function deactivate(): void {
    // Everything is released through context.subscriptions.
}

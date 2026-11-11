/**
 * Runs inside a real VS Code instance (see runE2E.ts). Bundled to dist/test/suite.cjs.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { PoolState } from '../../VsCodeExtension/core/types.ts';
import type { MindPoolApi } from '../../VsCodeExtension/extension.ts';

const EXTENSION_ID = 'aigromatics.mindpool';

function env(name: string): string {
    const value = process.env[name];
    assert.ok(value, `${name} must be set by runE2E.ts`);
    return value;
}

async function waitFor(api: MindPoolApi, predicate: (state: PoolState) => boolean, what: string, timeoutMs = 60_000): Promise<PoolState> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (predicate(api.state) && !api.state.busy) {
            return api.state;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out waiting for ${what}. Last state: ${JSON.stringify({ phase: api.state.phase, busy: api.state.busy, lastError: api.state.lastError, log: api.state.log.slice(0, 5) })}`);
}

export async function run(): Promise<void> {
    const pool = env('MINDPOOL_E2E_POOL');
    const teamUrl = env('MINDPOOL_E2E_TEAM_URL');
    const teamWork = env('MINDPOOL_E2E_TEAM_WORK');
    const skillTwo = env('MINDPOOL_E2E_SKILL_TWO');
    const repoDir = path.join(pool, 'team-skills');
    let api: MindPoolApi | undefined;
    const tests: [string, () => Promise<void>][] = [];
    const it = (name: string, fn: () => Promise<void>): void => {
        tests.push([name, fn]);
    };

    it('activates and exposes its API', async () => {
        const extension = vscode.extensions.getExtension<MindPoolApi>(EXTENSION_ID);
        assert.ok(extension, 'extension is installed');
        api = await extension.activate();
        assert.equal(extension.isActive, true);
        assert.equal(typeof api.sync, 'function');
    });

    it('registers every command', async () => {
        const commands = await vscode.commands.getCommands(true);
        for (const id of ['sync', 'selectFolder', 'pull', 'commit', 'push', 'openInNewWindow', 'openSettings', 'openManifest', 'addSkill', 'updateSkills', 'revealSkillsFolder']) {
            assert.ok(commands.includes(`mindpool.${id}`), `mindpool.${id} is registered`);
        }
    });

    it('starts on the welcome screen without a pool folder', async () => {
        assert.equal(api?.state.phase, 'noFolder');
    });

    it('opens the dashboard webview', async () => {
        await vscode.commands.executeCommand('workbench.view.extension.mindpool');
        await vscode.commands.executeCommand('mindpool.dashboard.focus');
    });

    it('clones the repository from the settings and installs skills into mindSkills', async () => {
        assert.ok(api);
        const settings = vscode.workspace.getConfiguration('mindpool');
        await settings.update('repository', teamUrl, vscode.ConfigurationTarget.Global);
        await settings.update('poolFolder', pool, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('mindpool.sync');
        const state = await waitFor(api, (s) => s.phase === 'ready' && s.skills.length === 1 && s.skills.every((k) => k.health === 'ok'), 'the first sync');
        assert.equal(state.lastError, undefined);
        assert.equal(readFileSync(path.join(repoDir, 'mindSkills', 'prompt-crafter', 'SKILL.md'), 'utf8'), '# Prompt crafter\n');
        assert.deepEqual(state.repo?.changes, [], 'mindSkills is not versioned');
        assert.match(readFileSync(path.join(repoDir, '.git', 'info', 'exclude'), 'utf8'), /\/mindSkills\//);
    });

    it('follows a teammate who adds a skill and pushes', async () => {
        assert.ok(api);
        const manifestPath = path.join(teamWork, 'skill.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { skills: Record<string, unknown> };
        manifest.skills['test-writer'] = skillTwo;
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
        const git = (...args: string[]): string => execFileSync('git', args, { cwd: teamWork, encoding: 'utf8' });
        git('commit', '--quiet', '-am', 'Add test-writer');
        git('push', '--quiet', 'origin', 'HEAD:main');

        await vscode.commands.executeCommand('mindpool.sync');
        const state = await waitFor(api, (s) => s.skills.some((k) => k.name === 'test-writer' && k.health === 'ok'), 'the teammate skill');
        assert.equal(state.repo?.behind, 0);
        assert.ok(existsSync(path.join(repoDir, 'mindSkills', 'test-writer', 'SKILL.md')));
    });

    it('opens the MindPool settings', async () => {
        await vscode.commands.executeCommand('mindpool.openSettings');
        assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.label, 'Settings');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    it('opens skill.json in an editor', async () => {
        await vscode.commands.executeCommand('mindpool.openManifest');
        assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, path.join(repoDir, 'skill.json'));
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    it('follows a change of the repository settings', async () => {
        assert.ok(api);
        await vscode.workspace.getConfiguration('mindpool').update('directory', 'moved', vscode.ConfigurationTarget.Global);
        const moved = path.join(pool, 'moved');
        const state = await waitFor(api, (s) => s.repo?.path === moved && s.phase === 'ready' && s.skills.length === 2 && s.skills.every((k) => k.health === 'ok'), 'the new clone folder');
        assert.equal(state.config?.directory, 'moved');
        assert.ok(existsSync(path.join(moved, 'mindSkills', 'test-writer', 'SKILL.md')));
    });

    let failures = 0;
    for (const [name, fn] of tests) {
        try {
            await fn();
            console.log(`  ✔ ${name}`);
        } catch (error) {
            failures++;
            console.error(`  ✖ ${name}\n    ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        }
    }
    console.log(`\n${tests.length - failures}/${tests.length} end-to-end tests passed`);
    if (failures > 0) {
        throw new Error(`${failures} end-to-end test(s) failed`);
    }
}

/**
 * End-to-end test runner: builds a git fixture (team repository + skill repositories as
 * local bare remotes), then launches a real VS Code with MindPool loaded and runs
 * src/test/e2e/suite.ts inside it.
 *
 * Usage: npm run test:e2e
 *   MINDPOOL_VSCODE_VERSION=1.100.0   test against a specific VS Code version (default: stable)
 *   MINDPOOL_VSCODE_EXECUTABLE=/path  use an existing VS Code binary instead of downloading
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import { Sandbox, skillJson } from '../helpers.ts';

// When launched from a VS Code terminal this is set, and would make the test instance
// start as plain Node.js instead of the editor.
delete process.env['ELECTRON_RUN_AS_NODE'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sandbox = new Sandbox('mindpool-e2e-');

const skillOne = sandbox.remote('prompt-crafter', { 'SKILL.md': '# Prompt crafter\n' });

skillOne.tag('v1.0.0');

const skillTwo = sandbox.remote('test-writer', { 'SKILL.md': '# Test writer\n' });

const team = sandbox.remote('team-skills', {
    'skill.json': skillJson({ 'prompt-crafter': { repository: skillOne.url, version: '^1.0.0' } }),
    'README.md': '# Team skills\n',
});

const pool = sandbox.path('pool');

let exitCode = 0;
try {
    exitCode = await runTests({
        version: process.env['MINDPOOL_VSCODE_VERSION'] ?? 'stable',
        vscodeExecutablePath: process.env['MINDPOOL_VSCODE_EXECUTABLE'],
        extensionDevelopmentPath: root,
        extensionTestsPath: path.join(root, 'dist', 'test', 'suite.cjs'),
        launchArgs: [
            '--disable-extensions',
            '--disable-workspace-trust',
            '--skip-welcome',
            '--skip-release-notes',
            `--user-data-dir=${sandbox.path('user-data')}`,
            `--extensions-dir=${sandbox.path('extensions')}`,
        ],
        extensionTestsEnv: {
            MINDPOOL_E2E_POOL: pool,
            MINDPOOL_E2E_TEAM_URL: team.url,
            MINDPOOL_E2E_TEAM_WORK: team.work,
            MINDPOOL_E2E_SKILL_TWO: skillTwo.url,
        },
    });
} catch (error) {
    console.error('✖ end-to-end tests failed:', error);
    exitCode = 1;
} finally {
    sandbox.cleanup();
}
process.exit(exitCode);

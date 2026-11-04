/**
 * Builds MindPool into ONE monolithic file: dist/main.cjs.
 *
 *  1. The webview client (src/VsCodeExtension/ui/client.ts) is bundled for the browser.
 *  2. Its code is injected as a string constant into the extension bundle (src/main.ts),
 *     so the dashboard needs no extra script files at runtime.
 *
 * Usage: node scripts/build.ts [--watch] [--e2e] [--dev]
 */
import { watch as watchFs } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const watchMode = args.has('--watch');
const production = !watchMode && !args.has('--dev');
const withE2E = args.has('--e2e');

async function buildClient(): Promise<string> {
    const result = await esbuild.build({
        absWorkingDir: root,
        entryPoints: ['src/VsCodeExtension/ui/client.ts'],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2022',
        minify: production,
        legalComments: 'none',
        logLevel: 'warning',
    });
    const file = result.outputFiles[0];
    if (!file) {
        throw new Error('esbuild produced no webview client output');
    }
    return file.text;
}

async function buildExtension(client: string): Promise<void> {
    await esbuild.build({
        absWorkingDir: root,
        entryPoints: ['src/main.ts'],
        outfile: 'dist/main.cjs',
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        external: ['vscode'],
        minify: production,
        sourcemap: production ? false : 'linked',
        legalComments: 'none',
        define: { __WEBVIEW_SCRIPT__: JSON.stringify(client) },
        logLevel: 'warning',
    });
}

async function buildE2ESuite(): Promise<void> {
    await esbuild.build({
        absWorkingDir: root,
        entryPoints: ['src/test/e2e/suite.ts'],
        outfile: 'dist/test/suite.cjs',
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        external: ['vscode'],
        sourcemap: 'inline',
        logLevel: 'warning',
    });
}

async function buildAll(): Promise<void> {
    const started = Date.now();
    const client = await buildClient();
    await buildExtension(client);
    if (withE2E) {
        await buildE2ESuite();
    }
    const kb = (Buffer.byteLength(client) / 1024).toFixed(1);
    console.log(`✔ dist/main.cjs built in ${Date.now() - started}ms (webview client ${kb} KB inlined${production ? ', minified' : ''})`);
}

await mkdir(path.join(root, 'dist'), { recursive: true });
if (!watchMode) {
    await rm(path.join(root, 'dist', 'main.cjs.map'), { force: true });
}
await buildAll();

if (watchMode) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    console.log('👀 watching src/ for changes…');
    watchFs(path.join(root, 'src'), { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            buildAll().catch((error: unknown) => console.error(error));
        }, 120);
    });
}

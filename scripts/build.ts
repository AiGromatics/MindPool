/**
 * Builds MindPool into ONE monolithic file: dist/main.cjs.
 *
 *  1. The webview client (src/VsCodeExtension/ui/client.ts) is bundled for the browser.
 *  2. Its code is injected as a string constant into the extension bundle (src/main.ts),
 *     so the dashboard needs no extra script files at runtime.
 *  3. The AIgromatics brand fonts (media/fonts, SIL OFL 1.1) are inlined the same way, as
 *     @font-face rules with data: URIs, so the webview needs no font files either.
 *
 * Usage: node scripts/build.ts [--watch] [--e2e] [--dev]
 */
import { watch as watchFs } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
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

/** Latin subsets from Google Fonts. Other scripts fall back to the VS Code UI font per glyph. */
const BRAND_FONTS = [
    { family: 'Schibsted Grotesk', weight: '400 800', file: 'SchibstedGrotesk-Variable-latin.woff2' },
    { family: 'IBM Plex Mono', weight: '400', file: 'IBMPlexMono-Regular-latin.woff2' },
    { family: 'IBM Plex Mono', weight: '600', file: 'IBMPlexMono-SemiBold-latin.woff2' },
];

async function buildFontFaces(): Promise<string> {
    const faces = await Promise.all(
        BRAND_FONTS.map(async (font) => {
            const data = await readFile(path.join(root, 'media', 'fonts', font.file));
            return `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${font.weight};font-display:block;src:url(data:font/woff2;base64,${data.toString('base64')}) format("woff2")}`;
        }),
    );
    return faces.join('');
}

async function buildExtension(client: string, fonts: string): Promise<void> {
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
        define: { __WEBVIEW_SCRIPT__: JSON.stringify(client), __BRAND_FONTS__: JSON.stringify(fonts) },
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
    const [client, fonts] = await Promise.all([buildClient(), buildFontFaces()]);
    await buildExtension(client, fonts);
    if (withE2E) {
        await buildE2ESuite();
    }
    const kb = (Buffer.byteLength(client) / 1024).toFixed(1);
    const fontKb = (Buffer.byteLength(fonts) / 1024).toFixed(1);
    console.log(`✔ dist/main.cjs built in ${Date.now() - started}ms (webview client ${kb} KB + brand fonts ${fontKb} KB inlined${production ? ', minified' : ''})`);
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

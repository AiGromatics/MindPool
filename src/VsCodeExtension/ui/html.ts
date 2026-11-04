import { renderLoading } from './render.ts';
import { STYLES } from './styles.ts';

/**
 * The webview client (src/VsCodeExtension/ui/client.ts) is compiled by scripts/build.ts and
 * injected here as a string, so the whole extension ships as a single monolithic bundle.
 */
declare const __WEBVIEW_SCRIPT__: string;

export function webviewScript(): string {
    return typeof __WEBVIEW_SCRIPT__ === 'string' ? __WEBVIEW_SCRIPT__ : '';
}

export function createNonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export interface HtmlOptions {
    nonce: string;
    cspSource: string;
    script?: string;
}

export function buildHtml(options: HtmlOptions): string {
    const { nonce, cspSource } = options;
    const script = (options.script ?? webviewScript()).replace(/<\/script/gi, '<\\/script');
    const csp = [
        `default-src 'none'`,
        `img-src ${cspSource} data:`,
        `font-src ${cspSource}`,
        `style-src 'nonce-${nonce}'`,
        `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MindPool</title>
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
<div id="app">${renderLoading()}</div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

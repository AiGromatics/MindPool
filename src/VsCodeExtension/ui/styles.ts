/**
 * Dashboard stylesheet in the AIgromatics brand: verde panels, bronze accents, the survey grid,
 * Schibsted Grotesk for the interface and IBM Plex Mono for the wordmark, labels and data.
 *
 * Light and dark VS Code themes get the brand palettes (body.vscode-light / body.vscode-dark).
 * High contrast themes map every token back to VS Code's own colours, so accessibility wins
 * over branding there. All tone/text pairings are checked at WCAG AA (4.5:1) in both palettes.
 * Motion is short, ease-out, plays entrances once (see client.ts markEntered) and is removed
 * entirely for reduced-motion users.
 */
export const STYLES = /* css */ `
:root {
    /* Fallbacks inside var() keep the stacks valid even where VS Code's variables are missing. */
    --mp-font: "Schibsted Grotesk", var(--vscode-font-family, system-ui), "Helvetica Neue", Arial, sans-serif;
    --mp-mono: "IBM Plex Mono", var(--vscode-editor-font-family, ui-monospace), Menlo, monospace;
    --mp-radius: 14px;
    --mp-radius-sm: 10px;
    --mp-gap: 10px;
    --mp-ease: cubic-bezier(.16, 1, .3, 1);

    /* AIgromatics light */
    --mp-page: #F2F4F3;
    --mp-card: #FAFBFA;
    --mp-inset: #F2F4F3;
    --mp-field: #FFFFFF;
    --mp-raised: #E7ECEA;
    --mp-ink: #132422;
    --mp-ink-2: #3D524F;
    --mp-muted: #566B68;
    --mp-border: #CAD5D2;
    --mp-border-strong: #A9B9B5;
    --mp-accent: #1F5C55;
    --mp-accent-text: #1F5C55;
    --mp-accent-hover: #174A44;
    --mp-on-accent: #F0F3F3;
    --mp-bronze: #DFB15A;
    --mp-ok: #1F5C55;
    --mp-warn: #855F1C;
    --mp-error: #A6472A;
    --mp-info: #1F5C55;
    --mp-grid: rgba(31, 92, 85, .07);
    --mp-shadow: rgba(22, 69, 64, .12);
}
body.vscode-dark {
    /* AIgromatics dark */
    --mp-page: #0E1D1B;
    --mp-card: #132826;
    --mp-inset: #0E1D1B;
    --mp-field: #0A1715;
    --mp-raised: rgba(230, 238, 236, .08);
    --mp-ink: #E6EEEC;
    --mp-ink-2: #B2C3BF;
    --mp-muted: #8FA6A1;
    --mp-border: rgba(230, 238, 236, .13);
    --mp-border-strong: rgba(230, 238, 236, .26);
    --mp-accent: #6CC1B2;
    --mp-accent-text: #6CC1B2;
    --mp-accent-hover: #8AD2C5;
    --mp-on-accent: #0E1D1B;
    --mp-bronze: #E0B45E;
    --mp-ok: #6CC1B2;
    --mp-warn: #E7C27A;
    --mp-error: #EE8E6C;
    --mp-info: #6CC1B2;
    --mp-grid: rgba(230, 238, 236, .045);
    --mp-shadow: rgba(0, 0, 0, .45);
}
body.vscode-high-contrast, body.vscode-high-contrast-light {
    --mp-page: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --mp-card: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --mp-inset: transparent;
    --mp-field: var(--vscode-input-background);
    --mp-raised: transparent;
    --mp-ink: var(--vscode-foreground);
    --mp-ink-2: var(--vscode-foreground);
    --mp-muted: var(--vscode-descriptionForeground);
    --mp-border: var(--vscode-contrastBorder);
    --mp-border-strong: var(--vscode-contrastBorder);
    --mp-accent: var(--vscode-button-background);
    --mp-accent-text: var(--vscode-textLink-foreground);
    --mp-accent-hover: var(--vscode-button-hoverBackground);
    --mp-on-accent: var(--vscode-button-foreground);
    --mp-ok: var(--vscode-testing-iconPassed);
    --mp-warn: var(--vscode-editorWarning-foreground);
    --mp-error: var(--vscode-errorForeground);
    --mp-info: var(--vscode-textLink-foreground);
    --mp-grid: transparent;
    --mp-shadow: transparent;
}
* { box-sizing: border-box; }
body {
    margin: 0;
    padding: 10px 10px 16px;
    color: var(--mp-ink);
    font-family: var(--mp-font);
    font-size: var(--vscode-font-size);
    line-height: 1.45;
    background: var(--mp-page);
    -webkit-font-smoothing: antialiased;
}
a { color: var(--mp-accent-text); text-decoration: none; cursor: pointer; font-weight: 600; }
a:hover { text-decoration: underline; text-underline-offset: 2px; }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, var(--mp-accent)); outline-offset: 1px;
}
code {
    font-family: var(--mp-mono);
    font-size: .88em;
    padding: 0 4px;
    border-radius: 5px;
    background: var(--mp-raised);
    color: var(--mp-ink-2);
}
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.icon { width: 16px; height: 16px; flex: none; vertical-align: -3px; }
.mark { display: block; width: 100%; height: 100%; }
.muted { color: var(--mp-muted); margin: 6px 0; }
.small { font-size: .92em; }
.path { font-family: var(--mp-mono); font-size: .88em; word-break: break-all; }
.tone-ok { --tone: var(--mp-ok); }
.tone-warn { --tone: var(--mp-warn); }
.tone-error { --tone: var(--mp-error); }
.tone-info, .tone-accent { --tone: var(--mp-info); }
.tone-busy { --tone: var(--mp-accent-text); }
.tone-idle { --tone: var(--mp-muted); }

/* ── hero: the brand lockup on survey paper ──────────────── */
.hero {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 12px; margin-bottom: var(--mp-gap);
    border-radius: var(--mp-radius);
    border: 1px solid var(--mp-border);
    background-color: var(--mp-card);
    background-image:
        linear-gradient(var(--mp-grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--mp-grid) 1px, transparent 1px);
    background-size: 18px 18px;
    background-position: -1px -1px;
}
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.brand-text { min-width: 0; }
.brand h1 {
    margin: 0; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
    font: 600 1.22em/1.15 var(--mp-mono); letter-spacing: -.02em; color: var(--mp-accent-text);
}
.byline { font: 400 .62em/1 var(--mp-mono); letter-spacing: 0; color: var(--mp-muted); white-space: nowrap; }
.subtitle { margin: 2px 0 0; color: var(--mp-muted); font-size: .92em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.logo { display: block; width: 36px; height: 36px; flex: none; }
.mark-ripple { transform-box: view-box; transform-origin: 40px 60px; }
.logo-busy .mark-ripple { animation: ripple 1.8s var(--mp-ease) infinite; }
.logo-busy .mark-drop { animation: drip 1.8s var(--mp-ease) infinite; }
.pill {
    display: inline-flex; align-items: center; gap: 6px; flex: none;
    padding: 3px 9px; border-radius: 999px;
    font: 600 .8em/1.3 var(--mp-mono); letter-spacing: -.01em;
    color: var(--tone);
    background: color-mix(in srgb, var(--tone) 12%, var(--mp-card));
    border: 1px solid color-mix(in srgb, var(--tone) 34%, transparent);
    max-width: 50%;
}
.pill span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { position: relative; width: 7px; height: 7px; border-radius: 50%; background: var(--tone); flex: none; }
.tone-ok .dot::after {
    content: ""; position: absolute; inset: 0; border-radius: 50%; background: var(--tone);
    animation: beacon 2.8s var(--mp-ease) infinite;
}

/* ── cards ────────────────────────────────────────────── */
.card {
    margin-bottom: var(--mp-gap);
    border: 1px solid var(--mp-border);
    border-radius: var(--mp-radius);
    background: var(--mp-card);
    overflow: hidden;
}
body:not([data-entered]) .card { animation: rise .28s var(--mp-ease) both; }
body:not([data-entered]) .card:nth-of-type(2) { animation-delay: 40ms; }
body:not([data-entered]) .card:nth-of-type(3) { animation-delay: 80ms; }
body:not([data-entered]) .card:nth-of-type(4) { animation-delay: 120ms; }
body:not([data-entered]) .card:nth-of-type(5) { animation-delay: 160ms; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 7px 8px 5px 6px; }
.card.collapsed .card-head { padding-bottom: 7px; }
.card-title {
    display: inline-flex; align-items: center; gap: 6px; min-width: 0;
    background: none; border: 0; color: var(--mp-accent-text); cursor: pointer; padding: 3px 5px; border-radius: 7px; font: inherit;
    transition: background-color .15s var(--mp-ease);
}
.card-title:hover { background: var(--mp-raised); }
.card-title h2 { margin: 0; font: 600 .86em/1.2 var(--mp-mono); letter-spacing: -.01em; }
.chevron { display: inline-block; width: 10px; transition: transform .2s var(--mp-ease); color: var(--mp-muted); font-weight: 700; }
.chevron.open { transform: rotate(90deg); }
.count {
    min-width: 18px; padding: 0 6px; border-radius: 999px; text-align: center;
    font: 600 .74em/1.6 var(--mp-mono);
    background: var(--mp-raised); color: var(--mp-ink-2);
}
.card-actions { display: flex; align-items: center; gap: 2px; }
.card-body { padding: 2px 12px 12px; }
.mini { font-size: .85em; padding: 0 4px; }

/* ── buttons ──────────────────────────────────────────── */
.btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 4px 12px; min-height: 28px;
    border-radius: 999px; border: 1px solid transparent;
    font: 600 .93em/1 var(--mp-font); cursor: pointer; white-space: nowrap;
    transition: background-color .15s var(--mp-ease), border-color .15s var(--mp-ease), color .15s var(--mp-ease), transform .12s var(--mp-ease), opacity .15s var(--mp-ease);
}
.btn:active:not(:disabled) { transform: scale(.97); }
.btn:disabled { opacity: .42; cursor: default; }
.btn.primary { background: var(--mp-accent); color: var(--mp-on-accent); }
.btn.primary:hover:not(:disabled) { background: var(--mp-accent-hover); }
.btn.secondary { background: transparent; color: var(--mp-ink); border-color: var(--mp-border-strong); }
.btn.secondary:hover:not(:disabled) { background: var(--mp-raised); }
.btn.ghost { background: transparent; color: var(--mp-ink-2); }
.btn.ghost:hover:not(:disabled) { background: var(--mp-raised); color: var(--mp-ink); }
.btn.danger { background: color-mix(in srgb, var(--mp-error) 14%, transparent); color: var(--mp-error); }
.btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--mp-error) 22%, transparent); }
.btn.icon-only { padding: 3px; min-height: 26px; width: 26px; border-radius: 8px; }
.btn .badge {
    min-width: 16px; padding: 0 5px; border-radius: 999px; font: 600 .78em/1.5 var(--mp-mono);
    background: var(--mp-bronze); color: #132422;
}
body.vscode-high-contrast .btn, body.vscode-high-contrast-light .btn { border-color: var(--vscode-contrastBorder); }
@media (hover: hover) {
    .btn:hover:not(:disabled) .icon-sync { animation: spin .5s var(--mp-ease) 1; }
    .btn:hover:not(:disabled) .icon-rocket { animation: launch .4s var(--mp-ease) 1; }
    .btn:hover:not(:disabled) .icon-push { animation: nudge-up .3s var(--mp-ease) 1; }
    .btn:hover:not(:disabled) .icon-pull, .btn:hover:not(:disabled) .icon-download { animation: nudge-down .3s var(--mp-ease) 1; }
}
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
.toolbar .hint { margin-left: auto; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 4px 0 8px; }
.hint { color: var(--mp-muted); font-size: .9em; display: inline-flex; align-items: center; gap: 4px; }
.hint.tone-ok, .hint.tone-error { color: var(--tone); }

/* ── chips / banners ──────────────────────────────────── */
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0; }
.chip {
    display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
    padding: 1px 7px; border-radius: 999px;
    font: 400 .78em/1.6 var(--mp-mono);
    color: var(--mp-ink-2);
    border: 1px solid var(--mp-border); background: var(--mp-card);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chip .icon { width: 12px; height: 12px; vertical-align: -2px; }
.chip[class*="tone-"] { color: var(--tone); border-color: color-mix(in srgb, var(--tone) 40%, transparent); background: color-mix(in srgb, var(--tone) 9%, var(--mp-card)); }
.banner {
    display: flex; align-items: flex-start; gap: 8px;
    margin: 8px 0; padding: 9px 10px; border-radius: var(--mp-radius-sm);
    border: 1px solid color-mix(in srgb, var(--tone) 38%, transparent);
    border-left-width: 3px;
    background: color-mix(in srgb, var(--tone) 8%, var(--mp-card));
}
.banner > .icon { color: var(--tone); margin-top: 1px; }
.banner-body { flex: 1; min-width: 0; word-break: break-word; }
.banner-actions { flex: none; display: flex; gap: 4px; }
.repo-url { display: flex; align-items: center; gap: 6px; font: 600 .95em/1.35 var(--mp-mono); letter-spacing: -.01em; word-break: break-all; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--mp-muted); font-size: .88em; }
.sep { opacity: .5; }

/* ── forms ────────────────────────────────────────────── */
.form { display: flex; flex-direction: column; gap: 2px; }
.form-title { display: flex; align-items: center; gap: 6px; font: 600 .9em/1.3 var(--mp-mono); color: var(--mp-accent-text); margin-bottom: 4px; }
.add-skill {
    margin: 4px 0 10px; padding: 10px; border-radius: var(--mp-radius-sm);
    border: 1px dashed color-mix(in srgb, var(--mp-accent) 55%, transparent);
    background: color-mix(in srgb, var(--mp-accent) 5%, var(--mp-card));
    animation: rise .24s var(--mp-ease) both;
}
.field { display: flex; flex-direction: column; gap: 3px; margin: 4px 0; }
.field > span { font-size: .86em; font-weight: 600; color: var(--mp-ink-2); }
.field em { font-weight: 400; color: var(--mp-muted); font-style: normal; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 260px) { .grid2 { grid-template-columns: 1fr; } }
input[type="text"], input[type="search"], textarea {
    width: 100%; padding: 6px 9px; border-radius: 9px;
    font: inherit;
    color: var(--mp-ink);
    background: var(--mp-field);
    border: 1px solid var(--mp-border-strong);
    transition: border-color .15s var(--mp-ease);
}
input[type="text"], input[type="search"] { font-family: var(--mp-mono); font-size: .9em; }
input:focus-visible, textarea:focus-visible { outline: none; border-color: var(--mp-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mp-accent) 22%, transparent); }
input::placeholder, textarea::placeholder { color: var(--mp-muted); opacity: .8; }
textarea { resize: vertical; min-height: 44px; margin-top: 8px; }
.segmented { display: flex; gap: 2px; margin: 6px 0 2px; padding: 2px; border-radius: 999px; background: var(--mp-raised); border: 1px solid var(--mp-border); }
.seg {
    flex: 1; padding: 4px 6px; border: 0; border-radius: 999px; background: transparent; color: var(--mp-ink-2);
    font: 600 .86em/1.2 var(--mp-font); cursor: pointer;
    transition: background-color .15s var(--mp-ease), color .15s var(--mp-ease);
}
.seg:hover { color: var(--mp-ink); }
.seg.active { background: var(--mp-accent); color: var(--mp-on-accent); }
.search { position: relative; display: block; margin: 4px 0 8px; }
.search .icon { position: absolute; left: 9px; top: 8px; color: var(--mp-muted); }
.search input { padding-left: 30px; }

/* ── changes ──────────────────────────────────────────── */
.files { list-style: none; margin: 4px 0 0; padding: 0; max-height: 220px; overflow: auto; }
.file { display: flex; align-items: center; gap: 4px; border-radius: 7px; }
.file:hover { background: var(--mp-raised); }
.file label { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; padding: 3px 5px; cursor: pointer; }
.file input { margin: 0; accent-color: var(--mp-accent); }
.letter { width: 14px; text-align: center; font: 600 .82em/1 var(--mp-mono); }
.kind-modified .letter { color: var(--mp-warn); }
.kind-added .letter, .kind-untracked .letter { color: var(--mp-ok); }
.kind-deleted .letter, .kind-conflicted .letter { color: var(--mp-error); }
.kind-renamed .letter, .kind-copied .letter { color: var(--mp-info); }
.fname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fdir { color: var(--mp-muted); font: .8em/1.3 var(--mp-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.kind-deleted .fname { text-decoration: line-through; opacity: .8; }

/* ── skills ───────────────────────────────────────────── */
.skills { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.skill {
    display: flex; align-items: flex-start; gap: 10px; padding: 9px;
    border-radius: var(--mp-radius-sm); border: 1px solid var(--mp-border); background: var(--mp-inset);
    transition: border-color .15s var(--mp-ease);
}
body:not([data-entered]) .skill { animation: rise .3s var(--mp-ease) both; }
body:not([data-entered]) .skill:nth-child(2) { animation-delay: 30ms; }
body:not([data-entered]) .skill:nth-child(3) { animation-delay: 60ms; }
body:not([data-entered]) .skill:nth-child(4) { animation-delay: 90ms; }
body:not([data-entered]) .skill:nth-child(n+5) { animation-delay: 120ms; }
.skill:hover { border-color: var(--mp-border-strong); }
.skill.health-error { border-color: color-mix(in srgb, var(--mp-error) 50%, transparent); }
.skill.health-outdated, .skill.health-missing, .skill.health-dirty { border-color: color-mix(in srgb, var(--mp-warn) 50%, transparent); }
.skill.just-changed { animation: pop .3s var(--mp-ease); }
/* Skill tiles: the AIgromatics tile shape, with the thin survey lines in a corner. */
.avatar {
    width: 32px; height: 32px; flex: none; border-radius: 6px;
    display: grid; place-items: center;
    font: 600 .76em/1 var(--mp-mono); letter-spacing: .02em;
    --tile-line: rgba(240, 243, 243, .32);
    background-image:
        linear-gradient(90deg, transparent calc(80% - .5px), var(--tile-line) calc(80% - .5px), var(--tile-line) calc(80% + .5px), transparent calc(80% + .5px)),
        linear-gradient(transparent calc(20% - .5px), var(--tile-line) calc(20% - .5px), var(--tile-line) calc(20% + .5px), transparent calc(20% + .5px));
}
/* Identity colours only, from the brand palette. Rust is left out: it means "error" here. */
.hue-0 { background-color: #1F5C55; color: #F0F3F3; }
.hue-1 { background-color: #DFB15A; color: #132422; --tile-line: rgba(19, 36, 34, .22); }
.hue-2 { background-color: #855F1C; color: #F0F3F3; }
.hue-3 { background-color: #6CC1B2; color: #132422; --tile-line: rgba(19, 36, 34, .22); }
.hue-4 { background-color: #132422; color: #F0F3F3; }
.hue-5 { background-color: #8FA6A1; color: #132422; --tile-line: rgba(19, 36, 34, .22); }
.hue-6 { background-color: #CAD5D2; color: #132422; --tile-line: rgba(19, 36, 34, .2); }
.hue-7 { background-color: #566B68; color: #F0F3F3; }
body.vscode-dark .hue-4 { box-shadow: inset 0 0 0 1px var(--mp-border-strong); }
.skill-main { flex: 1; min-width: 0; }
.skill-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.skill-name { font-weight: 700; letter-spacing: -.01em; word-break: break-all; }
.skill-sub { color: var(--mp-muted); font: .8em/1.4 var(--mp-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.skill-error { color: var(--mp-error); font-size: .86em; margin-top: 4px; word-break: break-word; }
.skill-actions { display: flex; flex-direction: column; gap: 2px; opacity: .72; transition: opacity .15s var(--mp-ease); }
.skill:hover .skill-actions, .skill:focus-within .skill-actions { opacity: 1; }
.health { display: inline-flex; align-items: center; gap: 3px; font: 600 .74em/1.3 var(--mp-mono); color: var(--tone); }
.health .icon { width: 12px; height: 12px; }
.health.pop { animation: pop .3s var(--mp-ease); }
.empty, .empty-state { color: var(--mp-muted); margin: 6px 0; }
.empty-state { text-align: center; padding: 8px 4px; }
.empty-art {
    display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 9px;
    color: var(--mp-accent-text); background: color-mix(in srgb, var(--mp-accent) 12%, var(--mp-card));
    border: 1px solid color-mix(in srgb, var(--mp-accent) 30%, transparent);
}
.empty-art .icon { width: 20px; height: 20px; }

/* ── welcome ──────────────────────────────────────────── */
.welcome {
    padding: 18px 14px 16px; text-align: center;
    background-image:
        linear-gradient(var(--mp-grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--mp-grid) 1px, transparent 1px);
    background-size: 18px 18px;
}
.welcome h2 { margin: 12px 0 6px; font-size: 1.3em; font-weight: 800; letter-spacing: -.035em; line-height: 1.1; color: var(--mp-ink); }
.welcome p { color: var(--mp-muted); }
.welcome-art { width: 64px; height: 64px; margin: 0 auto; }
.welcome-art .mark-ripple { transform-box: view-box; transform-origin: 40px 60px; animation: ripple 3.2s var(--mp-ease) infinite; }
.welcome-art .mark-drop { animation: drip 3.2s var(--mp-ease) infinite; }
.steps { text-align: left; padding-left: 22px; margin: 12px 0 16px; }
.steps li { margin: 6px 0; padding-left: 2px; }
.steps li::marker { color: var(--mp-accent-text); font: 600 .9em var(--mp-mono); }

/* ── activity / footer ────────────────────────────────── */
.log { list-style: none; margin: 0; padding: 0; }
.log li { display: flex; align-items: flex-start; gap: 6px; padding: 4px 0; font-size: .9em; border-bottom: 1px solid var(--mp-border); }
.log li:last-child { border-bottom: 0; }
.log .icon { width: 13px; height: 13px; margin-top: 2px; }
.log-success .icon { color: var(--mp-ok); }
.log-warn .icon { color: var(--mp-warn); }
.log-error .icon { color: var(--mp-error); }
.log-info .icon { color: var(--mp-muted); }
.log-msg { flex: 1; min-width: 0; word-break: break-word; }
.log time { color: var(--mp-muted); font: .78em/1.6 var(--mp-mono); white-space: nowrap; }
.footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; color: var(--mp-muted); font: .8em/1.5 var(--mp-mono); padding: 0 2px; }
.footer > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.footer-links { display: flex; gap: 10px; }
.footer-links a { font-weight: 600; }

/* ── skeleton ─────────────────────────────────────────── */
.skeleton { padding: 14px; }
.shimmer {
    height: 12px; border-radius: 6px; margin: 6px 0;
    background: linear-gradient(90deg, var(--mp-raised), color-mix(in srgb, var(--mp-accent) 14%, transparent), var(--mp-raised));
    background-size: 200% 100%; animation: shimmer 1.4s linear infinite;
}
.shimmer.short { width: 60%; }

/* ── motion ───────────────────────────────────────────── */
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes beacon { 0% { transform: scale(1); opacity: .55; } 70%, 100% { transform: scale(2.6); opacity: 0; } }
@keyframes ripple { 0% { transform: scale(.72); opacity: 0; } 30% { opacity: 1; } 100% { transform: scale(1.08); opacity: 0; } }
@keyframes drip { 0%, 15% { transform: translate(0, 0); opacity: 1; } 45% { transform: translate(-6px, 8px); opacity: 0; } 46% { transform: translate(0, -4px); opacity: 0; } 70%, 100% { transform: translate(0, 0); opacity: 1; } }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes pop { 0% { transform: scale(.97); } 50% { transform: scale(1.02); } 100% { transform: scale(1); } }
@keyframes launch { 0% { transform: translate(0, 0); } 45% { transform: translate(3px, -3px); opacity: 0; } 46% { transform: translate(-3px, 3px); } 100% { transform: translate(0, 0); opacity: 1; } }
@keyframes nudge-up { 50% { transform: translateY(-3px); } }
@keyframes nudge-down { 50% { transform: translateY(3px); } }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

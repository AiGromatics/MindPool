/**
 * Dashboard stylesheet. Built on VS Code theme variables so it looks native in every theme
 * (light, dark, high contrast), with a few playful touches: gradient hero, ripple logo,
 * spinning sync, "pop" when a skill is installed. Motion is disabled for reduced-motion users.
 */
export const STYLES = /* css */ `
:root {
    --mp-radius: 8px;
    --mp-gap: 10px;
    --mp-border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.28)));
    --mp-card: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --mp-raised: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
    --mp-muted: var(--vscode-descriptionForeground);
    --mp-ok: var(--vscode-testing-iconPassed, #3fb950);
    --mp-warn: var(--vscode-editorWarning-foreground, #d29922);
    --mp-error: var(--vscode-errorForeground, #f85149);
    --mp-info: var(--vscode-textLink-foreground, #58a6ff);
    --mp-accent-a: #7c5cff;
    --mp-accent-b: #19c2c2;
}
* { box-sizing: border-box; }
body {
    margin: 0;
    padding: 10px 10px 16px;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.45;
    background: transparent;
}
a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
a:hover { text-decoration: underline; }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible {
    outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px;
}
code {
    font-family: var(--vscode-editor-font-family);
    font-size: .92em;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--vscode-textCodeBlock-background, var(--mp-raised));
}
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.icon { width: 16px; height: 16px; flex: none; vertical-align: -3px; }
.muted { color: var(--mp-muted); margin: 6px 0; }
.small { font-size: .92em; }
.path { font-family: var(--vscode-editor-font-family); font-size: .92em; word-break: break-all; }
.tone-ok { --tone: var(--mp-ok); }
.tone-warn { --tone: var(--mp-warn); }
.tone-error { --tone: var(--mp-error); }
.tone-info, .tone-accent { --tone: var(--mp-info); }
.tone-busy { --tone: var(--mp-accent-a); }
.tone-idle { --tone: var(--mp-muted); }

/* ── hero ─────────────────────────────────────────────── */
.hero {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 12px; margin-bottom: var(--mp-gap);
    border-radius: var(--mp-radius);
    border: 1px solid var(--mp-border);
    background:
        radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--mp-accent-a) 22%, transparent), transparent 60%),
        radial-gradient(120% 140% at 100% 100%, color-mix(in srgb, var(--mp-accent-b) 18%, transparent), transparent 60%),
        var(--mp-card);
}
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.brand-text { min-width: 0; }
.brand h1 { margin: 0; font-size: 1.25em; letter-spacing: .2px; }
.subtitle { margin: 0; color: var(--mp-muted); font-size: .92em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.logo {
    display: grid; place-items: center; width: 34px; height: 34px; flex: none;
    border-radius: 10px; color: #fff;
    background: linear-gradient(135deg, var(--mp-accent-a), var(--mp-accent-b));
    box-shadow: 0 2px 10px color-mix(in srgb, var(--mp-accent-a) 40%, transparent);
}
.logo .icon { width: 24px; height: 24px; }
.logo-busy { animation: bob 1.6s ease-in-out infinite; }
.pill {
    display: inline-flex; align-items: center; gap: 6px; flex: none;
    padding: 3px 9px; border-radius: 999px; font-size: .88em; font-weight: 600;
    color: var(--tone);
    background: color-mix(in srgb, var(--tone) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--tone) 35%, transparent);
    max-width: 50%;
}
.pill span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tone); flex: none; }
.tone-ok .dot { animation: pulse 2.4s ease-in-out infinite; }

/* ── cards ────────────────────────────────────────────── */
.card {
    margin-bottom: var(--mp-gap);
    border: 1px solid var(--mp-border);
    border-radius: var(--mp-radius);
    background: var(--mp-card);
    overflow: hidden;
    animation: rise .25s ease-out;
}
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 8px 6px 4px; }
.card.collapsed .card-head { padding-bottom: 6px; }
.card-title {
    display: inline-flex; align-items: center; gap: 6px; min-width: 0;
    background: none; border: 0; color: inherit; cursor: pointer; padding: 2px 4px; border-radius: 4px; font: inherit;
}
.card-title:hover { background: var(--mp-raised); }
.card-title h2 { margin: 0; font-size: .82em; text-transform: uppercase; letter-spacing: .6px; font-weight: 700; }
.chevron { display: inline-block; width: 10px; transition: transform .15s ease; color: var(--mp-muted); font-weight: 700; }
.chevron.open { transform: rotate(90deg); }
.count {
    min-width: 18px; padding: 0 6px; border-radius: 999px; font-size: .8em; text-align: center;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.card-actions { display: flex; align-items: center; gap: 2px; }
.card-body { padding: 2px 12px 12px; }
.mini { font-size: .85em; padding: 0 4px; }

/* ── buttons ──────────────────────────────────────────── */
.btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 4px 10px; min-height: 26px;
    border-radius: 6px; border: 1px solid transparent;
    font: inherit; font-size: .95em; cursor: pointer; white-space: nowrap;
    transition: background .12s ease, transform .08s ease, opacity .12s;
}
.btn:active:not(:disabled) { transform: translateY(1px) scale(.98); }
.btn:disabled { opacity: .45; cursor: default; }
.btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.btn.secondary {
    background: var(--vscode-button-secondaryBackground, var(--mp-raised));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
}
.btn.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--mp-raised)); }
.btn.ghost { background: transparent; color: var(--vscode-foreground); }
.btn.ghost:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--mp-raised)); }
.btn.danger { background: color-mix(in srgb, var(--mp-error) 18%, transparent); color: var(--mp-error); }
.btn.icon-only { padding: 3px; min-height: 24px; width: 26px; }
.btn .badge {
    min-width: 16px; padding: 0 5px; border-radius: 999px; font-size: .78em; font-weight: 700;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.btn:hover:not(:disabled) .icon-sync { animation: spin .8s linear 1; }
.btn:hover:not(:disabled) .icon-rocket { animation: launch .6s ease-out 1; }
.btn:hover:not(:disabled) .icon-push { animation: nudge-up .4s ease-out 1; }
.btn:hover:not(:disabled) .icon-pull, .btn:hover:not(:disabled) .icon-download { animation: nudge-down .4s ease-out 1; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
.toolbar .hint { margin-left: auto; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 4px 0 8px; }
.hint { color: var(--mp-muted); font-size: .9em; display: inline-flex; align-items: center; gap: 4px; }
.hint.tone-ok, .hint.tone-error { color: var(--tone); }

/* ── chips / banners ──────────────────────────────────── */
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.chip {
    display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
    padding: 1px 7px; border-radius: 999px; font-size: .85em;
    border: 1px solid var(--mp-border); background: var(--mp-raised);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chip .icon { width: 13px; height: 13px; vertical-align: -2px; }
.chip[class*="tone-"] { color: var(--tone); border-color: color-mix(in srgb, var(--tone) 40%, transparent); background: color-mix(in srgb, var(--tone) 10%, transparent); }
.banner {
    display: flex; align-items: flex-start; gap: 8px;
    margin: 8px 0; padding: 8px 10px; border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--tone) 40%, transparent);
    background: color-mix(in srgb, var(--tone) 10%, transparent);
}
.banner > .icon { color: var(--tone); margin-top: 1px; }
.banner-body { flex: 1; min-width: 0; word-break: break-word; }
.banner-actions { flex: none; display: flex; gap: 4px; }
.repo-url { display: flex; align-items: center; gap: 6px; font-weight: 600; word-break: break-all; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--mp-muted); font-size: .9em; }
.sep { opacity: .6; }

/* ── forms ────────────────────────────────────────────── */
.form { display: flex; flex-direction: column; gap: 2px; }
.form-title { display: flex; align-items: center; gap: 6px; font-weight: 700; margin-bottom: 4px; }
.add-skill {
    margin: 4px 0 10px; padding: 10px; border-radius: 6px;
    border: 1px dashed color-mix(in srgb, var(--mp-accent-a) 55%, transparent);
    background: color-mix(in srgb, var(--mp-accent-a) 6%, transparent);
    animation: rise .2s ease-out;
}
.field { display: flex; flex-direction: column; gap: 3px; margin: 4px 0; }
.field > span { font-size: .88em; font-weight: 600; }
.field em { font-weight: 400; color: var(--mp-muted); font-style: normal; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 260px) { .grid2 { grid-template-columns: 1fr; } }
input[type="text"], input[type="search"], textarea {
    width: 100%; padding: 5px 8px; border-radius: 4px;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--mp-border));
}
input::placeholder, textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
textarea { resize: vertical; min-height: 44px; margin-top: 8px; }
.segmented { display: flex; margin: 6px 0 2px; border: 1px solid var(--mp-border); border-radius: 6px; overflow: hidden; }
.seg { flex: 1; padding: 4px 6px; border: 0; background: transparent; color: inherit; font: inherit; font-size: .9em; cursor: pointer; }
.seg + .seg { border-left: 1px solid var(--mp-border); }
.seg:hover { background: var(--mp-raised); }
.seg.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; }
.search { position: relative; display: block; margin: 4px 0 8px; }
.search .icon { position: absolute; left: 8px; top: 7px; color: var(--mp-muted); }
.search input { padding-left: 28px; }

/* ── changes ──────────────────────────────────────────── */
.files { list-style: none; margin: 4px 0 0; padding: 0; max-height: 220px; overflow: auto; }
.file { display: flex; align-items: center; gap: 4px; border-radius: 4px; }
.file:hover { background: var(--vscode-list-hoverBackground); }
.file label { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 4px; cursor: pointer; }
.file input { margin: 0; accent-color: var(--vscode-button-background); }
.letter { width: 14px; text-align: center; font-weight: 700; font-size: .85em; font-family: var(--vscode-editor-font-family); }
.kind-modified .letter { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--mp-warn)); }
.kind-added .letter, .kind-untracked .letter { color: var(--vscode-gitDecoration-untrackedResourceForeground, var(--mp-ok)); }
.kind-deleted .letter { color: var(--vscode-gitDecoration-deletedResourceForeground, var(--mp-error)); }
.kind-renamed .letter, .kind-copied .letter { color: var(--vscode-gitDecoration-renamedResourceForeground, var(--mp-info)); }
.kind-conflicted .letter { color: var(--vscode-gitDecoration-conflictingResourceForeground, var(--mp-error)); }
.fname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fdir { color: var(--mp-muted); font-size: .85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.kind-deleted .fname { text-decoration: line-through; opacity: .8; }

/* ── skills ───────────────────────────────────────────── */
.skills { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.skill {
    display: flex; align-items: flex-start; gap: 10px; padding: 8px;
    border-radius: 6px; border: 1px solid var(--mp-border); background: var(--mp-raised);
    transition: border-color .15s ease, transform .15s ease;
}
.skill:hover { border-color: color-mix(in srgb, var(--mp-accent-a) 45%, var(--mp-border)); }
.skill.health-error { border-color: color-mix(in srgb, var(--mp-error) 45%, transparent); }
.skill.health-outdated, .skill.health-missing, .skill.health-dirty { border-color: color-mix(in srgb, var(--mp-warn) 45%, transparent); }
.skill.just-changed { animation: pop .5s ease-out; }
.avatar {
    width: 32px; height: 32px; flex: none; border-radius: 9px;
    display: grid; place-items: center;
    color: #fff; font-weight: 800; font-size: .85em; letter-spacing: .5px;
    text-shadow: 0 1px 1px rgba(0,0,0,.25);
}
.hue-0 { background: linear-gradient(135deg, #7c5cff, #b06cff); }
.hue-1 { background: linear-gradient(135deg, #19c2c2, #2f8fff); }
.hue-2 { background: linear-gradient(135deg, #ff7a59, #ff4f8b); }
.hue-3 { background: linear-gradient(135deg, #20b26b, #7bd148); }
.hue-4 { background: linear-gradient(135deg, #f7b500, #ff7a00); }
.hue-5 { background: linear-gradient(135deg, #3d7bff, #7c5cff); }
.hue-6 { background: linear-gradient(135deg, #e44dbb, #8f5cff); }
.hue-7 { background: linear-gradient(135deg, #0fa3a3, #20b26b); }
.skill-main { flex: 1; min-width: 0; }
.skill-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.skill-name { font-weight: 700; word-break: break-all; }
.skill-sub { color: var(--mp-muted); font-size: .86em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.skill-error { color: var(--mp-error); font-size: .86em; margin-top: 4px; word-break: break-word; }
.skill-actions { display: flex; flex-direction: column; gap: 2px; opacity: .7; transition: opacity .12s; }
.skill:hover .skill-actions, .skill:focus-within .skill-actions { opacity: 1; }
.health { display: inline-flex; align-items: center; gap: 3px; font-size: .8em; font-weight: 600; color: var(--tone); }
.health .icon { width: 12px; height: 12px; }
.health.pop { animation: pop .6s ease-out; }
.empty, .empty-state { color: var(--mp-muted); margin: 6px 0; }
.empty-state { text-align: center; padding: 8px 4px; }
.empty-art { font-size: 28px; animation: bob 3s ease-in-out infinite; }

/* ── welcome ──────────────────────────────────────────── */
.welcome { padding: 16px 14px; text-align: center; }
.welcome h2 { margin: 6px 0; font-size: 1.15em; }
.welcome p { color: var(--mp-muted); }
.welcome-art { font-size: 40px; line-height: 1; display: flex; justify-content: center; gap: 2px; }
.welcome-art span:first-child { animation: bob 2.6s ease-in-out infinite; }
.welcome-art .wave { animation: sway 3s ease-in-out infinite; }
.steps { text-align: left; padding-left: 20px; margin: 12px 0 16px; }
.steps li { margin: 6px 0; }
.steps li::marker { color: var(--mp-accent-a); font-weight: 700; }

/* ── activity / footer ────────────────────────────────── */
.log { list-style: none; margin: 0; padding: 0; }
.log li { display: flex; align-items: flex-start; gap: 6px; padding: 3px 0; font-size: .9em; border-bottom: 1px dashed color-mix(in srgb, var(--mp-border) 60%, transparent); }
.log li:last-child { border-bottom: 0; }
.log .icon { width: 13px; height: 13px; margin-top: 2px; }
.log-success .icon { color: var(--mp-ok); }
.log-warn .icon { color: var(--mp-warn); }
.log-error .icon { color: var(--mp-error); }
.log-info .icon { color: var(--mp-muted); }
.log-msg { flex: 1; min-width: 0; word-break: break-word; }
.log time { color: var(--mp-muted); font-size: .85em; white-space: nowrap; }
.footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; color: var(--mp-muted); font-size: .85em; padding: 0 2px; }
.footer > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.footer-links { display: flex; gap: 10px; }

/* ── skeleton ─────────────────────────────────────────── */
.skeleton { padding: 14px; }
.shimmer {
    height: 12px; border-radius: 6px; margin: 6px 0;
    background: linear-gradient(90deg, var(--mp-raised), color-mix(in srgb, var(--vscode-foreground) 12%, transparent), var(--mp-raised));
    background-size: 200% 100%; animation: shimmer 1.2s linear infinite;
}
.shimmer.short { width: 60%; }

/* ── motion ───────────────────────────────────────────── */
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--tone) 55%, transparent); } 50% { box-shadow: 0 0 0 4px transparent; } }
@keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes sway { 0%, 100% { transform: translateX(0) rotate(0); } 50% { transform: translateX(3px) rotate(4deg); } }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes pop { 0% { transform: scale(.96); } 50% { transform: scale(1.03); } 100% { transform: scale(1); } }
@keyframes launch { 0% { transform: translate(0, 0); } 45% { transform: translate(3px, -3px); opacity: 0; } 46% { transform: translate(-3px, 3px); } 100% { transform: translate(0, 0); opacity: 1; } }
@keyframes nudge-up { 50% { transform: translateY(-3px); } }
@keyframes nudge-down { 50% { transform: translateY(3px); } }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

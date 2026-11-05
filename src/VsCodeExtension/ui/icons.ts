/**
 * Hand-drawn MindPool icon set (24×24, stroke based, uses `currentColor` so every icon
 * follows the active VS Code theme). Rendered inline: no fonts or extra files to ship.
 */

const PATHS = {
    logo: `<path d="M9.6 1.8v6.6M9.6 20.4v1.8M1.8 14.4h1.8M15.6 14.4h6.6"/><circle cx="9.6" cy="14.4" r="6"/><circle cx="9.6" cy="14.4" r="1.2"/><path d="M19.2 2.6s-2.3 3-2.3 4.4a2.3 2.3 0 0 0 4.6 0c0-1.4-2.3-4.4-2.3-4.4Z"/>`,
    sync: `<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>`,
    pull: `<path d="M12 3.5v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>`,
    push: `<path d="M12 14.5v-11"/><path d="M7.5 8 12 3.5 16.5 8"/><path d="M4.5 19.5h15"/>`,
    window: `<path d="M14 3.5h6.5V10"/><path d="m20.5 3.5-8.5 8.5"/><path d="M18.5 14v4.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2H10"/>`,
    gear: `<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M2.8 12h2.6M18.6 12h2.6M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/>`,
    plus: `<path d="M12 5v14M5 12h14"/>`,
    trash: `<path d="M4 6.5h16"/><path d="M9.5 6.5V4h5v2.5"/><path d="M6 6.5 7 20h10l1-13.5"/><path d="M10 10.5v6M14 10.5v6"/>`,
    check: `<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
    alert: `<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>`,
    rocket: `<path d="M9.5 14.5 6 11c1.6-4.3 5.4-7.7 13-8-.3 7.6-3.7 11.4-8 13l-1.5-1.5Z"/><circle cx="14.5" cy="9.5" r="1.6"/><path d="M6.5 14c-1.8.8-2.7 3.3-3 6.5 3.2-.3 5.7-1.2 6.5-3"/>`,
    tag: `<path d="M3.5 3.5h8l9 9-8 8-9-9v-8Z"/><circle cx="8" cy="8" r="1.4"/>`,
    branch: `<circle cx="6.5" cy="5" r="2"/><circle cx="6.5" cy="19" r="2"/><circle cx="17.5" cy="7" r="2"/><path d="M6.5 7v10"/><path d="M17.5 9c0 4.5-5.5 4-11 8"/>`,
    folder: `<path d="M3 6.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11Z"/>`,
    file: `<path d="M6 3h8l5 5v13H6V3Z"/><path d="M14 3v5h5"/>`,
    skill: `<path d="M12 2.8 14.3 9 20.5 11.3 14.3 13.6 12 19.8 9.7 13.6 3.5 11.3 9.7 9 12 2.8Z"/><path d="M19 17.5v4M17 19.5h4"/>`,
    sparkle: `<path d="M12 4v4M12 16v4M4 12h4M16 12h4"/><path d="m6.8 6.8 1.9 1.9M15.3 15.3l1.9 1.9M6.8 17.2l1.9-1.9M15.3 8.7l1.9-1.9"/>`,
    cloudOff: `<path d="M7.5 18.5h9a4 4 0 0 0 .9-7.9A6 6 0 0 0 6.6 9.3a4.6 4.6 0 0 0 .9 9.2Z"/><path d="m3.5 3.5 17 17"/>`,
    commit: `<circle cx="12" cy="12" r="3.5"/><path d="M2.5 12h6M15.5 12h6"/>`,
    search: `<circle cx="10.5" cy="10.5" r="6"/><path d="m20 20-5.2-5.2"/>`,
    close: `<path d="M6 6l12 12M18 6 6 18"/>`,
    arrowUp: `<path d="M12 19V5.5"/><path d="m6.5 11 5.5-5.5 5.5 5.5"/>`,
    arrowDown: `<path d="M12 5v13.5"/><path d="m6.5 13 5.5 5.5 5.5-5.5"/>`,
    clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
    lock: `<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>`,
    list: `<path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01"/>`,
    wand: `<path d="m4 20 11-11"/><path d="m13.5 7.5 3 3"/><path d="M17 3v2.5M20.5 7H18M19.5 4l-1.5 1.5"/>`,
    link: `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`,
    broom: `<path d="M14.5 3.5 10 12"/><path d="M6.5 12.5h8l1.5 8h-11l1.5-8Z"/><path d="M9 16.5v4M12.5 16.5v4"/>`,
    eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>`,
    download: `<path d="M12 3.5v10"/><path d="m8 9.5 4 4 4-4"/><path d="M5 15.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>`,
} as const;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function icon(name: IconName, extraClass = ''): string {
    const cls = extraClass ? `icon icon-${name} ${extraClass}` : `icon icon-${name}`;
    return `<svg class="${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/**
 * The full-colour MindPool mark (same drawing as media/icon.svg): the AIgromatics tile and
 * survey grid, with a pool where the groma sits and a bronze skill dropping in. It keeps its
 * brand colours in every theme, like a logo should. No ids, so it can appear more than once.
 */
export function brandMark(extraClass = ''): string {
    return (
        `<svg class="mark${extraClass ? ` ${extraClass}` : ''}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
        `<rect width="100" height="100" rx="18.5" fill="#1F5C55"/>` +
        `<path d="M80 0v100M0 20h100" stroke="#F0F3F3" stroke-opacity=".42" stroke-width="1"/>` +
        `<path d="M40 0v100M0 60h100" stroke="#F0F3F3" stroke-width="2.7"/>` +
        `<circle class="mark-ripple" cx="40" cy="60" r="31.5" fill="none" stroke="#F0F3F3" stroke-opacity=".5" stroke-width="2"/>` +
        `<circle cx="40" cy="60" r="22.2" fill="#1F5C55" stroke="#F0F3F3" stroke-width="4.9"/>` +
        `<circle class="mark-core" cx="40" cy="60" r="6.4" fill="#DFB15A"/>` +
        `<path class="mark-drop" d="M80 8.5C80 8.5 72.4 18.6 72.4 23.4a7.6 7.6 0 0 0 15.2 0C87.6 18.6 80 8.5 80 8.5Z" fill="#DFB15A"/>` +
        `</svg>`
    );
}

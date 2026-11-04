/**
 * Minimal, dependency-free semantic versioning (https://semver.org) with npm-style ranges.
 * Supports: exact versions, `^`, `~`, `x`/`*` wildcards, comparators (`>=1.0.0 <2.0.0`),
 * hyphen ranges (`1.0.0 - 2.0.0`) and unions (`^1.0.0 || ^2.0.0`). A leading `v` is accepted.
 */

export interface SemVer {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease: readonly (string | number)[];
    readonly raw: string;
}

type Operator = '<' | '<=' | '>' | '>=' | '=';

interface Comparator {
    readonly op: Operator;
    readonly version: SemVer;
}

/** An empty set means "any version". */
type ComparatorSet = readonly Comparator[];

const VERSION_RE =
    /^[vV=]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const PARTIAL_RE =
    /^(<=|>=|<|>|=|\^|~>?)?[vV=]?(\*|x|X|0|[1-9]\d*)(?:\.(\*|x|X|0|[1-9]\d*))?(?:\.(\*|x|X|0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parsePrerelease(value: string | undefined): (string | number)[] {
    if (!value) {
        return [];
    }
    return value.split('.').map((id) => (/^(0|[1-9]\d*)$/.test(id) ? Number(id) : id));
}

export function parseVersion(input: string): SemVer | undefined {
    const raw = input.trim();
    const match = VERSION_RE.exec(raw);
    if (!match) {
        return undefined;
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: parsePrerelease(match[4]),
        raw,
    };
}

function comparePrerelease(a: readonly (string | number)[], b: readonly (string | number)[]): number {
    if (a.length === 0 && b.length === 0) {
        return 0;
    }
    if (a.length === 0) {
        return 1;
    }
    if (b.length === 0) {
        return -1;
    }
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
        const x = a[i];
        const y = b[i];
        if (x === undefined) {
            return -1;
        }
        if (y === undefined) {
            return 1;
        }
        if (x === y) {
            continue;
        }
        if (typeof x === 'number' && typeof y === 'number') {
            return x < y ? -1 : 1;
        }
        if (typeof x === 'number') {
            return -1;
        }
        if (typeof y === 'number') {
            return 1;
        }
        return x < y ? -1 : 1;
    }
    return 0;
}

/** Returns -1, 0 or 1. */
export function compareVersions(a: SemVer, b: SemVer): number {
    if (a.major !== b.major) {
        return a.major < b.major ? -1 : 1;
    }
    if (a.minor !== b.minor) {
        return a.minor < b.minor ? -1 : 1;
    }
    if (a.patch !== b.patch) {
        return a.patch < b.patch ? -1 : 1;
    }
    return comparePrerelease(a.prerelease, b.prerelease);
}

function v(major: number, minor: number, patch: number, prerelease: (string | number)[] = []): SemVer {
    const pre = prerelease.length ? `-${prerelease.join('.')}` : '';
    return { major, minor, patch, prerelease, raw: `${major}.${minor}.${patch}${pre}` };
}

function isWildcard(part: string | undefined): boolean {
    return part === undefined || part === '*' || part === 'x' || part === 'X';
}

/** An impossible comparator, used for `>*` and `<*`. */
const NOTHING: Comparator = { op: '<', version: v(0, 0, 0, [0]) };

function desugar(token: string): Comparator[] | undefined {
    const match = PARTIAL_RE.exec(token);
    if (!match) {
        return undefined;
    }
    const op = match[1] ?? '';
    const majorX = isWildcard(match[2]);
    const minorX = majorX || isWildcard(match[3]);
    const patchX = minorX || isWildcard(match[4]);
    const M = majorX ? 0 : Number(match[2]);
    const m = minorX ? 0 : Number(match[3]);
    const p = patchX ? 0 : Number(match[4]);
    const pre = patchX ? [] : parsePrerelease(match[5]);
    const full = v(M, m, p, pre);
    const ge = (version: SemVer): Comparator => ({ op: '>=', version });
    const lt = (version: SemVer): Comparator => ({ op: '<', version });

    switch (op) {
        case '':
        case '=':
            if (majorX) {
                return [];
            }
            if (minorX) {
                return [ge(v(M, 0, 0)), lt(v(M + 1, 0, 0, [0]))];
            }
            if (patchX) {
                return [ge(v(M, m, 0)), lt(v(M, m + 1, 0, [0]))];
            }
            return [{ op: '=', version: full }];
        case '~':
        case '~>':
            if (majorX) {
                return [];
            }
            if (minorX) {
                return [ge(v(M, 0, 0)), lt(v(M + 1, 0, 0, [0]))];
            }
            return [ge(full), lt(v(M, m + 1, 0, [0]))];
        case '^':
            if (majorX) {
                return [];
            }
            if (minorX) {
                return [ge(v(M, 0, 0)), lt(v(M + 1, 0, 0, [0]))];
            }
            if (M > 0) {
                return [ge(full), lt(v(M + 1, 0, 0, [0]))];
            }
            if (patchX || m > 0) {
                return [ge(full), lt(v(0, m + 1, 0, [0]))];
            }
            return [ge(full), lt(v(0, 0, p + 1, [0]))];
        case '>':
            if (majorX) {
                return [NOTHING];
            }
            if (minorX) {
                return [ge(v(M + 1, 0, 0))];
            }
            if (patchX) {
                return [ge(v(M, m + 1, 0))];
            }
            return [{ op: '>', version: full }];
        case '>=':
            return majorX ? [] : [ge(full)];
        case '<':
            return majorX ? [NOTHING] : [lt(minorX || patchX ? v(M, m, 0, [0]) : full)];
        case '<=':
            if (majorX) {
                return [];
            }
            if (minorX) {
                return [lt(v(M + 1, 0, 0, [0]))];
            }
            if (patchX) {
                return [lt(v(M, m + 1, 0, [0]))];
            }
            return [{ op: '<=', version: full }];
        default:
            return undefined;
    }
}

function parseHyphen(lower: string, upper: string): Comparator[] | undefined {
    if (/^[<>=^~]/.test(lower) || /^[<>=^~]/.test(upper)) {
        return undefined;
    }
    // `>=1.2` and `<=2.3` already expand partial versions the way hyphen ranges need.
    const from = desugar(`>=${lower}`);
    const to = desugar(`<=${upper}`);
    return from && to ? [...from, ...to] : undefined;
}

export function parseRange(range: string): ComparatorSet[] | undefined {
    const text = range.trim();
    if (text === '' || text === 'latest') {
        return [[]];
    }
    const sets: ComparatorSet[] = [];
    for (const part of text.split('||')) {
        const setText = part.trim();
        if (setText === '') {
            sets.push([]);
            continue;
        }
        const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(setText);
        if (hyphen) {
            const comparators = parseHyphen(hyphen[1] as string, hyphen[2] as string);
            if (!comparators) {
                return undefined;
            }
            sets.push(comparators);
            continue;
        }
        const tokens = setText.replace(/(<=|>=|<|>|=|\^|~>?)\s+/g, '$1').split(/\s+/);
        const comparators: Comparator[] = [];
        for (const token of tokens) {
            const desugared = desugar(token);
            if (!desugared) {
                return undefined;
            }
            comparators.push(...desugared);
        }
        sets.push(comparators);
    }
    return sets;
}

function testComparator(comparator: Comparator, version: SemVer): boolean {
    const cmp = compareVersions(version, comparator.version);
    switch (comparator.op) {
        case '<':
            return cmp < 0;
        case '<=':
            return cmp <= 0;
        case '>':
            return cmp > 0;
        case '>=':
            return cmp >= 0;
        case '=':
            return cmp === 0;
    }
}

function testSet(set: ComparatorSet, version: SemVer): boolean {
    if (!set.every((c) => testComparator(c, version))) {
        return false;
    }
    if (version.prerelease.length === 0) {
        return true;
    }
    // npm semantics: a prerelease only matches when a comparator on the same
    // [major, minor, patch] tuple explicitly opts into prereleases.
    return set.some(
        (c) =>
            c.version.prerelease.length > 0 &&
            c.version.major === version.major &&
            c.version.minor === version.minor &&
            c.version.patch === version.patch,
    );
}

export function satisfies(version: SemVer | string, range: string): boolean {
    const parsed = typeof version === 'string' ? parseVersion(version) : version;
    const sets = parseRange(range);
    if (!parsed || !sets) {
        return false;
    }
    return sets.some((set) => testSet(set, parsed));
}

export function isValidRange(range: string): boolean {
    return parseRange(range) !== undefined;
}

/**
 * True when a shorthand ref (`url#something`) is meant as a semver range rather than
 * a plain tag/branch name: `^1.2.0`, `~1.0`, `>=2`, `1.x`, `*`, `1.0.0 - 2.0.0`, `a || b`.
 */
export function looksLikeRange(text: string): boolean {
    const value = text.trim();
    if (!/^[\^~<>=]/.test(value) && !/\s-\s|\|\|/.test(value) && !/(^|\.)[xX*](\.|$)/.test(value)) {
        return false;
    }
    return isValidRange(value);
}

/** Returns the highest candidate (kept in its original spelling) that satisfies the range. */
export function maxSatisfying(candidates: readonly string[], range: string): string | undefined {
    const sets = parseRange(range);
    if (!sets) {
        return undefined;
    }
    let best: SemVer | undefined;
    let bestRaw: string | undefined;
    for (const candidate of candidates) {
        const parsed = parseVersion(candidate);
        if (!parsed || !sets.some((set) => testSet(set, parsed))) {
            continue;
        }
        if (!best || compareVersions(parsed, best) > 0) {
            best = parsed;
            bestRaw = candidate;
        }
    }
    return bestRaw;
}

/** Highest stable (non-prerelease) version among the candidates. */
export function latestStable(candidates: readonly string[]): string | undefined {
    let best: SemVer | undefined;
    let bestRaw: string | undefined;
    for (const candidate of candidates) {
        const parsed = parseVersion(candidate);
        if (!parsed || parsed.prerelease.length > 0) {
            continue;
        }
        if (!best || compareVersions(parsed, best) > 0) {
            best = parsed;
            bestRaw = candidate;
        }
    }
    return bestRaw;
}

/** Stable versions strictly greater than `current`, highest first. */
export function newerStable(candidates: readonly string[], current: string): string[] {
    const base = parseVersion(current);
    if (!base) {
        return [];
    }
    return candidates
        .map((raw) => ({ raw, parsed: parseVersion(raw) }))
        .filter(
            (c): c is { raw: string; parsed: SemVer } =>
                c.parsed !== undefined && c.parsed.prerelease.length === 0 && compareVersions(c.parsed, base) > 0,
        )
        .sort((a, b) => compareVersions(b.parsed, a.parsed))
        .map((c) => c.raw);
}

import type { SkillSpec } from './types.ts';

/**
 * Pure formatting helpers with no Node.js imports, so they can be bundled into the webview.
 */

export function shortSha(sha: string | undefined): string {
    return sha ? sha.slice(0, 7) : '';
}

export function describeSpec(spec: SkillSpec | undefined): string {
    if (!spec) {
        return '';
    }
    switch (spec.kind) {
        case 'default':
            return 'default branch';
        case 'branch':
            return `branch ${spec.value}`;
        case 'tag':
            return `tag ${spec.value}`;
        case 'version':
            return `version ${spec.value}`;
        case 'ref':
            return `ref ${spec.value}`;
    }
}

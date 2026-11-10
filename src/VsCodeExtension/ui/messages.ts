import { HOST_COMMANDS, type HostCommand, type SkillRefKind, type WebviewToHost } from '../core/types.ts';

/**
 * Validates messages posted by the webview before the host acts on them. The webview only
 * runs our own script, but treating its messages as untrusted keeps the host robust.
 */

const KINDS: readonly SkillRefKind[] = ['default', 'branch', 'tag', 'version', 'ref'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 2000): value is string {
    return typeof value === 'string' && value.length <= max;
}

export function parseWebviewMessage(value: unknown): WebviewToHost | undefined {
    if (!isRecord(value) || typeof value['type'] !== 'string') {
        return undefined;
    }
    const m = value;
    switch (m['type']) {
        case 'ready':
            return { type: 'ready' };
        case 'run':
            return HOST_COMMANDS.includes(m['command'] as HostCommand) ? { type: 'run', command: m['command'] as HostCommand } : undefined;
        case 'commit': {
            const files = m['files'];
            if (!str(m['message'], 20_000) || !Array.isArray(files) || files.length > 10_000 || !files.every((f) => str(f, 4096))) {
                return undefined;
            }
            return { type: 'commit', message: m['message'], files: files as string[], push: m['push'] === true };
        }
        case 'saveConfig': {
            const c = m['config'];
            if (!isRecord(c) || !str(c['repository']) || !str(c['branch'], 255)) {
                return undefined;
            }
            const optional = (key: string): string | undefined => (str(c[key], 255) && (c[key] as string).trim() ? (c[key] as string) : undefined);
            const links = c['linkSkillsTo'];
            if (links !== undefined && (!Array.isArray(links) || links.length > 50 || !links.every((l) => str(l, 4096)))) {
                return undefined;
            }
            return {
                type: 'saveConfig',
                config: { repository: c['repository'], branch: c['branch'], tag: optional('tag'), directory: optional('directory'), linkSkillsTo: links as string[] | undefined },
            };
        }
        case 'inspectRemote':
            if (!str(m['url']) || typeof m['requestId'] !== 'number' || (m['purpose'] !== 'config' && m['purpose'] !== 'skill')) {
                return undefined;
            }
            return { type: 'inspectRemote', url: m['url'], requestId: m['requestId'], purpose: m['purpose'] };
        case 'addSkill': {
            const spec = m['spec'];
            if (!str(m['name'], 100) || !isRecord(spec) || !str(spec['repository']) || !KINDS.includes(spec['kind'] as SkillRefKind)) {
                return undefined;
            }
            if (spec['value'] !== undefined && !str(spec['value'], 255)) {
                return undefined;
            }
            return {
                type: 'addSkill',
                name: m['name'],
                spec: { repository: spec['repository'], kind: spec['kind'] as SkillRefKind, value: spec['value'] as string | undefined },
            };
        }
        case 'removeSkill':
        case 'revealSkill':
            return str(m['name'], 100) ? { type: m['type'], name: m['name'] } : undefined;
        case 'updateSkill':
            return str(m['name'], 100) ? { type: 'updateSkill', name: m['name'], reinstall: m['reinstall'] === true } : undefined;
        case 'openChange':
            return str(m['path'], 4096) ? { type: 'openChange', path: m['path'] } : undefined;
        default:
            return undefined;
    }
}

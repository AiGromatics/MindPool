/**
 * MindPool: sync your team AI skills from a private Git repository.
 *
 * Extension entry point. The build (scripts/build.ts) bundles this file and everything it
 * imports into a single `dist/main.cjs`: one monolithic artifact, no runtime dependencies.
 */
export { activate, deactivate } from './VsCodeExtension/extension.ts';
export type { MindPoolApi } from './VsCodeExtension/extension.ts';

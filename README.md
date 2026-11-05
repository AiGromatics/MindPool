# MindPool

A small VS Code extension that manages your team's AI skills **privately**, straight from a Git
repository, without publishing anything to the wild web.

- Point MindPool at a **pool folder** that holds a `config.json`.
- It clones your **team skills repository** next to that file and keeps it in sync, pulling new
  commits automatically.
- The repository's `skill.json` lists the skills, like `dependencies` in a `package.json`. Every
  skill is downloaded via git into **`mindSkills/`**, a folder that is never committed. Only the
  team settings get pushed.
- On every sync, MindPool checks for **newer skill versions** and installs them.
- **Pull**, **commit** and **push** right from the dashboard. For anything more complicated, one
  click **opens the repository in a new VS Code window**.

## Quick start

1. Open the **MindPool** icon in the activity bar.
2. Click **Choose pool folder** (any folder, for example `~/MindPool`).
3. Fill in the repository URL and branch, optionally a release tag, then **Save & clone**.

That's it. MindPool writes `config.json`, clones the repository and installs the skills.

```
~/MindPool/                  ← pool folder (setting: mindpool.poolFolder)
├── config.json              ← where the team repository lives
└── team-skills/             ← the cloned team repository (Git)
    ├── skill.json           ← the skills the team shares (committed)
    └── mindSkills/          ← downloaded skills (git-excluded, never pushed)
        ├── code-review/
        └── pdf-tools/
```

## `config.json`

```json
{
    "repository": "git@github.com:acme/team-skills.git",
    "branch": "main",
    "tag": "v1.4.0",
    "directory": "team-skills"
}
```


| Key          | Required | Meaning                                                                                                         |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------- |
| `repository` | ✔       | Git URL of the team repository (https, ssh or a local path).                                                    |
| `branch`     | ✔       | Branch to track. New commits are fast-forwarded automatically.                                                  |
| `tag`        |          | Release tag to pin. The checkout becomes**read-only**, and newer releases are offered with a one-click upgrade. |
| `directory`  |          | Folder name for the clone. Defaults to the repository name.                                                     |

## `skill.json`

```json
{
    "name": "acme-team-skills",
    "skills": {
        "code-review": "https://github.com/acme/skill-code-review.git",
        "pdf-tools":   "https://github.com/acme/pdf-tools.git#^2.1.0",
        "writer":      { "repository": "git@github.com:acme/writer.git", "branch": "develop" },
        "planner":     { "repository": "https://github.com/acme/planner.git", "tag": "v1.4.0" },
        "translator":  { "repository": "https://github.com/acme/translator.git", "version": "~1.2" }
    }
}
```


| Source                       | Installs                               | On each sync                                               |
| ---------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `"url"`                      | newest commit of the default branch    | updates to new commits                                     |
| `{ "branch": "develop" }`    | newest commit of that branch           | updates to new commits                                     |
| `{ "tag": "v1.4.0" }`        | exactly that tag                       | stays pinned and**reports** newer releases                 |
| `{ "version": "^1.2.0" }`    | highest tag matching the semver range  | **upgrades inside the range**, reports versions outside it |
| `"url#ref"` / `"url#^1.2.0"` | shorthand: a tag or branch, or a range | as above                                                   |

Ranges work like npm's: `^1.2.0`, `~1.2`, `>=2 <3`, `1.x`, `1.0.0 - 2.0.0` and `^1 || ^2`. A
leading `v` in tags is fine.

Safety rules:

- A skill with **local modifications** is never overwritten. It shows as *local changes*, and you
  decide whether to **Reinstall**.
- Skills removed from `skill.json` are pruned from `mindSkills/`. That only happens when the file
  is valid, and never when the folder has local changes.

## The dashboard


| Card           | What you can do                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Repository** | See branch or tag, HEAD, how many commits to push and pull, and last sync. Use**Sync**, **Pull** (rebase), **Push** and **Open** (new window). Adjust settings with ⚙.                                                                    |
| **Changes**    | Tick the files to include, write a message, then**Commit** or **Commit & Push** (⌘/Ctrl+Enter).                                                                                                                                           |
| **Skills**     | Shows status per skill (up to date, update ready, local changes, error) and newer versions. Install, reinstall, reveal or remove a skill.**＋** adds one with a guided form that checks the repository and suggests its branches and tags. |
| **Activity**   | Shows what happened and when. The full git output is in the*MindPool* output channel.                                                                                                                                                      |

The status bar shows the pool's health at a glance. Click it to open the dashboard.

## Commands

`MindPool: Sync Now` · `Select Pool Folder…` · `Pull` · `Commit Changes…` · `Push` ·
`Open Repository in New Window` · `Open config.json` · `Open skill.json` · `Add Skill…` ·
`Update All Skills` · `Reveal mindSkills Folder`

## Settings


| Setting                        | Default |                                                                              |
| ------------------------------ | ------- | ---------------------------------------------------------------------------- |
| `mindpool.poolFolder`          | `""`    | Folder with`config.json`. Supports `~`, `${userHome}`, `${workspaceFolder}`. |
| `mindpool.autoSync`            | `true`  | Sync on startup, on a timer and when`config.json` or `skill.json` change.    |
| `mindpool.syncIntervalMinutes` | `15`    | `0` disables the timer.                                                      |
| `mindpool.autoUpdateSkills`    | `true`  | When off, updates are only reported.                                         |
| `mindpool.gitPath`             | `git`   | Git executable.                                                              |

MindPool uses your normal Git credentials (credential helper or SSH agent). It never prompts in
the background. If authentication is needed, use **Open** and sign in through VS Code's Git.

## Development

Everything is TypeScript, and every import points to a `.ts` file. Node ≥ 22.18 runs the sources
directly: no transpile step for tests or scripts.

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # unit + git integration tests (node --test, real git repositories)
npm run test:e2e    # downloads VS Code and runs the extension end to end
npm run build       # → dist/main.cjs (single monolithic bundle)
npm run package     # → mindpool-<version>.vsix
```

Press **F5** to launch an Extension Development Host.

### Commit messages and releases

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org). The release
script reads them to choose the next version:

| Commit                                        | Release |
|-----------------------------------------------|---------|
| `feat: …`                                     | minor   |
| `fix: …`, `perf: …`, `revert: …`              | patch   |
| `feat!: …` or a `BREAKING CHANGE:` footer     | major   |
| `docs:`, `test:`, `ci:`, `chore:`, `build:`, `style:`, `refactor:` | none |
| any other message                             | patch if it changes shipped files (`src/` except tests, `media/`, `schemas/`, `package.json`), otherwise none |

```bash
npm run bump:check   # is a release needed, and which version? (changes nothing)
npm run bump         # update package.json, package-lock.json and CHANGELOG.md, commit and tag vX.Y.Z
git push --follow-tags
npm run package
```

- A release is only made when something users get has changed. Docs and test commits on their
  own never trigger one.
- If you set the version in `package.json` by hand, that exact version is released.
- `npm run bump -- --release-as minor` (or `2.0.0`) overrides the automatic choice.
- `--no-git` only writes the files, and `--json` prints the result for CI.
- The script refuses to release from a dirty working tree, a detached HEAD or a branch that is
  behind its upstream. It never pushes.

### Architecture: one monolith

`scripts/build.ts` bundles everything into **one file, `dist/main.cjs`**. The webview client is
compiled for the browser and inlined into the extension bundle. There are no runtime
dependencies, only `vscode` and Node built-ins (semver is implemented in-house).

```
src/
├── main.ts                      entry point (activate / deactivate)
└── VsCodeExtension/
    ├── extension.ts             wiring
    ├── controller.ts            VS Code glue: settings, commands, watchers, timer, messages
    ├── core/                    pure Node logic, fully unit-tested, no vscode import
    │   ├── engine.ts            sync orchestration and the serialised operation queue
    │   ├── poolRepository.ts    clone / fetch / fast-forward / pull / commit / push / tags
    │   ├── skillManager.ts      resolve versions (ls-remote) and shallow installs into mindSkills
    │   ├── config.ts            config.json
    │   ├── manifest.ts          skill.json
    │   ├── semver.ts            npm-style ranges
    │   ├── git.ts               git runner and output parsers
    │   └── validation.ts        names, URLs, refs, paths (untrusted input)
    └── ui/
        ├── render.ts            pure HTML rendering (shared by webview and tests)
        ├── client.ts            webview script (browser)
        ├── styles.ts, icons.ts  theme-aware CSS and a hand-drawn SVG icon set
        ├── dashboardProvider.ts, statusBar.ts, html.ts, messages.ts, status.ts
```

## License

GPL-3.0. See [LICENSE](LICENSE).

The dashboard uses the AIgromatics brand fonts, Schibsted Grotesk and IBM Plex Mono, under the
SIL Open Font License 1.1. `scripts/build.ts` inlines them into the bundle; their licenses are in
[`media/fonts/`](media/fonts).

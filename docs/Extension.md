# How MindPool works

MindPool is a VS Code extension that shares a team's AI skills through a private Git repository.
Nothing is published to a public registry: the team keeps one repository that lists its skills,
and every member's MindPool downloads them and keeps them up to date.

**In short:**

- The user picks a **pool folder** that contains a `config.json`.
- `config.json` points to the **team repository**. It must be a Git repository, and it names a
  **branch** and, optionally, a **release tag**.
- MindPool **clones** the team repository into the pool folder if it isn't there yet. If it is
  there, MindPool looks for **new commits** and updates the local copy automatically.
- From the dashboard you can **pull**, **commit** and **push**. For anything more complex, a button
  **opens the repository in a new VS Code window**.
- The team repository contains **`skill.json`**. It lists where to download each skill with Git,
  like `dependencies` in a `package.json`. On every sync, MindPool checks each skill for a **newer
  version**.
- Skills are downloaded into **`mindSkills/`**, a folder that is never committed. Only the team's
  settings get pushed.
- All code is **TypeScript**, and every TypeScript import points to another `.ts` file.

For step-by-step instructions, see the [User Guide](UserGuide.md).

---

## 1. Concepts

| Term | Meaning |
|---|---|
| **Pool folder** | A folder on the user's machine that holds `config.json`. Set with the `mindpool.poolFolder` setting. |
| **`config.json`** | Says which team repository to use, and which branch or release tag. |
| **Team repository** | A Git repository, cloned into the pool folder. It contains `skill.json` and any other settings the team shares. |
| **`skill.json`** | The list of skills and the Git source of each one. |
| **Skill** | A Git repository of its own, downloaded into `mindSkills/<name>/`. |
| **`mindSkills/`** | The folder inside the team repository where skills are downloaded. It is never committed. |

```
~/MindPool/                        ← pool folder (mindpool.poolFolder)
├── config.json                    ← which repository, branch and tag
└── Skills/                        ← team repository (cloned by MindPool)
    ├── skill.json                 ← shared list of skills (committed)
    ├── …                          ← any other team settings (committed)
    └── mindSkills/                ← downloaded skills (never committed)
        ├── superpowers/
        └── code-review/
```

## 2. The pool folder and `config.json`

The pool folder comes from the `mindpool.poolFolder` setting. The path may use `~`, `${userHome}`
and `${workspaceFolder}`. Each machine can set its own pool folder.

```json
{
    "repository": "https://github.com/AiGromatics/Skills.git",
    "branch": "main",
    "tag": "v1.0.0",
    "directory": "Skills"
}
```

| Key          | Required | Rule |
|--------------|----------|------|
| `repository` | yes      | Git URL: https, ssh or a local path. |
| `branch`     | yes      | The branch to track. It is always required, even with a tag: the clone starts from it. |
| `tag`        | no       | A release tag to pin. The checkout becomes **read-only** (see [§3.2](#32-release-mode-tag)). |
| `directory`  | no       | The folder name for the clone. It defaults to the repository name, and it can't be `mindSkills`. |

The dashboard shows a different screen depending on the state of the pool folder:

| State | What the dashboard shows |
|---|---|
| No pool folder set | A welcome screen with **Choose pool folder**. |
| No `config.json` | A form that writes `config.json` (**Save & clone**). |
| `config.json` is invalid | The same form, pre-filled with the current values and showing the error. |
| Repository not cloned yet | A clone is attempted on the next sync. |
| Ready | The full dashboard. |

Unknown keys in `config.json` are kept when MindPool rewrites the file.

## 3. Keeping the team repository up to date

### When a sync runs

| Trigger | What happens |
|---|---|
| VS Code starts | Full sync. |
| Every `mindpool.syncIntervalMinutes` (default 15, `0` turns it off) | Full sync. |
| `config.json` or `skill.json` changes on disk | Full sync. |
| **Sync** button or the *MindPool: Sync Now* command | Full sync. |
| The VS Code window regains focus, or the dashboard is shown | Local refresh only, with no network access. |

With `mindpool.autoSync` turned off, only the **Sync** button and the command start a full sync.
Only one operation runs at a time, and sync requests that arrive while a sync is still waiting to
run are merged into it.

### What a sync does

1. **Clone** the repository if it isn't there yet (`git clone --branch <branch>`). MindPool refuses
   to clone into a folder that exists and isn't empty.
2. Otherwise, **fetch** from the remote. If the URL in `config.json` changed, `origin` is updated
   first.
3. **Align** the checkout with `config.json`: branch mode or release mode, described below.
4. Make sure **`mindSkills/` is excluded** from Git (see [§6](#6-why-mindskills-is-never-committed)).
5. **Sync the skills** (see [§5](#5-skilljson-and-the-skills)).

If the remote can't be reached, MindPool keeps working with the local copy, shows **Offline**,
and tries again on the next sync.

### 3.1 Branch mode (no tag)

MindPool switches to the configured branch, then updates it **only when that is safe**:

| Situation | Result |
|---|---|
| Only the remote has new commits | **Fast-forward** automatically. |
| Only you have new commits | Nothing to do. **Push** shows how many commits are waiting. |
| Both sides have new commits | No automatic update. A banner asks you to **Pull** (rebase). |
| Local changes would be overwritten, or a merge or rebase is in progress | The update is skipped, with a warning in the activity log. |

MindPool never merges, rebases or discards work without the user asking.

### 3.2 Release mode (tag)

- The checkout is placed on the tag (detached HEAD) and is **read-only**: commit and push are
  turned off.
- When the remote has newer release tags, the dashboard offers **Use vX.Y.Z**, which updates `tag`
  in `config.json`.
- The tag pins the **team repository**, and therefore the content of `skill.json`. Skills listed
  with a branch or a version range still move. To freeze everything, pin the skills with `tag` as
  well.

## 4. Pull, commit, push and the new window

| Action | Behavior |
|---|---|
| **Pull** | `git pull --rebase --autostash` on the configured branch. If the rebase hits a conflict, MindPool aborts it, restores the previous state, and suggests opening the repository in a new window. |
| **Commit** | Commits the files ticked in the **Changes** card. Every file starts ticked, and at least one file and a message are required. Shortcut: ⌘/Ctrl+Enter. |
| **Push** | Pushes the configured branch only. If the remote rejects the push, the message is *"Pull first, then push again"*. |
| **Commit & Push** | Both in one step. Shortcut: ⌘/Ctrl+Shift+Enter. |
| **Open in New Window** | Opens the team repository in a new VS Code window, for branches, history and merge conflicts. |

Commit and push are blocked in release mode, and while a merge or rebase is in progress.

## 5. `skill.json` and the skills

`skill.json` sits at the root of the team repository:

```json
{
    "name": "aigromatics-skills",
    "description": "AI skills shared by the AiGromatics team.",
    "skills": {
        "superpowers": { "repository": "https://github.com/obra/superpowers.git", "version": "^7.0.2" },
        "code-review": "https://github.com/acme/skill-code-review.git",
        "pdf-tools":   "https://github.com/acme/pdf-tools.git#^2.1.0",
        "writer":      { "repository": "git@github.com:acme/writer.git", "branch": "develop" },
        "planner":     { "repository": "https://github.com/acme/planner.git", "tag": "v1.4.0" }
    }
}
```

Skill names may contain letters, digits, `.`, `_` and `-`. The name becomes the folder name in
`mindSkills/`.

### Sources

| Source | Installs | On each sync |
|---|---|---|
| `"url"` | the newest commit of the default branch | updates to new commits |
| `{ "repository", "branch" }` | the newest commit of that branch | updates to new commits |
| `{ "repository", "tag" }` | exactly that tag | stays pinned, and **reports** newer releases |
| `{ "repository", "version" }` | the highest tag that matches the semver range | **upgrades within the range**, and reports versions outside it |
| `"url#something"` | shorthand: a semver range becomes `version`; anything else is looked up as a tag, then as a branch | as above |

Version ranges follow npm: `^1.2.0`, `~1.2`, `>=2 <3`, `1.x`, `1.0.0 - 2.0.0` and `^1 || ^2`. A
leading `v` in tag names is fine (`v7.0.2` matches `7.0.2`). As in npm, a pre-release such as
`1.1.0-beta.2` is only chosen when the range names a pre-release of that same version, for
example `^1.1.0-beta.1`.

### What happens to each skill on every sync

1. **Resolve.** MindPool reads the skill repository's branches and tags with `git ls-remote`,
   without downloading anything, and works out the target commit. A repository used by several
   skills is queried once per sync, and up to four skills are checked in parallel.
2. **Compare** the target commit with the commit installed in `mindSkills/<name>/`.
3. **Install or update** if the two differ. MindPool downloads only that one commit (a shallow
   fetch) and checks it out. If `mindpool.autoUpdateSkills` is off, the skill is shown as
   **update ready** instead.

Each skill folder keeps its own small `.git`. That's how MindPool knows which commit is installed
and whether someone edited the files.

### Safety rules

- **Local edits are never overwritten.** An edited skill shows **local changes** and stops
  updating. **Reinstall** drops the edits and installs it again.
- **Removed skills are pruned.** When a skill leaves `skill.json`, its folder is deleted on the
  next sync, like `npm prune`. This only happens when `skill.json` is valid, auto-update is on, and
  the folder has no local changes. Otherwise the folder is listed as a leftover with a
  **Clean up** button.
- **A broken `skill.json` never deletes anything.** The dashboard shows the error and an **Open**
  button.
- **One failing skill doesn't stop the others.** It shows **error** with the reason and a
  **Retry** button.
- **MindPool refuses to replace a folder in `mindSkills/` that isn't a Git checkout.**

## 6. Why `mindSkills/` is never committed

On every sync, MindPool adds `/mindSkills/` to the team repository's **`.git/info/exclude`**. That
file is a local ignore list, so no tracked file has to change. The team repository can also list
`/mindSkills/` in its own `.gitignore`, to cover anyone who clones it without MindPool.

As a result, **Changes**, **Commit** and **Push** only ever see the team's settings
(`skill.json` and anything else the team adds), never the downloaded skills.

## 7. User interface

- **Dashboard** in the activity bar, with these cards:
  - **Repository:** branch or tag, HEAD, commits to pull and push, last sync, and the **Sync**,
    **Pull**, **Push** and **Open** buttons.
  - **Changes:** a file list with checkboxes, the commit message, **Commit** and
    **Commit & Push**.
  - **Skills:** each skill's status, version and actions, plus the **＋** form to add a skill. The
    form checks the repository and suggests its branches and tags.
  - **Activity:** what happened and when.
- **Status bar item:** overall health at a glance (*All synced*, *Updates available*, *Offline*,
  *Needs attention*). Click it to open the dashboard.
- **Commands** (*MindPool: …*):
  - Sync Now
  - Select Pool Folder…
  - Pull
  - Commit Changes…
  - Push
  - Open Repository in New Window
  - Open config.json
  - Open skill.json
  - Add Skill…
  - Update All Skills
  - Reveal mindSkills Folder
- **Output channel "MindPool":** the full output of every Git command.
- **`skill.json` validation:** the editor checks the file against a JSON schema and offers
  completion.

## 8. Settings

| Setting | Default | Meaning |
|---|---|---|
| `mindpool.poolFolder` | `""` | The folder that contains `config.json`. |
| `mindpool.autoSync` | `true` | Sync on startup, on a timer, and when `config.json` or `skill.json` change. |
| `mindpool.syncIntervalMinutes` | `15` | Minutes between automatic syncs. `0` turns the timer off. |
| `mindpool.autoUpdateSkills` | `true` | Install newer skill versions automatically. When off, they are only reported. |
| `mindpool.gitPath` | `git` | The Git executable to use. |

## 9. Security

- **No hidden prompts.** Git runs with prompts turned off and uses the credentials the user already
  has (credential helper or SSH agent). If authentication is needed, the user signs in through
  **Open in New Window** and VS Code's Git.
- **Time limits.** Network operations time out after 3 minutes.
- **Contents of `config.json` and `skill.json` are treated as untrusted input:**
  - URLs and refs can't start with `-`.
  - The `ext::` and `fd::` Git transports are refused.
  - Skill and folder names are restricted to safe characters.
  - Every path is checked to stay inside the pool folder.
- **The dashboard webview** runs under a strict Content Security Policy (scripts only with a
  nonce), escapes everything it displays, and validates every message it sends to the extension.

## 10. Code requirements

- **TypeScript only.** Every import points to a `.ts` file, for example
  `import { … } from './core/engine.ts'`. The code uses only syntax that Node can run directly
  (no `enum`, `namespace` or constructor parameter properties). Tests and build scripts run on
  Node ≥ 22.18 with no compile step.
- **Monolithic.** One bundle, `dist/main.cjs`, contains the whole extension, including the
  dashboard script. There are no runtime dependencies: the semver logic is part of the code.
- **Separated core.** The Git, config, manifest and sync logic (`src/VsCodeExtension/core/`)
  doesn't import `vscode`, so it is tested directly against real Git repositories. The extension
  as a whole is also tested end to end inside a real VS Code.

The [README](../README.md#development) has the build and test commands, and a map of the source
files.

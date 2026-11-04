# Using MindPool

How to get your team's AI skills with MindPool and keep them up to date.

The examples use the AiGromatics team repository, `https://github.com/AiGromatics/Skills.git`,
which shares the [superpowers](https://github.com/obra/superpowers) skills.

## 1. Install

1. In VS Code, open the Extensions view, click **⋯**, choose **Install from VSIX…** and pick
   `mindpool-1.0.0.vsix`. From a terminal, you can instead run
   `code --install-extension mindpool-1.0.0.vsix`.
2. Make sure **Git** is installed and that you can access the team repository with your usual Git
   login (credential helper or SSH key). MindPool never asks for passwords itself.

The MindPool icon appears in the activity bar.

## 2. Connect to the team repository (once)

1. Click the MindPool icon, then **Choose pool folder**. Pick an empty folder, for example
   `~/MindPool`.
2. Fill in **Connect your skills repository**:

   | Field              | Value                                        |
   |--------------------|----------------------------------------------|
   | **Repository URL** | `https://github.com/AiGromatics/Skills.git`  |
   | **Branch**         | `main`                                       |
   | **Release tag**    | leave empty to always follow `main`          |
   | **Folder name**    | leave empty (the default is `Skills`)        |

   **Check repository** confirms you have access and suggests branches and tags.
3. Click **Save & clone**.

MindPool saves your answers in `config.json`, clones the repository and downloads every skill:

```
~/MindPool/
├── config.json
└── Skills/                      ← the team repository
    ├── skill.json               ← the list of shared skills
    └── mindSkills/              ← downloaded skills (never committed)
        └── superpowers/
            └── skills/          ← brainstorming, systematic-debugging, writing-plans, …
```

> If a teammate gave you a `config.json`, put it in a folder and choose that folder in step 1.
> MindPool skips the form and starts cloning.

## 3. Use the skills

Point your AI tool at the skill folders inside `mindSkills/`. For superpowers, the individual
skills are in `mindSkills/superpowers/skills/`. The folder icon in the **Skills** card opens
`mindSkills/` for you.

Don't edit files in `mindSkills/` (see [Troubleshooting](#7-troubleshooting)).

## 4. Stay up to date

You don't have to do anything. MindPool syncs when VS Code starts, every 15 minutes, and whenever
`config.json` or `skill.json` changes. Click **Sync** at any time to sync right away.

Each sync pulls the team's new commits and installs newer skill versions. superpowers is listed as
`^7.0.2`, so every new 7.x release installs automatically. A v8 is only *reported* until someone
changes the range in `skill.json`.

The status bar shows how things stand, for example **All synced**, **Updates available**,
**Offline** or **Needs attention**. Click it to open the dashboard.

## 5. Add or remove a skill

**To add a skill:**

1. In the **Skills** card, click **＋**.
2. Paste the skill's **Git repository** URL and click **Check**. MindPool suggests a name and lists
   the repository's branches and tags.
3. Choose which version to follow:
   - **Latest:** the newest commit of the default branch.
   - **Branch:** the newest commit of a branch.
   - **Tag:** exactly one release. You're told about newer releases, but they aren't installed.
   - **Version:** a range such as `^1.0.0` that upgrades by itself. This is the best choice when
     the repository publishes release tags.
4. Click **Add skill**. It's installed on your machine right away.
5. `skill.json` now appears in the **Changes** card. Write a message and click **Commit & Push**.
   Teammates get the skill on their next sync.

**To remove a skill:** click the trash icon on the skill, then commit and push. It's deleted from
everyone's `mindSkills/` on their next sync.

## 6. Commit, pull and push

| Where | What it does |
|---|---|
| **Repository** card | **Sync**, **Pull** (rebases your commits on top of the team's), **Push**, and **Open**, which opens the repository in a new VS Code window. Use **Open** for anything more advanced: branches, history, merge conflicts. |
| **Changes** card | Tick the files to include, write a message, then **Commit** or **Commit & Push**. Shortcuts: **⌘/Ctrl+Enter** commits, and **⌘/Ctrl+Shift+Enter** commits and pushes. |
| **Activity** card | What MindPool did and when. The full Git output is in **Output → MindPool**. |

## 7. Troubleshooting

| You see | What to do |
|---|---|
| A skill shows **local changes** | Someone edited files in `mindSkills/<skill>`, so MindPool stops updating that skill. Click **Reinstall** to drop the edits. To change a skill, change its own repository. |
| A skill shows **update ready** or **not installed** | Click the rocket icon on the skill to install it now. This happens when `mindpool.autoUpdateSkills` is off. |
| A skill shows **error** | The skill repository can't be reached, or no release matches the version. Check the message and your access, then click **Retry**. |
| **Offline** or **Repository not reachable** | Check your network or Git login. The skills you already have keep working, and MindPool tries again on the next sync. |
| *"Pull first, then push again"* | A teammate pushed first. Click **Pull**, then **Push**. |
| *"Local and remote both moved"* | Click **Pull** to put your commits on top of the team's, then **Push**. |
| **Pinned release: read-only** | `config.json` has a release tag, so you can't commit. To upgrade, click **Use v…** when a newer release is offered. To edit, remove the tag in the repository settings (⚙). |
| **skill.json has a problem** | Click **Open**. The message tells you which entry is wrong. |

All settings (`mindpool.poolFolder`, `mindpool.syncIntervalMinutes`, `mindpool.autoUpdateSkills`
and more) are described in the [README](../README.md#settings).

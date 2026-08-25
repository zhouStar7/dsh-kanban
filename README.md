# dsh-k 🗂️

<p align="center"><a href="README.zh.md"><b>简体中文</b></a> · English</p>

**AI-assisted local project task board for DeepSeek Harness (DSH).**

Turn projects, git branches and AI agents into one automated pipeline: create a task → an agent picks it up in an isolated branch → commits → human review → auto merge back.

## ✨ Features

- **会话 / 看板 tabs** in the sidebar — switch between conversations and the board;
- **New-session button** moved into the workspace header action group (left of search), hover style matches the search button;
- Board opens in the **right main body** (no more overlay popup), top area keeps 40px breathing space;
- Toolbar: **新建任务 + project filter on the left**, **看板 / 路线图 tabs on the right** (refresh removed);
- Column view + roadmap (Gantt) view;
- Task state machine: `todo → running → review → approved → done` (+ `paused`);
- Agents auto-claim tasks, work in a dedicated `kanban/<id8>` branch and commit;
- Human review merges (`--no-ff`) back into the base branch and deletes the task branch;
- Comments and follow-up: send a comment to resume the agent in the same session;
- New-session model/time scheduling, git branch dropdown, `/` path autocomplete for descriptions/comments;
- Full change logs (agent final output) per task.

## 🚀 Install (GitHub Release, one line)

```bash
dsh plugin --profile web add "https://github.com/zhouStar7/dsh-kanban/releases/latest/download/dsh-k.tgz"
```

Install the plugin, then **restart / reload DSH** — the sidebar shows「会话 / 看板」tabs.

> Force reinstall:
> ```bash
> dsh plugin --profile web remove @deepseek-kanban/plugin && dsh plugin --profile web add "https://github.com/zhouStar7/dsh-kanban/releases/latest/download/dsh-k.tgz"
> ```

### DSH Desktop sidebar patch

The built-in sidebar「新会话」button lives outside plugin slots. On DSH Desktop run once:

```bash
node scripts/patch-dsh-ui.mjs
```

It replaces the old new-session position with the「会话 / 看板」tabs and moves a new-session icon into the workspace header action group. Idempotent, keeps `.dsh-kanban.bak` backups.

## 🧱 Architecture

- **Host** (`lib/index.js`): task state machine, git scheduling, agent execution, storage domain (`$DSH_HOME/storages/kanban.json`).
- **Client** (`src/` Vue 3 + Tailwind + shadcn-vue, wrapped by `lib/client.js`): sidebar tabs, board/roadmap UI, `ctx.remote.kanban.*` calls.
- Remotes are Typert SRC-described; the gateway exposes `/api/kanban/*`.

## 🛠 Development

```bash
pnpm install
pnpm build        # vite build && node scripts/wrap-client.mjs
pnpm test:smoke   # host state-machine smoke test
```

Reinstall locally with the packed tarball (a `link:`/`file:` local install can load duplicate `@deepseek-ai/*` runtimes and cause `/api/kanban/*` 404 — prefer the tarball):

```bash
pnpm pack
# e.g. for DSH Desktop profile:
# dsh plugin --profile web add "./dsh-kanban-0.1.0.tgz"
```

## 🔒 Privacy

No telemetry. State lives in the local DSH storage domain and browser side data; git operations stay inside the selected project.

## License

MIT

## Related

- [dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) — agent workspace/control-room for DSH

---
name: kanban-init
description: "Scaffold a repo for kanban-flow: copy config, an empty addendum, and empty board starters into the board dir (default docs/cards/). Idempotent: never clobbers a live board. Run once, before /refine."
---

# /kanban-init — scaffold a project for kanban-flow

Set up the current repository to use the kanban-flow system. You copy config
and empty board starters into the repo; doctrine and templates stay
plugin-owned and are read live. You never modify the plugin.

## Steps

1. **Resolve the target.** `board_dir` defaults to `docs/cards`. If the user passed
   an argument, use it as `board_dir`. The plugin's templates live at
   `${CLAUDE_PLUGIN_ROOT}/templates/`.

2. **Idempotency guard.** If `<board_dir>/config.md` already exists, STOP: report
   that a board is already initialized here, show the existing `config.md` path, and
   do nothing destructive. Never overwrite an existing board, config, or cards.

3. **Scaffold.** Create `<board_dir>/` and copy from `${CLAUDE_PLUGIN_ROOT}/templates/`:
   - `config.md` → `<board_dir>/config.md`, then stamp its `kanban_flow_version`
     to the installed plugin version (read `version` from the plugin's
     `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`).
   - `PROTOCOL-ADDENDUM.md` → `<board_dir>/` (the empty project-doctrine stub
     `/retro` will append project-specific rules to).
   - `board/BOARD.md`, `board/KNOWLEDGE.md`, `board/MILESTONES.md` → `<board_dir>/`
   - Create the ADR directory (`adr_dir`, default `docs/adrs/`). Only if
     `<adr_dir>/README.md` does not already exist, create it as a stub containing
     an empty ADR index heading — a repo with pre-existing ADRs must not have its
     index clobbered.

   **Copy nothing else.** The four items above are the whole list; everything else
   under `templates/` — `AGENT-PROTOCOL.md`, `INTAKE.md`, `lenses/`, `checks/`,
   `card-template.md`, `pr-template.md`, `design-pr-template.md`, and anything a
   later version adds — is **plugin-owned** and read live at runtime (the
   orchestrator injects absolute paths into every dispatch). Copying any of it into
   the repo would re-create the per-repo doctrine drift this design removes. A
   customized template is expressed as a `template_overrides` entry in `config.md`,
   never as a copy made at init.

4. **Report next steps.** Tell the user to:
   - Edit `<board_dir>/config.md` — set `spec_path` to their spec, adjust `layers`
     to their architecture, set `gate_layer`, set `gh_command` if they use a bot
     identity wrapper, and review `wip_limit`, `gates`, and `coverage_target` for
     their project. The commented `testing:` block enables test levels
     (integration/contract/functional/journey/experience) — leave it commented until the project
     has the commands and harness to back it.
   - Run `/refine` to populate the backlog, then `/kanban` to start driving cards.

## Rules

- Read-only toward the plugin; write only inside the target repo.
- Idempotent: safe to run again — it no-ops if `config.md` exists.
- Do not run `/refine` or `/kanban` yourself; just scaffold and hand off.

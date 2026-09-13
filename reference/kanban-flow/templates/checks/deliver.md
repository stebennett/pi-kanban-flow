# deliver — check criteria

Read `checks/_method.md` first (the discipline and the return format); this file is your criterion set.
Checks `card-deliverer`, after the PR is open. Your inputs: `card.md`, the PR url and its mode (design
| implementation), the PR body, the branch, and the **`checks` policy** — a check that is `off` never
wrote its check doc, and its absence is not a finding.

| id | criterion | severity when failed |
|---|---|---|
| `DLV-BASE` | the PR targets `main` and was cut from the right branch | blocking |
| `DLV-BODY-TRUE` | every claim in the PR body is supported by the diff; no claimed acceptance criterion is unimplemented | blocking |
| `DLV-SIZE` | **actual changed lines are within `size_limit`** (implementation PRs only — see below) | **advisory, escalated** |
| `DLV-DOCS` | the phase docs that should ride this PR are on it — design PR: `slice.md`, `design.md`, `slice-check.md`, `design-check.md`, ADRs; implementation PR: `implement.md`, `test.md`, `review.md`. **A check doc is expected only when its check is `on`**: a disabled check writes no doc, and a right-sized card never sliced, so neither absence is a finding | blocking |
| `DLV-PURITY` | a design PR carries no code; an implementation PR carries no unrelated changes | blocking |
| `DLV-CI` | CI is green or running; the PR was not opened on a known-red branch | blocking |

**Evidence commands** (read-only — you never mutate GitHub):
```bash
{gh_command} pr view <url> --json baseRefName,headRefName,body,state,files
{gh_command} pr checks <url>
git -C <worktree> fetch origin main
git -C <worktree> diff --numstat origin/main...<the PR's branch>
```

**Name the PR's branch — never `HEAD`.** On a slice PR it is the slice branch `<type>/NNN-slug-<k>`,
not the card's original implementation branch; and a worktree any agent may have moved is not a
trustworthy `HEAD`.

**`DLV-BODY-TRUE` — claim by claim.** Check every claim in the PR body against the diff individually,
and confirm no claimed acceptance criterion is unimplemented. A slice PR (k of N) that claims only its
own share of the card's acceptance criteria is **correct, not partial** — judge it against what it
claims, not against the whole card.

**`DLV-SIZE` — measured, advisory.** Implementation PRs only; a design PR is exempt (a long design
document is not a code-review problem) → `na`. Count actual changed lines: sum `added + deleted` from
`git -C <worktree> diff --numstat origin/main...<the PR's branch>`, **excluding** `size_exclude` paths
**and the card's own phase docs** (`docs/cards/**` — the budget measures the change a human must review,
not the paperwork; `estimated_lines` counted code + tests only, so counting docs inflates every card
against its own estimate). State in your evidence which paths you excluded. A breach is **advisory, not
blocking** — but not a shrug: you **must propose a concrete split** in the finding's `remedy` (which
commits or file groups become which smaller PRs, and in what order; name them), which the orchestrator
surfaces for the driver. Always report `actual_lines: <N>` in your `phase_doc`, breach or not — the
orchestrator records it and `/retro` reads it against `estimated_lines`. (Why a breach is advisory
rather than blocking is in `RATIONALE.md`.)

**Don't flag:** a `size_exclude` file's size (that is what the exclusion is for); a design PR's length
under `DLV-SIZE`; CI that is merely still running (`DLV-CI` fails only on *red*, not on *pending*).

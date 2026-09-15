# Project overrides and model configuration specification

## Agent overrides

Package defaults live in package `agents/*.md`. Project overrides are considered only inside the canonical trusted repository.

Search `.pi/agents/*.md` from dispatch cwd upward to the Git repository root. The nearest same-name definition wins over the package default. Canonicalize paths and reject symlinks escaping the repository. Saved trust is required; malformed/duplicate definitions fail before mutation.

Every override is shown in pump output and parent-attested with source, canonical repository-relative path, and SHA-256. Overriding a checker changes workflow guarantees and must be prominently documented.

### Exact agent definition contract

The package defines this complete schema-version-1 workflow agent set, in dispatch/report order: `requirements-producer`, `requirements-checker`, `design-producer`, `design-checker`, `split-decider`, `implementer`, `reviewer`, `ship-producer`, and `ship-checker`. Objective project/Git/GitHub probes are parent-owned and have no agent definition. A project override is considered only when its filename is exactly `<known-agent-name>.md`; unrelated files in `.pi/agents/` are ignored because the directory may serve other Pi workflows. For a considered override:

- frontmatter has exactly `name` and `description`;
- `name` equals the known agent name and filename, uses lowercase letters/digits/single hyphens, and is 1–64 code points;
- `description` is a trimmed single line of 1–1024 code points;
- `model`, `tools`, role, policy, result tool, cwd, and resource fields are forbidden—the engine owns them;
- the Markdown body after frontmatter is non-empty and at most 100000 UTF-8 bytes;
- content must be valid UTF-8 with LF-normalized hashing; the SHA-256 is over those normalized bytes;
- an in-repository symlink is accepted only when its fully resolved regular-file target remains within the canonical repository root; an escape or symlink cycle fails;
- two considered files resolving to the same agent name at the same directory precedence fail; definitions at different ancestor levels are not duplicates and the nearest wins.

All considered overrides are parsed and validated before lock-protected mutation or external action. If project overrides are disabled, files are not activated but diagnostics report that matching overrides were ignored. Unknown/unrelated agent files neither activate nor block kanban-flow.

## Operational config

`docs/cards/config.yaml` is the sole operational configuration source. Its complete shape is defined in `spec-board-schema.md`. `board.yaml` stores immutable repository identity and historical/schema metadata only.

## Model config

```yaml
agent_models:
  default: inherit
  overrides:
    design-checker: anthropic/claude-opus-4-6:high
    implementer: openai/gpt-5.4:high
```

- Inheritance includes parent provider, model ID, and effective thinking level.
- Override syntax is Pi `provider/model` with an optional recognized final `:<thinking>` suffix (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`). Colons that do not form a recognized final suffix remain part of the model ID.
- Override keys are names from the fixed workflow-agent set above; unknown keys fail config validation.
- Unresolved or unauthenticated overrides fail dispatch with no fallback.
- The runner records the actual provider/model/thinking from authoritative Pi events.

Setup diagnostics must prove the inherited/default model is authenticated and supports custom tool calls. Each explicit override is resolved before its first dispatch. Documentation recommends high-capability models for requirements, design, architecture, split judgment, and independent review; implementation may use any authenticated tool-capable model appropriate to the project. Recommendations never become hidden fallback or hard-coded provider tiers.

## Resource config

```yaml
resources:
  broad_policy_allowed_skills: []
```

Broad producers may receive only listed in-repository trusted skills. Strict roles receive no arbitrary project skills or extensions. Child command construction and policy are parent-attested. Detailed enforcement is in `spec-child-agent-runner.md`.

## GitHub config

```yaml
repository:
  forge: github
  gh_command: gh
  remote: origin
  base_branch: main
```

First release rejects values other than GitHub, `origin`, and `main`. `gh_command` is invoked directly with argv and no shell.

## Validation

Validate all configuration before mutation. Unknown fields and unsupported enum values are errors; future extension fields must be explicitly namespaced.

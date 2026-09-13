# Lock and lease specification

## Purpose and scope

Prevent concurrent pumps across the main checkout and its linked worktrees on one machine. Multi-host protection is deferred.

## Common lock location

Resolve the canonical common Git directory using `git rev-parse --path-format=absolute --git-common-dir`. Store:

```text
<git-common-dir>/kanban-flow/lock.json
```

Never assume `.git` is a directory. Every linked worktree for the repository resolves to the same lock. Resolve the parent with realpath semantics, reject a symlink at `kanban-flow` or `lock.json`, create the `kanban-flow` directory with mode `0700`, and create lock/temp files with mode `0600` subject to a stricter process umask. Unexpected ownership, file type, link count, or permissions fail closed.

## Operation identity and acquisition

Generate a `KFOP-*` pump operation ID before lock acquisition. A `KFTX-*` state transaction ID is generated later only if a board mutation is planned.

Create the lock atomically with exclusive-create semantics while holding the short-lived mutation mutex described below. Write complete canonical JSON, flush it, and close it before treating acquisition as successful. Record a cryptographically random 256-bit ownership token in addition to pid/session metadata:

```json
{
  "version": 1,
  "repository_id": "owner/repo",
  "git_common_dir": "/canonical/repo/.git",
  "operation_id": "KFOP-...",
  "transaction_id": null,
  "owner_token": "random-secret-token",
  "pid": 12345,
  "host": "hostname",
  "pi_session_id": null,
  "started_at": "2026-01-01T00:00:00Z",
  "heartbeat_at": "2026-01-01T00:00:00Z",
  "expires_at": "2026-01-01T00:30:00Z",
  "command": "kanban"
}
```

The lock object has exactly the shown keys and rejects unknown fields. `version` is constant `1`; repository/common-dir values equal the current canonical identities; operation/transaction IDs use their specified patterns; transaction is null until allocated; owner token is 64 lowercase hexadecimal characters; pid is a positive integer; host and command are non-empty single-line strings bounded to 255 and 128 code points; Pi session ID is a non-empty bounded string or null; timestamps are UTC RFC 3339 with `started_at <= heartbeat_at < expires_at`; and `expires_at` is exactly `heartbeat_at + ttl_seconds`. The command is one of the package's lock-taking operations (`kanban`, `kanban-init`, `requirements`, `migrate`, `state-recovery`, or `blocker-resolution`).

Update `transaction_id` atomically after transaction creation.

## Lock mutation mutex

Acquisition, heartbeat replacement, transaction-ID update, release, stale recovery, and force unlock are serialized by exclusive creation of `<git-common-dir>/kanban-flow/lease-mutex.json`. The mutex contains exactly `version`, `owner_token`, `pid`, `host`, `acquired_at`, and `expires_at`, with the same token/pid/host/timestamp validation as the lock and constant version `1`. It is never held while child, Git, GitHub, or project commands run. Its expiry is exactly 10 seconds after acquisition and is never extended.

A same-host mutex may be recovered automatically only after expiry and proof its pid is absent. A foreign-host, live, unparseable, or otherwise unverifiable mutex fails closed. Every mutation re-reads `lock.json` while holding the mutex and verifies the expected owner token immediately before write/remove. This prevents heartbeat/release from replacing or deleting a lock created after force recovery.

## Contention

Report owner host, pid, session, operation, transaction, start, heartbeat, and expiry, then exit without mutation.

## Heartbeat

Refresh under the mutation mutex by writing and flushing a same-directory temporary file, re-verifying the ownership token, and atomically renaming it over `lock.json`. Temporary names include the owner token and random bytes. Heartbeat failure, permission drift, or leftover-file cleanup failure is fatal before any new external action. The lease remains held while child agents or external commands run.

## Release

Success, handled failure, abort, and shutdown attempt release under the mutation mutex. Remove the lock only if canonical repository identity and ownership token match. PID alone is insufficient because of PID reuse. Missing lock after ownership was established is reported as lost ownership, not successful release.

## Stale recovery

Automatic recovery requires expiry and proof that the process is absent on the recorded local host. A hostname mismatch or inability to prove process death requires explicit force unlock. Recovery is reported and included in the next transaction history when one occurs.

A missing key, malformed JSON, unsupported lock version, repository/common-dir mismatch, symlink, non-regular file, or insecure ownership/permission state is a corrupt lock. It is never automatically recovered. Diagnostics display a bounded raw preview and SHA-256 rather than trusting malformed fields.

Force unlock runs under the mutation mutex, displays validated metadata or corrupt-file diagnostics, requires explicit interactive confirmation including the repository identity, and removes only the lock plus owner-token-matching temporary files. It never mutates board state or treats an operation as failed/successful. The next pump still reconciles remote markers before selection.

## State authority

The lock does not attest workflow success. After acquiring it, every pump reconciles remote state/PR operation markers because a prior owner may have died after an external action.

## Deferred remote lease

A second clone/host is unsupported. Distributed operation requires a remote lease and a later specification.

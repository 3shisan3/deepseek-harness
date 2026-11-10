# Agent Note: Destroy a Session through the Workspace seam

Status: implemented

English | [中文](2026-11-10-session-deletion-through-the-workspace-seam.zh.md)

## Problem

Sessions could be archived and restored, but nothing could remove one. Archival is a display-set write: the log stays on disk, the account slot is retained, and unarchiving restores the row. Removal needs the opposite guarantees — the stored log must be gone, every registry reference must stop naming the id, and the live Agent must end so its durable write handle closes.

The write handle is the hard part. `SessionPersistence` deliberately exposes no id-addressed mutation: every read and write flows through a `SessionHandle`, and the handle's owner holds single-writer ownership. A backend therefore cannot delete a log out from under an active writer, and no registry-level call can reach the teardown that closes it — `AgentHandle.dispose()` is held only by the owner that created the Agent, which is `ApiSessionAgentController` for ordinary API Sessions.

## Decision

Permanent deletion, owned by the Workspace seam:

| Item | Contract |
|---|---|
| Storage | `SessionPersistence.delete(id)` destroys one stored session whole — artifact, sibling generations, and any unmaterialized entry. It resolves `false` for an id no stored session holds and rejects `SessionAlreadyOwnedError` while a write handle owns the id. |
| Orchestration | `WorkspaceRegistry.deleteSession(sessionId)` verifies the session exists, stops its work, ends its live Agent, deletes the log, and only then drops each Workspace's account slot, the archive set, and the pin set. |
| Stop | `workspace/session-stop` (parallel) — the existing archive-admission providers, unchanged. |
| Teardown | `workspace/session-dispose` (parallel, awaited) — each owner that holds a live Agent's handle disposes it and awaits that disposal, so the log deletion finds no writer. |
| Notification | `workspace/session-deleted` (emit) — the registry's post-write signal. `session-controller` relays it as `api-session/removed` so a destroyed cold Session leaves the Client list, which `session/disposed` cannot do for a Session that was never live. |
| Remote | `workspace/deleteSession` on the existing `workspace` namespace, beside `archiveSession` and `unarchiveSession`; the row menu, the hover strip, and the Session header all raise one confirmation. |
| Unknown id | Rejected as `WorkspaceUnknownSessionError`, mapped to `session/not-found`. A repeat delete is a not-found because the first call already removed the session. |

The registry writes its own references last. A crash between the log deletion and that write leaves registry entries naming a missing log, which the membership projection already filters out; the reverse order would leave an orphan log the registry never names.

## Alternatives considered

| Alternative | Why it was rejected |
|---|---|
| `session/delete` on the Session namespace | The Session namespace owns commands that address a live Agent (prompt, rename, fork, cancel). Deletion is the one operation that must reach storage, every Workspace account, the archive set, and the pin set — all registry state. Putting it on `session` would make the API layer depend on the registry's full state, or duplicate the orchestration the registry already owns for archive admission. |
| Soft delete (a tombstone set, log retained) | The user's requirement was permanent removal. A tombstone would still expose the log to `session-query` and would need a second hiding rule in every read path. |
| Trash / quarantine with restore | Adds a retention policy, an expiry, and a restore surface. Nothing in the product asked for recoverability; the confirmation dialog is the safety net. |
| Idempotent delete (resolve on an unknown id, like `unarchiveSession`) | `unarchiveSession` is idempotent because removing an id from a set cannot introduce an unknown one and a lost race between two restores is harmless. Deleting an id that no longer exists is a different answer: the caller named something that is not there, and the surfaces need `session/not-found` to drop a row they still show. |
| Delete the log inside the registry without a dispose event | The registry would need to know how to end a live Agent, which is `dsh-agent-loop` internals reached only through `AgentHandle`. A parallel event keeps that knowledge with the owner that holds the handle, matching the existing `session-activity`/`session-stop` seam. |
| Optimistically rewrite the Client projection in `ClientWorkspaceModel.deleteSession` | The follow stream already carries the account, archive, and pin changes the deletion wrote. A second local write would race the stream for no gain. |

## Consequences

- A Session deletion is irreversible and leaves no tombstone. Attachment blobs become unreachable, which the attachment store already documents as awaiting a retention policy.
- A live Session whose Agent another owner published (subagent routing, ACP) has no `workspace/session-dispose` listener, so its write handle stays open and the log deletion rejects. That is fail-loud rather than silent.
- The registry's `WorkspaceUnknownSessionError` gained a `delete` verb.
- The Client list row for a deleted cold Session disappears through `api-session/removed`; a live one disappears through both that relay and `session/disposed`, which is idempotent.
- Derived indexes do not consume `workspace/session-deleted`: `session-query-sqlite` reconciles its persisted rows against `sessionPersistence.list()` at the next stable observation, so a deleted Session leaves unreachable index rows until then.

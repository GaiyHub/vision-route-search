## Context

Android application launch APIs acknowledge that a launch request was dispatched; they do not guarantee that the requested package is already foreground when the promise resolves. `open_app` currently maps that acknowledgement to a bare success value. The agent loop can therefore make its next decision from stale UI state, or repeat `open_app` while the activity transition is still in progress.

The Android controller already exposes an optional `getCurrentForegroundApp` operation. The toolkit also owns the platform-aware `delay` dependency used by the rest of the agent loop, so foreground confirmation can be implemented inside the tool without adding a global system-prompt rule or a second unconditional screenshot.

## Goals / Non-Goals

**Goals:**

- Give `open_app` synchronous, decision-ready semantics on top of asynchronous Android launch behavior.
- Stop waiting as soon as the requested package is foreground, while imposing a strict upper bound.
- Return structured evidence that distinguishes dispatch acceptance, foreground confirmation, and already-foreground no-op behavior.
- Preserve compatibility when foreground inspection is unavailable.
- Ensure an accepted but unconfirmed launch remains classified as potentially UI-changing.

**Non-Goals:**

- Guarantee that a particular activity, route, or page inside the package has loaded.
- Add generic launch/wait instructions to the system prompt.
- Change Android's underlying launch implementation or add a new native dependency.
- Automatically retry a rejected or intercepted launch.

## Decisions

### Confirm the package inside `open_app`

The handler will inspect the foreground package before dispatch. If it already matches, it will skip the launch request and return immediately. Otherwise it will dispatch once and poll the foreground package at a short interval until it matches or the confirmation budget expires.

This keeps launch-specific synchronization in the tool that owns the asynchronous side effect. A fixed sleep was rejected because it always pays the full delay and still cannot prove that the transition completed. Agent-loop-level special casing was rejected because it would spread Android package semantics into generic orchestration code.

### Bound both the overall confirmation and each inspection

Confirmation will use a small fixed poll interval and a bounded number of attempts, corresponding to an approximately four-second budget. Each optional controller inspection will also be raced against a short timeout through the toolkit's injected delay function. This prevents a stuck native inspection promise from consuming the outer tool timeout.

### Return a normal `ToolResult` with structured `data`

Results will expose `requestedPackage`, `foregroundPackage`, `activity`, `launchAccepted`, `launchConfirmed`, `confirmationAvailable`, `alreadyForeground`, and `elapsedMs`. Dispatch rejection and confirmation timeout use stable error codes plus an actionable hint. If foreground inspection is unavailable, dispatch acceptance remains `ok: true`, but `launchConfirmed` is false and `confirmationAvailable` is false; the tool must not claim evidence it could not collect.

Structured data was chosen over a bare boolean so the model can distinguish a slow transition, a wrong package, and a compatibility fallback without inferring from screenshots alone.

### Treat accepted launches as potentially UI-changing even on confirmation timeout

The generic post-tool no-op check currently treats every `{ok: false}` result as having no UI effect. An `APP_NOT_FOREGROUND` result is different: Android accepted the request and may have shown a resolver, permission screen, launcher, or another activity. The no-op check will therefore preserve observation when `launchAccepted` is true. Dispatch rejection remains a genuine no-op.

## Risks / Trade-offs

- [Some devices report transient launcher or system packages] → Poll until the exact requested package appears and include the last observed package in timeout metadata.
- [Foreground inspection is unavailable on older controller builds] → Keep dispatch-compatible behavior while explicitly marking confirmation unavailable.
- [A package reaches foreground before its content is fully rendered] → Scope confirmation to package foreground only; ordinary post-action settling and observation still handle UI readiness.
- [Polling adds latency when launch is intercepted] → Bound the confirmation window and exit immediately on success.

## Migration Plan

Ship the TypeScript/tooling change without a data migration. Existing callers that only check `ok` continue to work. Rollback consists of restoring the previous `open_app` handler and no-op classification; no persisted state is changed.

## Open Questions

None.

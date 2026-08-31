# Spec: `doupao-eval-bridge`

## Purpose

Provide a deterministic, evaluation-build-only control plane between ADB and the existing `processCommand` Agent entry.

## Request contract

Each request contains:

```ts
interface EvalRequestV1 {
  schemaVersion: 1;
  runId: string;
  sampleId: string;
  instruction: string;
  requestHash: string;
  timeoutMs: number;
}
```

- PC writes the request atomically to the app's ADB-accessible evaluation directory and starts the evaluation entry with only the `runId` as an argument.
- The bridge validates the file before passing the instruction to `processCommand`.
- Repeating the same `runId` and hash returns the existing lifecycle; reusing a `runId` with another hash fails with `IDEMPOTENCY_CONFLICT`.
- A second distinct run while one is active fails with `RUN_ALREADY_ACTIVE`.

## Status contract

The bridge atomically writes one current status document:

```ts
type EvalStatusV1 =
  | { schemaVersion: 1; runId: string; sampleId: string; state: 'ACCEPTED'; updatedAt: string }
  | { schemaVersion: 1; runId: string; sampleId: string; state: 'RUNNING'; traceId: string; startedAt: string; updatedAt: string }
  | { schemaVersion: 1; runId: string; sampleId: string; state: 'COMPLETED'; traceId: string; outcome: 'complete'; summary: string; startedAt: string; finishedAt: string; updatedAt: string }
  | { schemaVersion: 1; runId: string; sampleId: string; state: 'BLOCKED'; traceId?: string; reason: string; finishedAt: string; updatedAt: string }
  | { schemaVersion: 1; runId: string; sampleId: string; state: 'ERROR'; traceId?: string; code: string; message: string; finishedAt: string; updatedAt: string }
  | { schemaVersion: 1; runId: string; sampleId: string; state: 'CANCELLED'; traceId?: string; finishedAt: string; updatedAt: string };
```

## Safety and lifecycle

- Normal production builds must not accept evaluation requests.
- Evaluation mode must be visually identifiable in the app and enabled only by the evaluation build/configuration.
- The bridge resets conversation context before each sample but preserves settings and permissions.
- It automatically resolves the ordinary completion confirmation as complete.
- Risk gates, user questions and manual-action requests become `BLOCKED`; they are never approved by the bridge.
- Status writes use temporary-file-plus-rename or an equivalent atomic strategy.

## Success criteria

- A valid ADB request starts exactly one corresponding Agent task.
- PC can determine a terminal state without parsing UI text or unrestricted logcat.
- Duplicate delivery cannot execute the same intent twice.
- Production verification proves that the evaluation action is ignored or unavailable.


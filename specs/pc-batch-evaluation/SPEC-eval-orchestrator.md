# Spec: `eval-orchestrator`

## Purpose

Own the run state machine and guarantee bounded, sequential execution.

## Contract

- Snapshot the normalized dataset and Judge configuration metadata at run start.
- Execute enabled samples in dataset order on one selected serial.
- For each sample: run allowlisted setup, submit, wait, collect evidence, assert, judge, aggregate and run teardown.
- Continue after product failures, blocked interactions and per-sample infrastructure errors when the device remains usable.
- Support run cancellation and rerunning failed/blocked/error samples as a new run linked to the source run.
- Emit ordered progress events with monotonically increasing sequence numbers so SSE reconnects can replay current state.

## Aggregation

- `PASSED`: all required deterministic assertions pass and Judge passes when enabled.
- `FAILED`: one or more deterministic assertions fail, or Judge returns `FAIL`/below threshold.
- `INCONCLUSIVE`: Judge is inconclusive and no deterministic failure exists.
- `BLOCKED`: DouPao requested human interaction or risk authorization.
- `INFRA_ERROR`: bridge, ADB, evidence or Judge infrastructure prevented a valid decision.
- `CANCELLED`/`TIMED_OUT`: explicit terminal operational states.

## Success criteria

- A terminal state is persisted before the next sample starts.
- Process restart can reopen completed runs and clearly marks an interrupted active run.
- Cancelling a run never starts another sample.


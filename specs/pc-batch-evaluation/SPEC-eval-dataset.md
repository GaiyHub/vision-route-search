# Spec: `eval-dataset`

## Purpose

Provide the versioned source of truth for datasets and samples.

## Contract

- Accept YAML and JSON with `schemaVersion`, dataset metadata, defaults and an ordered `samples` array.
- Require stable unique dataset and sample ids, a non-empty instruction and at least one deterministic assertion or enabled Judge rubric.
- Support per-sample enablement, timeout override, structured setup/teardown actions, deterministic assertions and Judge configuration.
- Normalize YAML and JSON into one internal typed model and report validation errors with field paths.
- Persist edits atomically and never modify imported source files without an explicit Save action.

Example shape:

```yaml
schemaVersion: 1
id: doupao-smoke
name: DouPao smoke evaluation
defaults:
  timeoutMs: 180000
samples:
  - id: answer-time
    instruction: 现在几点？
    assertions:
      - type: outcome
        equals: complete
      - type: finalResponse
        matches: "\\d{1,2}[:：]\\d{2}"
    judge:
      enabled: true
      rubric: 回答应给出清晰、合理的当前时间，不应声称执行了无关手机操作。
      threshold: 0.8
      evidence: [finalResponse, traceSummary]
```

## Setup/teardown boundary

The first version supports only typed, allowlisted ADB actions such as launching or force-stopping a package, pressing Home/Back and waiting for a bounded duration. Arbitrary host shell and arbitrary `adb shell` strings are out of scope.

## Success criteria

- Equivalent YAML and JSON produce the same normalized dataset.
- Duplicate ids, unknown assertion types, invalid regular expressions, unsafe setup actions and invalid thresholds are rejected before a run starts.
- Dataset order is preserved in execution and reports.


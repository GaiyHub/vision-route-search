# Spec: `eval-report`

## Purpose

Produce auditable outputs after every run.

## Outputs

- `report.json`: schema-versioned run metadata, dataset snapshot, environment, aggregate metrics and per-sample results.
- `report.html`: self-contained human-readable report with no backend dependency.
- Per-sample raw and normalized artifacts under the run directory.

## Required report content

- Run id, source/rerun relationship, timestamps, selected device and dataset identity.
- Aggregate counts and rates by `PASSED`, `FAILED`, `INCONCLUSIVE`, `BLOCKED`, `INFRA_ERROR`, `TIMED_OUT` and `CANCELLED`.
- Duration, step and Token summaries.
- Deterministic assertion results.
- Judge provider/model metadata, verdict, score, threshold, reason and cited evidence.
- Final response, final UI screenshot/hierarchy links and normalized tool timeline.
- Infrastructure warnings and artifact paths.

## Rules

- Escape all dataset, Agent and Judge text before embedding it into HTML.
- Redact credentials and configured sensitive values.
- Generate a report even when the run is cancelled or partially interrupted.
- Report generation must be deterministic for the same persisted run data.

## Success criteria

- JSON validates against its schema and HTML opens locally with all styles/scripts embedded.
- A failed sample can be diagnosed without reconnecting the Android device.


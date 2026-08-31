# Spec: `evidence-collector`

## Purpose

Create one trustworthy evidence bundle for deterministic and model-based evaluation.

## Evidence bundle

- Bridge request and terminal status.
- Final Agent response and outcome.
- Complete OTel JSONL trace identified by `traceId`.
- Normalized tool calls, results, errors, durations, step count and token/cache usage.
- Final foreground package, UIAutomator hierarchy and PNG screenshot when capture succeeds.
- Collection warnings for missing optional evidence.

## Rules

- Pull raw files into `.data/runs/<runId>/samples/<sampleId>/raw/` before normalization.
- Parse partially written JSONL safely and wait for the completed root Agent span before treating the trace as complete.
- Validate every external file and cap file size, line length, event count and screenshot dimensions.
- Keep raw evidence immutable; derived summaries live separately.
- Screenshot or hierarchy collection failure does not erase valid trace evidence, but required assertions may fail as `EVIDENCE_MISSING`.

## Success criteria

- Tool sequence, final result, duration and Token totals match representative existing DouPao traces.
- Evidence from adjacent samples cannot be cross-associated even when file timestamps overlap.


# Spec: `assertion-engine`

## Purpose

Evaluate deterministic, reproducible conditions without an LLM.

## First-version assertions

- `outcome`: equals an allowed terminal Agent outcome.
- `finalResponse`: contains, excludes or matches a validated regular expression.
- `toolCalled`: requires or forbids a normalized tool name and optionally bounds its count.
- `duration`: bounds total sample duration.
- `steps`: bounds Agent step count.
- `tokens`: bounds prompt, completion or total Token usage.
- `foregroundPackage`: equals an Android package name.
- `uiText`: final hierarchy contains, excludes or matches a regular expression.

## Result contract

Every assertion returns its id/type, `PASS`, `FAIL` or `ERROR`, a concise reason and evidence pointers. Missing evidence is `ERROR`, not a guessed pass/fail.

## Success criteria

- Assertion order is stable and all assertions run even after one fails.
- Regex evaluation is bounded against pathological expressions.
- Results are deterministic for the same evidence bundle.


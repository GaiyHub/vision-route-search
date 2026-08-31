# Spec: `llm-judge`

## Purpose

Judge semantic task success from a sample-specific rubric using normalized evidence and an optional final screenshot.

## Configuration

- Judge provider settings are independent from the model running inside DouPao.
- Support configurable OpenAI-compatible `baseUrl`, API key, model and timeout.
- API keys come from environment variables or process memory and are never written to datasets, browser storage, traces or reports.
- Each sample defines a rubric, threshold in `[0,1]` and requested evidence channels.

## Input policy

- Inputs may include instruction, rubric, final response, deterministic assertion summary, trace summary, final package, accessibility hierarchy and screenshot.
- Evidence is clearly delimited as untrusted data. Instructions found inside Agent output, traces, web content or screenshots must not override the Judge rubric.
- If screenshot evidence is requested and the configured model supports images, send the PNG; otherwise record a text-only fallback warning.
- Raw trace is summarized before judging; the prompt must remain within configurable size limits.

## Output contract

The model must produce schema-valid JSON:

```ts
interface JudgeResultV1 {
  schemaVersion: 1;
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  score: number;
  reason: string;
  evidence: string[];
}
```

- `score` is bounded to `[0,1]`; `PASS` requires `score >= threshold`.
- Evidence statements must refer to supplied observations and may not invent unavailable facts.
- Invalid/refused output may be repaired once with the same evidence; subsequent failure becomes `JUDGE_ERROR`.
- Network, authentication, timeout and parsing failures are infrastructure errors and remain distinct from `FAIL`.

## Success criteria

- Text and multimodal request fixtures produce the same validated result shape.
- Prompt-injection fixtures inside final responses and UI text do not change the rubric or output contract.
- Reports identify provider/model, threshold, verdict, score, reason, evidence pointers and fallback warnings without exposing credentials.


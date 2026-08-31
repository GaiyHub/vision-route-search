# Spec: PC Batch Evaluation for DouPao

## Objective

Build a local PC WebUI that evaluates DouPao on a real Android device. A user can define a dataset, select an ADB device, start a run, observe sample progress, inspect intermediate Agent evidence and obtain an HTML/JSON report. Each sample is evaluated with deterministic assertions and, when configured, an LLM-as-Judge rubric.

The system is intended for repeatable engineering evaluation, not remote device administration or production end-user automation.

## User stories

1. As a DouPao developer, I can create or import a versioned dataset containing instructions, setup rules, assertions and judge rubrics.
2. As a DouPao developer, I can select one authorized Android device and run all enabled samples sequentially.
3. As a DouPao developer, I can see which sample is pending, running, blocked, failed or passed without reading raw logcat output.
4. As a DouPao developer, I can inspect the final response, UI evidence, tool trace, timing and token usage for each sample.
5. As a DouPao developer, I can use an independently configured text or multimodal model to judge semantic task success.
6. As a DouPao developer, I can distinguish product failures from device, bridge and judge infrastructure errors.
7. As a DouPao developer, I can export and reopen a self-contained report and rerun only failed samples.

## Tech stack

- Existing DouPao app: React Native, TypeScript, Kotlin and Android native modules.
- New PC application under `evaluator/`: Node.js 20+, TypeScript, React and Vite.
- Local backend: TypeScript HTTP service bound to `127.0.0.1`; SSE for run progress.
- Validation and persistence: schema-validated YAML/JSON plus local files; no database.
- Device integration: the installed Android SDK `adb` executable, invoked without a shell.
- Judge integration: configurable OpenAI-compatible chat-completions or responses-style adapter using `fetch`; text is mandatory and image input is capability-dependent.
- Tests: Jest/Vitest-compatible unit tests for pure modules, backend integration tests with a fake ADB process, and focused Android/React Native tests for the evaluation bridge.

Exact dependency versions must be pinned by the generated lockfile during implementation.

## Commands

Planned PC commands:

```bash
cd evaluator
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Existing DouPao verification commands:

```bash
cd guidedog-agent
npm run typecheck
npm test -- --runInBand --forceExit

cd android
NODE_ENV=production ./gradlew :app:assembleRelease
```

The implementation plan must add a documented command for assembling the evaluation-enabled APK variant.

## Project structure

```text
evaluator/
├── datasets/                 # User-owned YAML/JSON evaluation sets
├── src/
│   ├── contracts/            # Shared schemas and discriminated unions
│   ├── server/               # Local HTTP/SSE API
│   ├── adb/                  # Process adapter and DouPao bridge client
│   ├── evidence/             # Trace/UI/screenshot normalization
│   ├── assertions/           # Deterministic assertion engine
│   ├── judge/                # LLM provider and structured judging
│   ├── orchestrator/         # Run and sample state machines
│   ├── reports/              # JSON and HTML report generation
│   └── web/                  # React WebUI
├── tests/
└── .data/runs/               # Generated run artifacts; git-ignored

guidedog-agent/
├── src/evaluation/           # RN evaluation request/status adapter
├── plugins/android/          # Evaluation-build-only native entry
└── android/                  # Evaluation build configuration
```

## Code style

- TypeScript remains strict; avoid `any` and unsafe assertions.
- Validate all dataset, HTTP, ADB status-file and judge-response inputs at their boundaries.
- Represent lifecycle variants with discriminated unions rather than boolean combinations.
- Inject process, clock, filesystem and judge adapters so orchestration can be tested without a device or network.
- Never construct ADB commands as shell strings.

Example:

```ts
type SampleState =
  | { type: 'PENDING' }
  | { type: 'RUNNING'; startedAt: string }
  | { type: 'PASSED'; finishedAt: string; score?: number }
  | { type: 'FAILED'; finishedAt: string; reason: string }
  | { type: 'BLOCKED'; finishedAt: string; reason: string }
  | { type: 'INFRA_ERROR'; finishedAt: string; code: string };
```

## Testing strategy

- Contract tests validate every dataset, bridge status, report and judge schema.
- Unit tests cover assertion semantics, status transitions, aggregation and retry classification.
- Fake-ADB integration tests cover device absence, multiple devices, timeout, duplicate `runId`, malformed files, cancellation and partial trace writes.
- Judge tests use a fake HTTP server and fixtures for valid, invalid, refused, timed-out and multimodal responses.
- Android tests verify that production builds ignore evaluation actions, evaluation builds enforce one active run, and status/result files are written atomically.
- A real-device acceptance test runs at least one deterministic question sample and one GUI-operation sample, then verifies the generated report.

## Boundaries

### Always

- Bind the WebUI backend to localhost by default.
- Require an explicitly selected ADB serial for every run.
- Correlate all commands, statuses, evidence and reports with immutable `runId` and `sampleId` values.
- Preserve raw evidence alongside normalized summaries.
- Distinguish assertion failures, judge failures and infrastructure errors.
- Keep API keys out of datasets, traces, reports and source control.

### Ask first

- Clearing a third-party app's data.
- Adding arbitrary host-shell or Android-shell execution to dataset setup steps.
- Enabling the evaluation bridge in a production-distributed build.
- Automatically approving a high-risk DouPao operation.
- Sending additional sensitive screen evidence to a remote Judge provider.

### Never

- Simulate chat-box coordinates as the primary instruction transport.
- Automatically approve risk gates, `ask_user` or manual-action requests.
- Interpret a Judge transport/parsing failure as a product assertion failure.
- Store Judge API keys in run artifacts or browser local storage.
- Execute dataset-provided strings through a host shell.

## Shared execution semantics

- One device executes one sample at a time.
- Samples are independent by default: DouPao conversation state is reset while model and permission settings remain intact.
- The evaluation mode automatically accepts DouPao's completion verdict so a batch does not wait at the ordinary completion confirmation gate.
- Risk confirmation, `ask_user` and manual-action requests terminate the sample as `BLOCKED` unless a future spec adds explicit response fixtures.
- The orchestrator continues after `FAILED`, `BLOCKED` and `INFRA_ERROR` samples unless the whole run is cancelled or the selected device becomes unavailable.
- A sample is `PASSED` only when every required deterministic assertion passes and the enabled Judge returns `PASS` at or above its threshold.

## Success criteria

- A valid dataset can be created/imported and rejected with actionable field-level errors when invalid.
- The WebUI lists authorized ADB devices and requires explicit selection.
- Clicking Run executes every enabled sample exactly once and displays live progress.
- Every sample produces a terminal state without indefinitely blocking the batch.
- Existing OTel trace data and final UI evidence are associated with the correct sample.
- Deterministic assertions and LLM Judge results are shown independently.
- Multimodal Judge requests include the final screenshot when supported and safely fall back to text evidence otherwise.
- `report.json` and self-contained `report.html` are generated after the run and can be reopened without the server.
- Unit/integration tests pass and a real-device smoke evaluation produces a readable report.

## Open questions

No blocking product questions remain for the first implementation plan. Exact dependency versions and Android evaluation build mechanics may be refined during planning without weakening the contracts in the module specs.


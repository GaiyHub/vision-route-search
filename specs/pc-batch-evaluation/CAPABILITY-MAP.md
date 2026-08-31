# Capability Map: PC Batch Evaluation

| Module id | Responsibility | Depends on |
| --- | --- | --- |
| `eval-dataset` | Define, validate, import and persist evaluation datasets and samples. | — |
| `doupao-eval-bridge` | Expose an evaluation-build-only ADB contract for submitting one instruction and observing its lifecycle. | — |
| `adb-runner` | Discover a selected Android device and drive one isolated sample through the bridge. | `doupao-eval-bridge` |
| `evidence-collector` | Pull and normalize the result, OTel trace, final UI hierarchy and screenshot. | `adb-runner` |
| `assertion-engine` | Evaluate deterministic assertions against normalized evidence. | `eval-dataset`, `evidence-collector` |
| `llm-judge` | Evaluate a sample rubric using text and optional image evidence through a configurable model. | `eval-dataset`, `evidence-collector` |
| `eval-orchestrator` | Run samples sequentially, isolate state, handle timeout/cancellation and aggregate results. | `adb-runner`, `assertion-engine`, `llm-judge` |
| `eval-console` | Provide the local WebUI and HTTP/SSE API for configuration, execution and inspection. | `eval-dataset`, `eval-orchestrator` |
| `eval-report` | Persist raw artifacts and render machine-readable and human-readable reports. | `eval-orchestrator` |

Build order:

```text
eval-dataset + doupao-eval-bridge
→ adb-runner
→ evidence-collector
→ assertion-engine + llm-judge
→ eval-orchestrator
→ eval-console + eval-report
```

Rules:

- Module ids are stable and must be used by plans and tasks.
- Dependencies point only in the direction shown above; no module may call back into a consumer.
- Shared contracts live in the provider module's spec.
- The evaluation bridge is absent or inert in normal production builds.


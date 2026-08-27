## 1. Rollout switch and contracts

- [ ] 1.1 Add the persisted `guiSubagentEnabled` setting with a false migration default and a user-facing experimental toggle.
- [ ] 1.2 Define provider-neutral GUI action, terminal result, progress, failure, side-effect and fallback types.
- [ ] 1.3 Add unit tests proving disabled mode omits the delegation registration and performs zero client construction, credential reads, lease acquisition and network requests.
- [ ] 1.4 Add runtime kill-switch tests for disabling before the first action and after an attempted side effect.

## 2. Tongyi GUI protocol adapter

- [ ] 2.1 Implement a `TongyiGuiClient` boundary for the selected Bailian endpoint, model configuration, screenshot request and abort propagation without logging credentials or request content.
- [ ] 2.2 Implement strict parsing for the supported GUI action and terminal-response formats, rejecting unknown or malformed actions without execution.
- [ ] 2.3 Map authentication, availability, rate-limit, timeout, cancellation and protocol errors to stable internal error codes.
- [ ] 2.4 Add fixture-based adapter tests for valid actions, completion, malformed responses, provider failures and cancellation.

## 3. Isolated GUI subagent loop

- [ ] 3.1 Implement `TongyiUiSubagent` with isolated prompt/history, screenshot-observe/action loop, configurable default step limit and hard upper bound.
- [ ] 3.2 Implement the narrow `GuiActionExecutor` over existing screenshot and Android accessibility-control operations without exposing main-Agent tools or state.
- [ ] 3.3 Add a single-owner foreground-device lease with deterministic release on every terminal path and a stable busy result.
- [ ] 3.4 Integrate existing sensitive-action confirmation before guarded GUI actions and ensure rejection/timeout executes no guarded action.
- [ ] 3.5 Track `sideEffectsStarted`, last safe observation and fallback eligibility at every action boundary.
- [ ] 3.6 Add fake-client/fake-executor tests for completion, max steps, unsupported action, lease contention, confirmation rejection, timeout and cancellation.

## 4. Minimal main-Agent integration

- [ ] 4.1 Define `delegate_ui_task` as a host-owned extra tool with bounded arguments and canonical structured ToolResult output.
- [ ] 4.2 In `agentBridge`, inject the tool only when the task-start snapshot has `guiSubagentEnabled=true`; leave all existing PhoneTools available in both modes.
- [ ] 4.3 Add the minimal explicit long-running-tool execution policy so delegation can use a minutes-scale wall-clock limit while ordinary tool and user-decision timeout behavior remains unchanged.
- [ ] 4.4 Propagate the main task AbortSignal and runtime switch changes into the active subagent and return control to the waiting main Agent on cancellation.
- [ ] 4.5 Add AgentLoop/bridge tests proving synchronous waiting, no concurrent main-Agent dispatch, result delivery on the next turn and direct-tool continuation after a recoverable pre-action failure.
- [ ] 4.6 Add regression tests proving switch-off prompts, tool sets, provider selection and direct GUI execution match the pre-change path.

## 5. Progress, telemetry and validation

- [ ] 5.1 Bridge privacy-safe subagent progress to the existing execution store and foreground service without inserting subagent reasoning into main-Agent history.
- [ ] 5.2 Emit one terminal rollout event per invocation with offered/selected outcome, duration, steps, stable error code, side-effect flag and fallback eligibility.
- [ ] 5.3 Add log-redaction tests covering API keys, entered text, delegated intent, raw screenshots and hidden model reasoning.
- [ ] 5.4 Run type checking and the relevant settings, provider, AgentLoop, ToolResult, cancellation and host integration test suites.
- [ ] 5.5 On a test device, validate disabled hard short circuit, enabled successful delegation, Stop, runtime kill switch, pre-action degradation and post-action no-replay behavior.
- [ ] 5.6 Document the experiment enable/disable procedure, required secure model configuration, known limitations and rollback steps before widening the test cohort.

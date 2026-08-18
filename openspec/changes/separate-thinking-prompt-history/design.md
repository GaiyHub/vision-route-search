## Context

`AgentLoop` currently uses one `AgentEvent[]` both as an observable execution stream and as the source for subsequent chat messages. When a model emits text before a tool call, the loop creates a `thinking` event for the UI and logs, then `buildHistoryRounds` copies that text into the next assistant message alongside the durable action record.

The action record already contains the tool name, arguments, result, loop metadata, and the following observation. Raw thinking is therefore redundant as task state and can preserve guesses that later observations disproved.

## Goals / Non-Goals

**Goals:**

- Keep thinking visible to the user and available to callbacks, logs, and metrics.
- Prevent raw thinking from being submitted as assistant history on later LLM calls.
- Preserve complete action/result/observation continuity.
- Extract thinking correctly when it contains braces before an XML tool call.
- Reduce input tokens without changing tool execution semantics.

**Non-Goals:**

- Disable model-side thinking generation.
- Remove thinking events from stored task diagnostics.
- Change the user-configured history-round limit or silently reinterpret its persisted value.
- Summarize chain-of-thought through another LLM call.

## Decisions

### Keep one event stream but create a prompt-safe projection

The runtime will continue appending and yielding `thinking` events. `buildHistoryRounds`, which is the boundary that converts runtime events into LLM messages, will ignore their content. This is the smallest separation point and preserves every existing UI/log subscriber.

Creating a second mutable history collection was rejected because it could drift from execution history. Truncating thinking was rejected because even short speculative text remains redundant and potentially misleading.

### Use action records as durable assistant history

Assistant history will contain formatted tool calls and results. User history will continue to contain observation summaries and loaded skill bodies. Todo state and the current screen remain in the latest user turn. These fields describe what actually happened rather than what the model predicted would happen.

### Identify explicit tool boundaries before generic JSON boundaries

Thinking extraction will first locate `<tool_call>` and fenced tool payload boundaries. Only bare-JSON output will use the brace fallback. Optional outer `<think>` tags will be removed from the displayed thinking content. This preserves braces used naturally inside reasoning while keeping current compatibility with loose JSON responses.

### Preserve configured history limits

The existing `maxHistoryItems` option remains unchanged. Removing thinking addresses the requested token and bias issue without turning an existing `0` value from “unlimited” into a different behavior. A separate migration can change defaults if desired later.

## Risks / Trade-offs

- [A later decision could benefit from a valid prior rationale] → The exact action, result, observation, task goal, and todo state remain; durable facts are preferred over unverifiable rationale.
- [Nonstandard tool wrappers may not be recognized by extraction] → Retain the existing bare-JSON fallback after checking supported XML and fenced formats.
- [Tests or UI consumers expect literal `<think>` tags] → Preserve the thinking event and content while normalizing only the wrapper tags, with regression coverage.

## Migration Plan

No persisted data migration is required. Existing stored task logs remain readable. The change affects only messages constructed for inference after deployment and can be rolled back by restoring thinking concatenation in `buildHistoryRounds`.

## Open Questions

None.

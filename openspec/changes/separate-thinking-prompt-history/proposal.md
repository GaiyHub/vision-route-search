## Why

Raw model thinking is currently retained as assistant history and resent on later inference calls. This increases prompt tokens and lets speculative or stale reasoning bias subsequent decisions even though the action, tool result, and observation already provide the durable task state.

## What Changes

- Keep thinking events available for live UI, task logs, metrics, and debugging.
- Exclude raw thinking text from the conversation history submitted to later LLM requests.
- Preserve tool calls, structured tool results, observations, and task progress as decision history.
- Make thinking extraction tool-tag aware instead of truncating at the first JSON-looking brace anywhere in the response.
- Add regression tests proving display/log behavior remains while prompt history is compact.

## Capabilities

### New Capabilities

- `agent-prompt-history`: Defines the separation between observable model thinking and durable decision context sent to subsequent inference calls.

### Modified Capabilities

None.

## Impact

- `guidedog-agent/src/device-agent/agent/AgentLoop.ts`
- Agent-loop history and completion-gate tests
- LLM input token usage and prompt-cache stability

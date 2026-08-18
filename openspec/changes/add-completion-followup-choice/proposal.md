## Why

The current completion gate does not clearly distinguish immediate continuation from continuation that requires new user context. Users need an explicit way to reject completion, optionally add missing information, and resume the same task without that draft being mistaken for a completed result.

## What Changes

- Present three choices in the task-completion dialog: 完成, 继续, and 补充信息.
- Treat both 继续 and 补充信息 as a rejection of the model's completion verdict.
- Continue immediately with a fixed correction when 继续 is selected.
- Keep the completion gate pending when 补充信息 is selected, require non-empty user text, and continue only after submission.
- Preserve safe timeout, cancellation, notification, and app-return behavior across both dialog phases.

## Capabilities

### New Capabilities

- `completion-followup-choice`: Defines the three-way completion decision and supplemental-context submission behavior.

### Modified Capabilities

None.

## Impact

- Completion gate state and resolution in `src/store/agentStore.ts` and `src/agent/agentBridge.ts`.
- Completion confirmation UI in `app/chat/ChatScreen.tsx`.
- Completion notification/overlay fallback semantics and related tests.

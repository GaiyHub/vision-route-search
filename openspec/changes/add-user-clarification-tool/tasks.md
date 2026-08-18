## 1. Clarification state and tool

- [x] 1.1 Implement a single-pending clarification store with subscribe, submit, validation, and cancel behavior
- [x] 1.2 Define and register the always-available `ask_user` host tool and return submitted answers as structured tool results
- [x] 1.3 Capture the operated app, bring豆泡 forward for the gate, and return to the operated app after submission

## 2. Agent runtime policy

- [x] 2.1 Classify `ask_user` as a timeout-exempt, screen-observation-free user gate
- [x] 2.2 Exempt `ask_user` from the repetition circuit breaker and lock its enable/UI-effect configuration
- [x] 2.3 Cancel pending clarification when the user stops the task
- [x] 2.4 Update the system prompt to route necessary ambiguity to `ask_user` while preserving direct informational replies and `confirm_action` authorization
- [x] 2.5 Replace the goal-level action enumeration with a capability-level external-access and delegated-action boundary

## 3. User interface

- [x] 3.1 Add a chat-screen clarification modal showing the question and optional placeholder
- [x] 3.2 Enforce non-empty, 2000-character input and submit the answer without creating a new task
- [x] 3.3 Keep the protocol tool visible but non-configurable in the tools settings list

## 4. Verification

- [x] 4.1 Add store and tool registration/result tests
- [x] 4.2 Extend user-decision, abort, UI-effect, configuration, and circuit-breaker tests for `ask_user`
- [x] 4.3 Run focused tests and TypeScript checking
- [x] 4.4 Build and install the Android release APK for device verification

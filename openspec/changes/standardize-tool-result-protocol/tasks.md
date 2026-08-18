## 1. Canonical result contract

- [x] 1.1 Replace the open ToolResult interface with canonical success/failure types and shared constructors/read helpers
- [x] 1.2 Make ToolRegistry normalize plain values, legacy wrappers, false returns, and thrown values without losing business fields
- [x] 1.3 Route disabled, missing-handler, timeout, cancellation, and circuit-breaker failures through stable error codes

## 2. Tool-result history semantics

- [x] 2.1 Assign stable task-scoped call ids and keep assistant history limited to tool-use records
- [x] 2.2 Render normalized results first in the following user turn with explicit tool_use_id and is_error state
- [x] 2.3 Migrate ask_user, read_skill, todo, UI-effect, and loop detection consumers to the canonical shape
- [x] 2.4 Exclude attachments and sensitive payloads and apply deterministic result truncation

## 3. Verification and delivery

- [x] 3.1 Add normalization tests for success, legacy wrappers, exceptions, timeouts, cancellation, and failures
- [x] 3.2 Add history tests proving clarification answers and batched results reach the next LLM request in the correct trust role
- [x] 3.3 Run focused/full tests, type checking, OpenSpec validation, and diff checks
- [x] 3.4 Build and install the Android release APK

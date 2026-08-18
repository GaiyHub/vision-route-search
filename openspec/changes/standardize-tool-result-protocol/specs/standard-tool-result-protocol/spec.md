## ADDED Requirements

### Requirement: Tool results have one canonical runtime shape
The system SHALL normalize every tool handler return or exception at the registry boundary into either a successful result containing business output only in `data`, or a failed result containing a stable error code, message, retryability flag, and optional recovery hint. Unknown business fields MUST NOT remain at the result top level.

#### Scenario: Plain successful return
- **WHEN** a handler returns a string, boolean true, number, array, object, null, or undefined without a result wrapper
- **THEN** the registry returns `ok: true` and preserves that value in `data`

#### Scenario: Legacy successful wrapper
- **WHEN** a handler returns `{ ok: true }` with business fields such as `answer` or `content` but without `data`
- **THEN** the registry moves all business fields into `data` without loss

#### Scenario: Handler exception
- **WHEN** a handler throws an Error or unknown value
- **THEN** the registry returns `ok: false` with code `TOOL_EXECUTION_ERROR`, a safe message, and no stack trace

#### Scenario: Legacy failure wrapper
- **WHEN** a handler returns a legacy failure containing string `error`, optional `code`, optional `hint`, and additional diagnostic fields
- **THEN** the registry preserves the message, normalizes code and retryability, preserves the hint, and moves other diagnostics into `details`

### Requirement: Loop-generated failures use standard errors
The system SHALL represent disabled tools, missing handlers, timeouts, cancellations, rejected operations, and circuit-breaker blocks with the canonical failed result shape and stable machine-readable codes.

#### Scenario: Tool timeout
- **WHEN** a tool does not finish before its execution deadline
- **THEN** the model receives a failed result with code `TOOL_TIMEOUT`, retryability metadata, and the timeout message

#### Scenario: Tool is unavailable
- **WHEN** the model calls a disabled or unregistered tool
- **THEN** the model receives a canonical failure whose code distinguishes disabled from unregistered tools

### Requirement: Tool calls and results have separate trust roles
The system SHALL keep tool calls in assistant history and place each corresponding tool result in the immediately following user-side history before screen observations or other user text.

#### Scenario: Successful tool call
- **WHEN** a tool call succeeds
- **THEN** history contains a stable call identifier, an assistant-side tool-use record, and a user-side result with `is_error=false` and serialized `data`

#### Scenario: Failed tool call
- **WHEN** a tool call fails
- **THEN** its user-side result has `is_error=true` and includes the normalized error code, message, retryability, hint, and details as available

#### Scenario: Parallel or batched calls
- **WHEN** one model decision dispatches multiple tools
- **THEN** every call has exactly one result in dispatch order before the resulting screen observation

### Requirement: User clarification answers remain durable
The system SHALL preserve a submitted `ask_user` answer as tool-result data in every subsequent prompt until normal task-history compaction removes that round.

#### Scenario: Model continues after clarification
- **WHEN** the user submits an answer to `ask_user`
- **THEN** the next LLM request contains the exact answer and the model can continue without asking for the same supplied information again

### Requirement: Result serialization is bounded and safe
The system SHALL serialize tool results with deterministic truncation and MUST exclude binary observation payloads, stack traces, and unredacted sensitive fields from ordinary prompt history and logs.

#### Scenario: Tool returns an observation image
- **WHEN** a tool result contains an image used for the next vision inference
- **THEN** its base64 bytes are excluded from textual tool-result history while the vision transport remains available

#### Scenario: Oversized result
- **WHEN** serialized result content exceeds the configured result limit
- **THEN** the system includes a deterministic truncated representation with an explicit truncation marker

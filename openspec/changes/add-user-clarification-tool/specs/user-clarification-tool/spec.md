## ADDED Requirements

### Requirement: Model can request necessary clarification
The system SHALL expose an always-available `ask_user` tool that accepts one specific question and an optional input placeholder. Its model-facing description MUST direct the model to call it when information required to continue is missing or the target is materially ambiguous, and MUST discourage asking for information obtainable from context, the current screen, or other tools.

#### Scenario: Required information is missing
- **WHEN** the model cannot safely choose the next execution path without user information
- **THEN** it calls `ask_user` with a concrete question instead of guessing or ending the task with a plain-text question

#### Scenario: Information is independently obtainable
- **WHEN** the requested information can be obtained from current context, screen state, or another available tool
- **THEN** the model continues investigating without calling `ask_user`

### Requirement: Application collects a free-text answer
The system SHALL bring the host application to the foreground and show a modal containing the model's question and a multiline input. It MUST accept only a non-empty answer no longer than 2000 characters.

#### Scenario: User submits a valid answer
- **WHEN** the user enters a non-empty answer within the length limit and taps submit
- **THEN** the modal closes and the pending clarification resolves with that answer

#### Scenario: User enters an invalid answer
- **WHEN** the answer is blank or exceeds the length limit
- **THEN** submission remains blocked or a validation error is shown and the clarification remains pending

### Requirement: Answer returns to the same task context
The `ask_user` handler SHALL return the submitted text as a structured successful tool result, and the agent loop SHALL include that tool result in the next model request before continuing the original task.

#### Scenario: Agent resumes after clarification
- **WHEN** the user submits an answer to a pending `ask_user` invocation
- **THEN** the next model decision has access to the answer and continues the existing task rather than creating a new task

### Requirement: Clarification is a user gate
The system SHALL exempt `ask_user` from ordinary action timeouts, screen-change observation, and repetition circuit breaking while preserving task-abort behavior.

#### Scenario: User takes longer than normal action timeout
- **WHEN** a clarification remains unanswered for more than the ordinary tool action timeout
- **THEN** the gate remains pending and the agent does not fabricate an answer or time out the tool

#### Scenario: User stops the task
- **WHEN** the task is stopped while `ask_user` is pending
- **THEN** the modal closes, the pending request is cancelled, and the agent loop exits promptly

### Requirement: Clarification remains distinct from authorization
The system SHALL NOT treat an `ask_user` answer as permission for a high-risk action. High-risk actions MUST continue to use `confirm_action`.

#### Scenario: Question concerns a high-risk action
- **WHEN** the model needs both missing details and authorization for a high-risk action
- **THEN** it may use `ask_user` to obtain the details but still calls `confirm_action` before executing the action

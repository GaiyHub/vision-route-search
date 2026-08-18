## ADDED Requirements

### Requirement: Completion confirmation depends on actual external operations
The system SHALL display the task-completion confirmation only when the current task has dispatched at least one external operation. The decision MUST be derived from runtime tool-call history rather than model output format.

#### Scenario: Plain answer completes without confirmation
- **WHEN** the model returns a terminal plain-text answer and the task dispatched no external operation
- **THEN** the system finishes without publishing completion-pending state, notification, foreground transition, or confirmation dialog

#### Scenario: Tool-form completion without external operation
- **WHEN** the model calls `task_complete` after only read-only, waiting, or bookkeeping tools
- **THEN** the system accepts completion without displaying the completion confirmation

#### Scenario: User clarification requires confirmation
- **WHEN** the task dispatched `ask_user` and later reaches completion
- **THEN** the existing task-completion confirmation SHALL be displayed and SHALL await the user's decision

#### Scenario: Risk confirmation requires completion confirmation
- **WHEN** the task dispatched `confirm_action` and later reaches completion
- **THEN** the existing task-completion confirmation SHALL be displayed and SHALL await the user's decision

#### Scenario: External operation requires confirmation
- **WHEN** the task dispatched a phone UI mutation, browser interaction, or Shell execution before completion
- **THEN** the existing task-completion confirmation SHALL be displayed and SHALL await the user's decision

### Requirement: External-operation state is task-scoped and monotonic
The system SHALL initialize external-operation state to false for each new task, switch it to true upon dispatching an external operation, and never downgrade it within that task.

#### Scenario: Read-only action follows external operation
- **WHEN** an external operation is followed by read-only observations before completion
- **THEN** completion confirmation remains required

#### Scenario: New task after an operation task
- **WHEN** a new task starts after a previous task that performed external operations
- **THEN** the new task starts with completion confirmation not required until it performs its own external operation

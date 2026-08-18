## ADDED Requirements

### Requirement: Three-way completion decision
The primary task-completion dialog SHALL present 完成, 继续, and 补充信息 as separate choices whenever the model claims the task is complete.

#### Scenario: Confirm completion
- **WHEN** the user selects 完成
- **THEN** the completion gate SHALL settle as complete and the task SHALL end

#### Scenario: Continue immediately
- **WHEN** the user selects 继续
- **THEN** the completion verdict SHALL be treated as rejected and the same task SHALL resume immediately with a continuation correction

#### Scenario: Enter supplemental input
- **WHEN** the user selects 补充信息
- **THEN** the completion verdict SHALL be treated as not yet accepted and the system SHALL show a text-entry phase without resuming the agent

### Requirement: Supplemental information submission
The system SHALL resume the same task from the pending completion gate only after the user submits valid supplemental information.

#### Scenario: Submit valid information
- **WHEN** the user submits non-empty supplemental text within the length limit
- **THEN** the system SHALL inject the attributed user information into a continuation correction and resume the same task

#### Scenario: Reject empty information
- **WHEN** the supplemental text is empty or whitespace-only
- **THEN** the system SHALL keep the gate pending and SHALL NOT resume the agent

#### Scenario: Reject overlong information
- **WHEN** the supplemental text exceeds the configured length limit
- **THEN** the system SHALL show validation feedback, keep the gate pending, and SHALL NOT resume the agent

#### Scenario: Return to choices
- **WHEN** the user leaves the supplemental phase without submitting
- **THEN** the system SHALL return to the three completion choices and SHALL NOT resume the agent

### Requirement: Completion gate lifecycle safety
The completion gate SHALL remain single-settlement and SHALL preserve safe timeout and cancellation behavior across decision phases.

#### Scenario: Timeout while choosing
- **WHEN** the three-choice decision phase receives no answer before its timeout
- **THEN** the existing completion-timeout policy SHALL settle the gate once

#### Scenario: Compose without accidental timeout
- **WHEN** the user is in the supplemental text-entry phase
- **THEN** the decision timeout SHALL be suspended so the task is not marked complete while the user is composing

#### Scenario: Stop during supplemental input
- **WHEN** the task is stopped while supplemental input is pending
- **THEN** the system SHALL clear the pending dialog and release the completion gate without resuming the task

## ADDED Requirements

### Requirement: Task-scoped interaction classification
The system SHALL maintain one interaction classification for each active Agent task, initialized as `question_answer`, and SHALL upgrade it to `device_operation` after the task dispatches an external phone UI mutation.

#### Scenario: External UI action upgrades the task
- **WHEN** the task dispatches a canonical external UI operation such as tap, text input, gesture, app launch or system navigation
- **THEN** the task classification becomes `device_operation`

#### Scenario: Failed action still identifies an operation task
- **WHEN** an external UI operation is dispatched but its handler reports failure or no visible change
- **THEN** the task remains classified as `device_operation`

#### Scenario: Read-only answer remains question-answer
- **WHEN** a task completes using only plain model text, screen observation, element lookup, waiting, notes, Todo, skill or confirmation tools
- **THEN** the task classification remains `question_answer`

#### Scenario: Built-in browser remains host-contained
- **WHEN** a task invokes any supported `browser_use` action without invoking an external phone UI mutation
- **THEN** the task classification remains `question_answer`

#### Scenario: Classification is monotonic within a task
- **WHEN** a task has been classified as `device_operation` and later performs only read-only work or produces a text response
- **THEN** it remains `device_operation` until that task ends

#### Scenario: New task starts clean
- **WHEN** one task finishes, fails or is stopped and another task starts
- **THEN** the new task starts as `question_answer` with no classification or return target inherited from the previous task

### Requirement: Conditional routing after completion confirmation
After a completion confirmation is settled, the system MUST return a `device_operation` task to its external app target and MUST keep a `question_answer` task in the DouPao host app.

#### Scenario: Completed operation returns to the operated app
- **WHEN** a `device_operation` task's completion dialog is settled with “完成”
- **THEN** the system dismisses the completion state and attempts to restore the external app captured for that confirmation round

#### Scenario: Completed question stays in DouPao
- **WHEN** a `question_answer` task's completion dialog is settled with “完成”
- **THEN** the system dismisses the completion state without invoking an external-app return operation
- **AND** DouPao remains the intended foreground destination

#### Scenario: Continue operation returns before continuing
- **WHEN** the user selects “继续” or submits supplemental information for a `device_operation` task
- **THEN** the system attempts to restore the external operation target and allows the existing AgentLoop continuation path to proceed

#### Scenario: Continue answer stays before continuing
- **WHEN** the user selects “继续” or submits supplemental information for a `question_answer` task
- **THEN** the system does not invoke external-app return and allows the existing AgentLoop continuation path to proceed in DouPao

#### Scenario: Timeout follows the same routing policy
- **WHEN** the completion gate reaches its existing timeout and defaults to complete
- **THEN** the system applies the same interaction-classification routing used for an explicit completion decision

#### Scenario: Later operation changes a subsequent confirmation route
- **WHEN** a question-answer completion continues, the task then dispatches an external UI mutation, and a later completion verdict is raised
- **THEN** the later confirmation round routes as `device_operation`

### Requirement: Three-option completion decision
The completion dialog MUST present “完成”, “继续” and “补充信息”. “继续” and submitted supplemental information SHALL both resolve the existing completion gate as unfinished and continue the same Agent task.

#### Scenario: Complete accepts the verdict
- **WHEN** the user selects “完成”
- **THEN** the completion gate resolves as `complete` and follows the existing task-completion path

#### Scenario: Continue rejects the verdict without extra input
- **WHEN** the user selects “继续”
- **THEN** the completion gate resolves with a continuation message that preserves the model verdict and instructs the Agent to finish the remaining work

#### Scenario: Supplement opens an input phase
- **WHEN** the user selects “补充信息”
- **THEN** the dialog enters a multiline supplemental-input phase
- **AND** the completion gate remains pending, the Agent executes no further action, and no external-app routing occurs

#### Scenario: Valid supplement continues with user context
- **WHEN** the user enters 1 to 2000 non-whitespace characters and selects “提交并继续”
- **THEN** the trimmed text is included in the continuation message and the same Agent task resumes

#### Scenario: Empty supplement cannot submit
- **WHEN** the supplemental input is empty or contains only whitespace
- **THEN** “提交并继续” remains unavailable and the completion gate stays pending

#### Scenario: Oversized supplement cannot submit
- **WHEN** the supplemental input exceeds 2000 characters
- **THEN** the dialog shows the length constraint, does not submit the content and keeps the completion gate pending

#### Scenario: Return from supplement does not decide
- **WHEN** the user selects “返回” or presses Android Back from the supplemental-input phase
- **THEN** the dialog returns to the three-option decision phase without resolving the completion gate

#### Scenario: Draft is task-local and ephemeral
- **WHEN** the pending completion ends, changes to a new verdict or the task is stopped
- **THEN** the supplemental draft is cleared and is not written to notifications, diagnostic logs or persistent settings

### Requirement: Supplemental-input timeout safety
The system MUST prevent the existing automatic-completion timeout from settling a gate while the user is in the supplemental-input phase.

#### Scenario: Entering supplement invalidates active timers
- **WHEN** the user enters the supplemental-input phase before the 60-second decision timeout fires
- **THEN** all timer completions belonging to the previous decision generation are ignored

#### Scenario: Supplement does not auto-continue
- **WHEN** the user remains in the supplemental-input phase without submitting
- **THEN** the Agent remains paused and the system neither completes nor continues the task automatically

#### Scenario: Returning restarts decision timeout
- **WHEN** the user returns from supplemental input to the three-option decision phase
- **THEN** the system starts a new 60-second decision timeout whose expiry defaults to “完成”

#### Scenario: Submission settles once
- **WHEN** valid supplemental information is submitted while stale JS or freeze-safe timers also complete
- **THEN** the gate resolves exactly once with the supplemental continuation message

### Requirement: Safe external target selection
For a `device_operation` task, the system MUST select the return target independently for each completion-confirmation round and MUST treat external-app restoration as best-effort.

#### Scenario: Current external app is preferred
- **WHEN** an external foreground package is available immediately before DouPao is brought forward for confirmation
- **THEN** that package is used as the return target for the current confirmation round

#### Scenario: Recent external app is the fallback
- **WHEN** the current external foreground package is unavailable for a `device_operation` confirmation
- **THEN** the system uses the accessibility controller's most recently recorded external app when it is non-empty and is not DouPao

#### Scenario: No valid target does not block settlement
- **WHEN** neither a current nor recent valid external package can be resolved
- **THEN** the confirmation decision still resolves normally and the system remains in DouPao

#### Scenario: Return failure does not block task lifecycle
- **WHEN** restoring the selected external app fails, throws or is unavailable
- **THEN** confirmation settlement, task continuation and task teardown proceed without waiting for recovery

#### Scenario: Repeated confirmation recaptures the target
- **WHEN** the user rejects one completion verdict, the continuing task changes apps, and another completion verdict appears
- **THEN** the second confirmation round captures its own current target instead of reusing the first target

### Requirement: Completion routing preserves existing confirmation behavior
The system SHALL preserve the completion Modal, fallback notification, decision-phase 60-second timeout and AgentLoop completion-gate contract while extending the Modal with the three-option interaction.

#### Scenario: Confirmation remains visible before routing
- **WHEN** a completion verdict is raised
- **THEN** DouPao is brought forward and the completion confirmation remains available until the user decides or the timeout settles it
- **AND** external-app routing does not occur merely because the dialog was displayed

#### Scenario: Notification and Modal share routing
- **WHEN** the completion decision arrives from either the in-app Modal or the system notification
- **THEN** both entry points use the same classification and target-routing policy

#### Scenario: Notification remains a two-action fallback
- **WHEN** the completion confirmation is surfaced through the system notification
- **THEN** it provides direct “完成” and “继续” actions and opens DouPao for users who need the dialog's supplemental-input option

#### Scenario: Risk confirmation is unaffected
- **WHEN** the model invokes `confirm_action`
- **THEN** its existing risk-confirmation return behavior is unchanged by completion-return classification

### Requirement: Behavioral and device validation
The implementation MUST be validated with automated host-policy tests and Android ADB testing before the change is considered complete.

#### Scenario: Automated routing verification
- **WHEN** tests settle completion gates through complete, continue, supplemental submission and timeout for tasks with external operation actions, read-only actions, plain text and `browser_use`
- **THEN** they verify the external return API is called only for operation tasks and that task state resets between runs

#### Scenario: ADB operation verification
- **WHEN** a safe operation task completes against a non-sensitive external app and the user confirms completion
- **THEN** the device returns from the DouPao confirmation dialog to that external app

#### Scenario: ADB question-answer verification
- **WHEN** a question-answer task completes and the user confirms completion
- **THEN** the device remains in DouPao and shows the final answer without switching to the previously used external app

#### Scenario: ADB supplemental continuation verification
- **WHEN** the user opens supplemental input, submits additional instructions and the task resumes
- **THEN** the Agent receives the supplemental text, continues the same task and applies the interaction-classification routing after the next completion verdict

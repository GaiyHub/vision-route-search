## ADDED Requirements

### Requirement: Task-scoped circuit breaker state
The system SHALL maintain an independent, fixed-size tool-loop history for each running Agent task and SHALL reset that history when a new task starts or the current task ends.

#### Scenario: New task starts clean
- **WHEN** a task finishes or is stopped and a new task starts
- **THEN** no warning or block decision from the previous task affects the new task

#### Scenario: Long task has bounded state
- **WHEN** a task executes more tool calls than the configured history capacity
- **THEN** the system retains only the most recent records required by the sliding window

### Requirement: Equivalent action normalization
The system MUST normalize tool names and arguments before comparing actions, including stable object-key ordering, removal of display-only fields, supported tool-alias mapping, and tool-specific normalization for coordinates, gestures and wait durations.

#### Scenario: Display title does not bypass detection
- **WHEN** the model repeats the same logical tool call while changing only its display title or call identifier
- **THEN** the calls are treated as the same equivalent action

#### Scenario: Nearby coordinates are equivalent
- **WHEN** the model repeats taps within the configured coordinate neighborhood on the same logical target
- **THEN** the taps contribute to the same no-progress sequence

#### Scenario: Different targets remain distinct
- **WHEN** two calls target different nodeIds or clearly different screen regions
- **THEN** the calls do not share a no-progress sequence

#### Scenario: Increased wait is a recovery strategy
- **WHEN** a later wait call moves into a meaningfully longer duration bucket
- **THEN** the system treats it as distinct from repeated short waits

### Requirement: UI-aware progress detection
The system SHALL determine progress using the tool result together with the stable pre-action and post-action UI observations, including accessibility-tree structure and foreground application/window identity. Screenshot sameness MAY strengthen a no-progress decision but screenshot difference alone MUST NOT prove progress.

#### Scenario: Successful tool with unchanged UI is no progress
- **WHEN** a screen-changing tool reports success but its stable pre-action and post-action UI observations are equivalent
- **THEN** the system records the call as no progress

#### Scenario: Repeated scroll changes content
- **WHEN** repeated scroll calls use equivalent arguments and each call changes the stable visible UI content
- **THEN** the system records progress and does not accumulate a no-progress sequence

#### Scenario: Scroll reaches the end
- **WHEN** repeated scroll calls stop changing stable visible UI content
- **THEN** the system starts accumulating a no-progress sequence for that scroll action

#### Scenario: Animation is not sufficient progress
- **WHEN** only volatile visual content such as a cursor, clock, video frame or animation changes
- **THEN** the system does not treat that visual change alone as task progress

#### Scenario: Foreground application changes
- **WHEN** an open-app or navigation action changes the foreground application or active window
- **THEN** the system records progress even if the tool result shape is unchanged

### Requirement: Per-tool threshold policies
The system MUST resolve an independent warning and block threshold for each canonical managed tool. Action-family thresholds SHALL provide defaults only, and a valid per-tool user override SHALL take precedence for that tool without changing any other tool.

#### Scenario: Click warning and block
- **WHEN** the same equivalent click/navigation action repeatedly produces no progress
- **THEN** the system warns after 2 no-progress records and blocks a subsequent execution after 4 no-progress records

#### Scenario: Input blocks earlier
- **WHEN** the same equivalent input action repeatedly produces no progress
- **THEN** the system warns after 2 no-progress records and blocks a subsequent execution after 3 no-progress records

#### Scenario: Scroll receives wider allowance
- **WHEN** the same equivalent scroll/gesture action repeatedly produces no progress
- **THEN** the system warns after 3 no-progress records and blocks a subsequent execution after 5 no-progress records

#### Scenario: Wait receives the widest allowance
- **WHEN** the same equivalent wait action repeatedly produces no progress
- **THEN** the system warns after 4 no-progress records and blocks a subsequent execution after 8 no-progress records

#### Scenario: Observation does not hard-block
- **WHEN** the model observes an unchanged screen 5 times without an intervening progress action
- **THEN** the system warns the model to choose a progress action or end the task and does not hard-block observation

#### Scenario: One tool override is isolated
- **WHEN** the user changes `tap` to warning 1 and block 2 while leaving `scroll` unchanged
- **THEN** new tasks use 1/2 for `tap` and retain the default scroll thresholds

#### Scenario: Alias uses canonical configuration
- **WHEN** a supported alias such as `click` resolves to canonical tool `tap`
- **THEN** the call uses the `tap` thresholds and no separate alias setting or counter is created

#### Scenario: Invalid persisted override is rejected
- **WHEN** a persisted tool override is non-integer, outside the history capacity, or has warning greater than or equal to block
- **THEN** the resolver ignores that tool's invalid override, uses its default thresholds, and leaves valid overrides for other tools intact

#### Scenario: New tool receives a default
- **WHEN** an application update registers a managed tool absent from existing persisted settings
- **THEN** the tool receives its action-family default without requiring a settings migration entry

### Requirement: Dedicated tool settings tab
The settings screen SHALL provide an independent `工具` tab backed by the shared canonical tool-policy catalog and SHALL allow users to inspect and edit warning and block thresholds for each managed tool independently.

#### Scenario: Tool tab lists canonical tools
- **WHEN** the user opens Settings and selects `工具`
- **THEN** the screen groups every registered canonical tool by action category and shows its display name, canonical name and effective circuit-breaker policy

#### Scenario: Managed tool thresholds can be edited
- **WHEN** the user changes a managed tool's warning or block stepper
- **THEN** the UI maintains `1 <= warning < block <= historySize`, persists only that tool's override, and shows the resulting effective values

#### Scenario: Inactive preset tool remains configurable
- **WHEN** the current tool preset does not expose a registered tool
- **THEN** the tool remains visible and configurable with a `当前预设未启用` status

#### Scenario: Exempt tool remains safe
- **WHEN** the tool catalog marks confirmation, bookkeeping or task termination as exempt
- **THEN** the Tools tab shows its non-breaking status and does not offer controls that could enable blocking

#### Scenario: Restore one tool default
- **WHEN** the user restores one tool to default
- **THEN** only that tool's stored override is removed and all other tool overrides remain unchanged

#### Scenario: Restore all tool defaults
- **WHEN** the user chooses to restore all circuit-breaker defaults
- **THEN** all per-tool overrides are removed without resetting unrelated settings

#### Scenario: Configuration applies to the next task
- **WHEN** the user edits a threshold while an Agent task is running
- **THEN** the active task retains its start-time policy snapshot and the next task uses the new persisted value

#### Scenario: Settings survive restart
- **WHEN** the application restarts after valid per-tool thresholds are saved
- **THEN** the Tools tab and newly started tasks use the same effective thresholds

### Requirement: Warning guidance and throttling
The system SHALL inject a concise recovery warning when an equivalent action crosses its warning threshold and SHALL NOT repeat the same warning on every subsequent turn.

#### Scenario: First threshold crossing warns once
- **WHEN** an action first reaches its warning threshold
- **THEN** the next model decision receives one warning containing the action summary, count and bounded recovery choices

#### Scenario: Warning is not repeated every turn
- **WHEN** the same no-progress sequence continues without crossing a new warning bucket
- **THEN** the system does not inject another identical warning

#### Scenario: Warning offers viable recovery
- **WHEN** a UI action warning is generated
- **THEN** it suggests applicable alternatives such as refreshing the screen, switching node/coordinate strategy, handling an overlay, navigating back, reopening the app or reporting failure

### Requirement: Pre-execution action blocking
The system MUST check the circuit breaker before invoking a managed tool and MUST skip the underlying tool call when the equivalent action has reached its block threshold.

#### Scenario: Blocked action is not executed
- **WHEN** an equivalent action has accumulated the configured number of no-progress records and the model requests it again
- **THEN** the underlying AccessibilityController or tool handler is not invoked

#### Scenario: Structured block result
- **WHEN** an action is blocked
- **THEN** the model receives a normal tool-failure result with `ok: false`, stable error code `LOOP_BLOCKED`, the no-progress count, an action summary and recovery directions

#### Scenario: Block does not end task
- **WHEN** a tool call returns `LOOP_BLOCKED`
- **THEN** the Agent task remains active and the model can choose a different tool or call `task_failed`

#### Scenario: Alternative action can recover
- **WHEN** the model responds to a block by selecting a different action that changes the UI
- **THEN** the task continues normally and the new action is not blocked by the previous action's sequence

### Requirement: Exempt and read-only tools
The system MUST exempt user-decision, task-completion, task-failure and task-list bookkeeping tools from UI action blocking. Read-only skill and observation tools MAY be recorded for context but MUST NOT be blocked as mutating UI actions.

#### Scenario: User confirmation remains available
- **WHEN** the task is waiting for a risk or completion decision
- **THEN** the confirmation tool is not warned or blocked by the UI circuit breaker

#### Scenario: Todo bookkeeping remains available
- **WHEN** the model updates the TodoList repeatedly as part of valid planning
- **THEN** those updates do not contribute to a UI action block

#### Scenario: Task termination remains available
- **WHEN** another UI action is blocked
- **THEN** `task_complete` and `task_failed` remain callable according to their existing rules

#### Scenario: Exemption cannot be overridden
- **WHEN** persisted data contains thresholds for a safety-exempt tool
- **THEN** the runtime ignores those thresholds and keeps the tool unblocked

### Requirement: Compact loop history
The system SHALL collapse repeated no-progress records for the same equivalent action into one prompt-history summary while preserving the most recent concrete error or hint.

#### Scenario: Repeated failures are folded
- **WHEN** multiple equivalent calls fail without UI progress
- **THEN** the next prompt contains one loop summary and the latest actionable failure rather than every duplicate record

#### Scenario: Essential context is retained
- **WHEN** loop history is compacted
- **THEN** the original task, user corrections, current TodoList and latest screen observation remain available to the model

### Requirement: Privacy-safe circuit-breaker observability
The system SHALL record warning, block and recovery events through the existing task logging channel without logging screenshots, full accessibility trees, sensitive input text or full node content.

#### Scenario: Block event is diagnosable
- **WHEN** an action is blocked
- **THEN** logs contain the event type, tool family, reason code, non-reversible action fingerprint summary and count

#### Scenario: Sensitive content is excluded
- **WHEN** the blocked action includes typed text or originates on a sensitive page
- **THEN** logs omit the input value, screenshot and complete page text

#### Scenario: Recovery is visible
- **WHEN** a different action produces UI progress after a warning or block
- **THEN** the logging channel records a recovery event for diagnostics

### Requirement: Behavioral and device validation
The implementation MUST be validated through AgentLoop external-behavior tests and Android device testing over ADB before the change is considered complete.

#### Scenario: AgentLoop behavior test
- **WHEN** tests drive repeated equivalent calls against controlled unchanged and changing screen observations
- **THEN** they verify allowed execution, one warning, pre-execution blocking and alternative-action recovery without asserting private hash or queue implementation

#### Scenario: ADB repeated-click validation
- **WHEN** the built app runs on a connected Android device and a safe test screen repeatedly ignores the same tap
- **THEN** filtered logs and visible behavior confirm the warning and block thresholds and confirm the blocked tap is not dispatched

### Requirement: Per-tool availability and metadata overrides
The settings screen SHALL allow users to enable or disable each configurable canonical tool independently and SHALL allow its display label and model-facing description to be overridden without changing the canonical name or parameter schema.

#### Scenario: Disabled tool is unavailable and cannot execute
- **WHEN** a user disables a configurable tool and starts a new task
- **THEN** the tool is absent from the definitions sent to the model
- **AND** a hallucinated call with that canonical name returns `TOOL_DISABLED` without invoking its handler

#### Scenario: Explicit availability overrides the preset
- **WHEN** a user explicitly enables a tool excluded by the selected preset
- **THEN** the next task exposes that tool while retaining the rest of the preset

#### Scenario: Model receives customized description
- **WHEN** a user saves a valid custom description for a tool and starts a new task
- **THEN** the tool keeps its canonical name and parameter schema but the model receives the custom description

#### Scenario: Display label is presentation-only
- **WHEN** a user changes a tool's display label
- **THEN** the Tools tab shows the custom label and runtime tool invocation continues to use the canonical name

#### Scenario: Safety-critical tools stay enabled
- **WHEN** persisted data attempts to disable `confirm_action`, `task_complete` or `task_failed`
- **THEN** normalization ignores the disabling value and the Tools tab explains that the tool is required

#### Scenario: Metadata changes are task-scoped snapshots
- **WHEN** a user edits availability or metadata while a task is running
- **THEN** the running task keeps its original tool definitions and the next task uses the updated configuration

#### Scenario: Default browser description guides model tool use
- **WHEN** the default `browser_use` definition is sent to the model
- **THEN** its description explains the applicable webpage scenarios, the supported action workflow, reference-first element interaction, result verification, screenshot fallback, untrusted-content rule and confirmation boundary
- **AND** it explicitly identifies unsupported browser capabilities so the model does not attempt unavailable actions

#### Scenario: ADB scrolling validation
- **WHEN** the device test scrolls a list through changing content and then continues after reaching the end
- **THEN** normal scrolling is not blocked while end-of-list no-progress scrolling is warned and eventually blocked

#### Scenario: ADB task reset validation
- **WHEN** the device test stops the current task and starts a new one
- **THEN** the new task has no circuit-breaker state inherited from the previous task

#### Scenario: ADB per-tool configuration validation
- **WHEN** the device test saves a low threshold for `tap`, restarts the app and begins a new task
- **THEN** the configured tap threshold persists and triggers while another tool retains its own threshold

#### Scenario: ADB restore-default validation
- **WHEN** the device test restores one tool and then all tools to defaults
- **THEN** the effective values and subsequent new-task behavior return to defaults without changing unrelated settings

## ADDED Requirements

### Requirement: Persistent isolated Linux shell
The system SHALL execute `shell_execute` commands in an application-private Alpine Linux environment backed by PRoot, and SHALL preserve files written inside the designated workspace across tool calls.

#### Scenario: Execute a basic command
- **WHEN** the agent invokes `shell_execute` with `privilege=sandbox` and a valid command
- **THEN** the command runs under the packaged Alpine rootfs and the tool returns its output, exit code, and duration

#### Scenario: Reuse workspace state
- **WHEN** one sandbox command writes a file in `/workspace` and a later command reads it
- **THEN** the later command observes the previously written content

### Requirement: Lazy and deterministic sandbox initialization
The system SHALL install the packaged rootfs lazily into application-private storage, SHALL serialize concurrent initialization, and SHALL never fall back to executing the command directly in the Android application process namespace.

#### Scenario: First shell invocation
- **WHEN** `shell_execute` is invoked before the rootfs is installed
- **THEN** the system installs and validates the rootfs before executing the command

#### Scenario: Sandbox initialization fails
- **WHEN** the rootfs or PRoot binary cannot be installed or validated
- **THEN** the tool returns a structured failure and does not run the command with `/system/bin/sh`

### Requirement: Bounded command execution
The system MUST enforce command-length, timeout, concurrency, and output-size limits in the native execution boundary.

#### Scenario: Command times out
- **WHEN** a command exceeds its effective timeout
- **THEN** the process is terminated and the tool returns `timed_out=true` with a non-success result

#### Scenario: Command produces excessive output
- **WHEN** captured output exceeds the model-facing limit
- **THEN** the response marks the output as truncated, retains useful diagnostic text, and provides a local reference to the complete bounded output

#### Scenario: Invalid command input
- **WHEN** a command is empty, contains a NUL byte, exceeds the maximum length, or requests an invalid timeout
- **THEN** the command is rejected before process creation

### Requirement: Explicit Shizuku privilege boundary
The system SHALL execute Android shell commands through Shizuku only when `privilege=shizuku` is explicitly requested and the Shizuku service is installed, running, and authorized.

#### Scenario: Authorized Shizuku read
- **WHEN** an explicitly requested read-only Shizuku command passes policy and Shizuku is ready
- **THEN** the command runs with the Shizuku service identity and returns the common shell result structure

#### Scenario: Shizuku is unavailable
- **WHEN** `privilege=shizuku` is requested but its service or permission is unavailable
- **THEN** the tool returns a structured permission/state error and does not fall back to sandbox execution

### Requirement: High-risk command protection
The system MUST classify Shizuku commands at the host boundary, MUST require user confirmation for state-changing commands allowed by policy, and MUST reject prohibited destructive commands even if model output attempts shell composition.

#### Scenario: State-changing command lacks confirmation
- **WHEN** the agent requests an allowed Shizuku write command without a valid confirmation decision
- **THEN** execution is paused for confirmation and no process is created

#### Scenario: Prohibited destructive command
- **WHEN** a Shizuku command requests prohibited behavior such as clearing application data, uninstalling a package, rebooting, or recursive deletion
- **THEN** the native boundary rejects it regardless of model instructions or shell quoting

### Requirement: Agent tool integration
The system SHALL expose `shell_execute` through the existing tool registry with concise usage guidance and SHALL include durable execution facts, but not raw reasoning, in subsequent prompt history.

#### Scenario: Tool is enabled
- **WHEN** the active tool preset includes `shell_execute`
- **THEN** the model receives its schema and can invoke it through the normal tool loop

#### Scenario: Execution result enters history
- **WHEN** a shell invocation completes
- **THEN** subsequent turns receive the bounded command result through the existing tool-result history path

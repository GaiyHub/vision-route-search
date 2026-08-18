## ADDED Requirements

### Requirement: Execution-backed informational tasks may use tools
The agent SHALL distinguish ordinary answer-only requests from informational tasks that require execution for an accurate, efficient, or verifiable result, and MUST permit tools for the latter.

#### Scenario: Ordinary knowledge question
- **WHEN** the user asks a knowledge, explanation, advice, or creative-writing question that can be answered reliably without execution
- **THEN** the agent answers directly without calling Shell or another tool

#### Scenario: Deterministic processing request
- **WHEN** the user requests precise calculation, structured data transformation, file processing, a network request, or runtime diagnosis
- **THEN** the agent may enter the tool loop and choose the tool best suited to produce a verifiable result

### Requirement: Shell selection guidance lives with the tool
The `shell_execute` model-facing description SHALL state its positive selection criteria and negative boundaries without requiring per-turn tool filtering.

#### Scenario: Shell is more efficient than UI or reasoning
- **WHEN** a command can complete a text, structured-data, calculation, file, network, or diagnostic task more accurately or efficiently than pure reasoning or phone UI actions
- **THEN** the description directs the model to prefer `shell_execute`

#### Scenario: Shell is unnecessary or superseded
- **WHEN** the request is an ordinary answer-only task or a dedicated tool is clearly better suited
- **THEN** the description directs the model not to invoke Shell merely because command execution is available

### Requirement: Tool exposure remains unchanged
The system MUST retain the existing preset-based full tool exposure and MUST NOT introduce task-level or per-turn tool filtering as part of this change.

#### Scenario: Full preset task begins
- **WHEN** a task starts with the full tool preset
- **THEN** the existing complete tool list is exposed using the current registration and ordering behavior

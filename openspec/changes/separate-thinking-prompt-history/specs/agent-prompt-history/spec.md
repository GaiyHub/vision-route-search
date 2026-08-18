## ADDED Requirements

### Requirement: Observable thinking remains separate from prompt history
The agent SHALL expose model thinking to runtime observers but SHALL NOT include raw thinking text in messages submitted on subsequent inference rounds.

#### Scenario: Thinking precedes a tool call
- **WHEN** a model response contains thinking text followed by a valid tool call
- **THEN** the agent SHALL emit the thinking event and execute the tool while excluding that thinking text from the next request's assistant history

#### Scenario: Action continuity after thinking is excluded
- **WHEN** a thinking event and a completed tool action belong to the same decision round
- **THEN** the next request SHALL retain the tool name, arguments, result, and following observation as conversation history

### Requirement: Tool-aware thinking extraction
The agent SHALL identify supported tool-call boundaries before applying a generic JSON boundary fallback.

#### Scenario: Thinking contains braces before an XML tool call
- **WHEN** thinking text contains braces and is followed by a `<tool_call>` payload
- **THEN** the complete thinking text before `<tool_call>` SHALL be emitted without truncation at the earlier brace

#### Scenario: Thinking uses wrapper tags
- **WHEN** the extracted thinking is enclosed by `<think>` and `</think>`
- **THEN** the observable thinking content SHALL omit those wrapper tags

### Requirement: Existing history controls remain compatible
The agent SHALL preserve the configured history-round pruning behavior for action and observation history.

#### Scenario: History limit is configured
- **WHEN** `maxHistoryItems` limits the number of retained decision rounds
- **THEN** the agent SHALL apply that limit to prompt-safe action and observation rounds without reintroducing thinking text


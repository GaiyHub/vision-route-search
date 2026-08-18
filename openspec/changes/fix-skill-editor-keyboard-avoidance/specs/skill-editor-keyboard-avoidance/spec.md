## ADDED Requirements

### Requirement: Focused experience field remains visible
The experience editor SHALL keep the focused name, description, or body input visible above the software keyboard.

#### Scenario: Focus a field while the keyboard is hidden
- **WHEN** the user focuses any experience editor input and the software keyboard opens
- **THEN** the editor viewport resizes and scrolls the focused input into the visible region above the keyboard

#### Scenario: Edit the long body field
- **WHEN** the user edits the multiline experience body near the lower part of the form
- **THEN** the body input and current editing region remain reachable without being covered by the software keyboard

### Requirement: Keyboard dismissal preserves editor access
The experience editor MUST remain scrollable and retain access to all fields after the software keyboard is dismissed.

#### Scenario: Dismiss keyboard after editing
- **WHEN** the user dismisses the software keyboard after editing a field
- **THEN** the full editor layout remains scrollable and the header actions remain available

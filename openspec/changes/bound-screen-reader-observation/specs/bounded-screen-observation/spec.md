## ADDED Requirements

### Requirement: Accessibility traversal is bounded
The Android screen reader SHALL bound each accessibility-tree capture by elapsed time, visited-node count, traversal depth, and returned-element count, and SHALL stop further traversal when any applicable budget is exhausted.

#### Scenario: Complex tree exceeds a traversal budget
- **WHEN** an accessibility tree exceeds the configured time, visit, depth, or result budget
- **THEN** capture terminates within the bounded execution path and returns the useful nodes collected before truncation

### Requirement: Partial capture is explicit
The native accessibility snapshot SHALL report whether its node array is partial together with a stable truncation reason, visited-node count, returned-node count, and elapsed duration.

#### Scenario: Time budget expires after useful nodes were collected
- **WHEN** the reader collects one or more useful nodes and then reaches its time budget
- **THEN** the snapshot contains those nodes and reports `truncated=true` with a time-budget reason and capture metrics

#### Scenario: Capture completes within budget
- **WHEN** the reader reaches the end of the accessibility tree within every budget
- **THEN** the snapshot reports `truncated=false` and contains completion metrics

### Requirement: Tree capture does not block or accumulate on the native module queue
Accessibility-tree traversal SHALL run outside the React Native native-module queue and SHALL permit at most one active traversal without queuing duplicate captures.

#### Scenario: Another capture is active
- **WHEN** a tree capture is requested while a previous traversal remains active
- **THEN** the new request fails promptly with a stable busy result instead of waiting behind the active traversal

### Requirement: Screenshot success is independent from auxiliary tree capture
The screenshot tool SHALL return a successfully captured image even when its auxiliary accessibility-tree observation is partial, busy, unavailable, or exceeds the tree wait window.

#### Scenario: Image succeeds while tree capture does not finish
- **WHEN** screenshot image capture succeeds and accessibility-tree capture does not finish within its bounded wait
- **THEN** the screenshot tool returns success with the image and an explicit tree-unavailable status

#### Scenario: Image capture fails
- **WHEN** no screenshot image source succeeds
- **THEN** the screenshot tool returns `SCREENSHOT_UNAVAILABLE` regardless of the accessibility-tree result

### Requirement: Existing tree callers remain compatible
The native module SHALL retain the existing array-returning accessibility-tree operation while making it use the same bounded traversal as the structured snapshot operation.

#### Scenario: Legacy caller requests the tree
- **WHEN** a caller invokes the existing accessibility-tree method
- **THEN** it receives an array of collected nodes without requiring changes to its response parser

### Requirement: Expired tree work is actively cancelled
The native tree capture SHALL enforce its elapsed-time deadline inside traversal and SHALL expose cancellation so callers that abandon an observation can interrupt the associated native Future.

#### Scenario: Traversal reaches its wall-clock deadline
- **WHEN** elapsed monotonic time reaches the configured capture budget
- **THEN** traversal stops before visiting another node and reports a stable elapsed-time truncation reason

#### Scenario: Screenshot stops waiting for its auxiliary tree
- **WHEN** the screenshot tool's tree wait window expires
- **THEN** it requests cancellation of the active native tree capture instead of leaving unwanted work running silently

### Requirement: Tree stalls do not block UI actions
Semantic and ref UI actions SHALL execute independently from the accessibility-tree capture executor.

#### Scenario: A tree capture is still unwinding
- **WHEN** a semantic or ref click is requested while a cancelled tree task has not yet returned from a Binder call
- **THEN** the action is dispatched on the UI-action executor rather than queued behind the tree task

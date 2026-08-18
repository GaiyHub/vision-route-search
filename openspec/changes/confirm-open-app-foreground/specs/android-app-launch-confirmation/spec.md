## ADDED Requirements

### Requirement: Foreground-confirmed application launch
The `open_app` tool SHALL distinguish launch dispatch from foreground confirmation and SHALL return structured launch state.

#### Scenario: Requested package is already foreground
- **WHEN** `open_app` is called for the package currently reported in the foreground
- **THEN** the tool SHALL skip the launch dispatch and return a successful result with `alreadyForeground` and `launchConfirmed` set to true

#### Scenario: Requested package reaches foreground after dispatch
- **WHEN** the launch request is accepted and a later foreground inspection reports the requested package
- **THEN** the tool SHALL return immediately with a successful result containing the actual package, activity, confirmation status, and elapsed time

### Requirement: Bounded and truthful launch outcome
The `open_app` tool SHALL use bounded foreground inspection and SHALL not report an unobserved foreground transition as confirmed.

#### Scenario: Launch dispatch is rejected
- **WHEN** the Android controller rejects the launch request
- **THEN** the tool SHALL return a failed result with `launchAccepted` and `launchConfirmed` set to false and an actionable package-name hint

#### Scenario: Another package remains foreground
- **WHEN** the launch request is accepted but the requested package is not observed within the confirmation budget
- **THEN** the tool SHALL return `APP_NOT_FOREGROUND` with the last observed package and activity, `launchAccepted` set to true, and `launchConfirmed` set to false

#### Scenario: Foreground inspection is unavailable
- **WHEN** the controller can dispatch the launch but does not provide foreground inspection
- **THEN** the tool SHALL preserve successful dispatch compatibility while returning `confirmationAvailable` and `launchConfirmed` as false

### Requirement: Observation after accepted unconfirmed launch
The agent loop SHALL treat a launch accepted by Android as potentially UI-changing even when foreground confirmation times out.

#### Scenario: Accepted launch times out
- **WHEN** a tool result has `ok` set to false and `launchAccepted` set to true
- **THEN** the agent loop SHALL not classify the action as a failed no-op when deciding whether post-action UI observation is needed


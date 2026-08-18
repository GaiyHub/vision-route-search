## 1. Completion state and bridge

- [x] 1.1 Represent decision and supplemental-input phases without settling the active completion resolver
- [x] 1.2 Route 完成, 继续, valid supplement submission, return, timeout, and stop through single-settlement behavior
- [x] 1.3 Validate supplemental input and inject it as attributed user continuation context

## 2. User interface

- [x] 2.1 Present 完成, 继续, and 补充信息 in the primary completion dialog
- [x] 2.2 Add the supplemental text-entry phase with validation, character count, return, and submit controls
- [x] 2.3 Keep notification and overlay fallback behavior compatible with the three-way primary dialog

## 3. Verification and delivery

- [x] 3.1 Add store and bridge tests for phase transitions, validation, timeout, and single settlement
- [x] 3.2 Add UI-focused coverage for the three choices and supplemental submission behavior
- [x] 3.3 Run type checking and focused/full tests, validate the OpenSpec change, and build a release APK
- [ ] 3.4 Install the release APK and verify the completion dialog on device
- [x] 3.5 Prevent blank decision-button labels when returning from an empty supplemental-input phase, then rerun regression checks

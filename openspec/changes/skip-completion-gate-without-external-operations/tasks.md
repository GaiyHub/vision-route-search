## 1. Runtime policy

- [x] 1.1 Add a pure classifier for phone, browser, Shell, read-only, and host-protocol tool calls
- [x] 1.2 Track task-scoped monotonic external-operation state from tool dispatch arguments
- [x] 1.3 Short-circuit the completion gate before all UI and notification side effects when no external operation occurred

## 2. Verification and delivery

- [x] 2.1 Add policy and bridge tests for plain answers, read-only tasks, browser actions, operation tasks, and task reset
- [x] 2.2 Run focused/full tests, type checking, and OpenSpec validation
- [x] 2.3 Build and install the Android release APK

## 3. Clarification gate adjustment

- [x] 3.1 Treat `ask_user` as requiring completion confirmation, add regression coverage, and reinstall the release APK

## 4. Risk-confirmation gate adjustment

- [x] 4.1 Treat `confirm_action` as requiring completion confirmation, add regression coverage, and reinstall the release APK

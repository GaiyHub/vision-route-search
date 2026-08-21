## 1. Prompt and tool guidance

- [x] 1.1 Update intent routing so execution-backed informational tasks may enter the tool loop while ordinary answer-only requests remain tool-free
- [x] 1.2 Update the shell_execute description with concise positive selection criteria and negative boundaries
- [x] 1.3 Preserve the existing tool presets, registration order, and absence of per-turn tool filtering

## 2. Verification and delivery

- [x] 2.1 Add regression coverage for system prompt and Shell description guidance
- [x] 2.2 Run type checking and automated tests
- [x] 2.3 Build the release APK and install it on the connected Android device

## 3. Dynamic time guidance follow-up

- [x] 3.1 Add a new active prompt revision without the broad “简单任务直接完成” wording while preserving rollback versions
- [x] 3.2 Add concise mandatory `date`-based no-guess guidance to shell_execute without adding a dedicated time tool or enumerating command examples
- [x] 3.3 Add regression coverage and run focused tests plus type checking

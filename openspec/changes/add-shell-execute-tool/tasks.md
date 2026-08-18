## 1. Build and packaging

- [x] 1.1 Add reproducible scripts and provenance metadata for the pinned Alpine rootfs and OpenMinis PRoot arm64 binary
- [x] 1.2 Extend the Expo Android config plugin to package the rootfs, native PRoot library, Kotlin sources, no-compress rules, and Shizuku dependencies

## 2. Native execution runtime

- [x] 2.1 Implement lazy, serialized and path-safe Alpine rootfs installation in application-private storage
- [x] 2.2 Implement bounded PRoot execution with workspace persistence, timeout, cancellation, output capture and offload metadata
- [x] 2.3 Implement Shizuku readiness checks and bounded command execution with a host-side allow/confirm/deny policy
- [x] 2.4 Expose the common execution result through `DeftAgentModule` and ensure generated Android sources remain synchronized

## 3. Agent tool integration

- [x] 3.1 Add the `shell_execute` schema, presets, UI-effect metadata and circuit-breaker catalog behavior
- [x] 3.2 Add the React Native tool handler, input validation, Shizuku confirmation routing and normalized result mapping
- [x] 3.3 Protect `shell_execute` as a sensitive tool configuration and keep model-facing descriptions concise

## 4. Verification

- [x] 4.1 Add TypeScript tests for schema exposure, routing, validation and confirmation, with native coverage for result truncation
- [x] 4.2 Add native tests for command policy, tar extraction path safety and output bounding
- [x] 4.3 Run focused tests, validate the OpenSpec change, and build an Android release APK
- [ ] 4.4 Install on the connected device and smoke-test basic sandbox persistence, timeout, long output and Shizuku-unavailable behavior

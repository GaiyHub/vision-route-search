# Spec: `adb-runner`

## Purpose

Turn the bridge contract into a bounded PC-side device execution API.

## Contract

- Discover devices from `adb devices -l`, expose only `device` state as selectable and preserve serial identifiers.
- Refuse to start when no serial is selected, the serial is offline/unauthorized, or the evaluation package/bridge is unavailable.
- Invoke ADB through argument arrays with bounded stdout/stderr and per-operation timeouts.
- Submit a request, poll its status with bounded backoff, expose progress and return one terminal result.
- On sample timeout, request cancellation, collect available evidence and classify the sample as timed out rather than silently retrying the instruction.
- A transport retry must reuse the original `runId` and payload hash.
- Device loss stops the active run and marks remaining samples unexecuted.

## Success criteria

- Fake-ADB tests cover unauthorized, multiple-device, malformed-output, timeout, cancellation and duplicate-delivery cases.
- A selected real device can run a command whose instruction contains spaces, quotes and Chinese characters without shell escaping defects.


## Why

Android application launch is asynchronous, but `open_app` currently returns a bare `true` as soon as the launch request is accepted. The model can therefore receive success before the target package reaches the foreground and may repeat `open_app` instead of acting on the newly opened screen.

## What Changes

- Make `open_app` wait for bounded foreground-package confirmation after dispatching the launch request.
- Return structured launch state including requested package, actual foreground package, confirmation status, elapsed time, and whether the app was already foreground.
- Return actionable failure metadata when launch dispatch fails or another package remains foreground until timeout.
- Add tests for already-foreground, confirmed launch, intercepted launch, and unavailable foreground inspection.

## Capabilities

### New Capabilities

- `android-app-launch-confirmation`: Defines synchronous tool semantics over Android's asynchronous application launch behavior.

### Modified Capabilities

None.

## Impact

- `guidedog-agent/src/device-agent/agent/AgentToolkit.ts`
- Android controller `getCurrentForegroundApp` integration
- Agent tool-result tests and model-facing `open_app` result contract

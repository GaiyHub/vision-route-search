## 1. Native bounded capture

- [x] 1.1 Add elapsed-time, visited-node, depth, and returned-node budgets to ScreenReader and expose structured partial-capture metrics
- [x] 1.2 Run captures on a dedicated single-flight executor while preserving the legacy array-returning API
- [x] 1.3 Update the React Native native specification and public TypeScript types for structured snapshots

## 2. Agent observation behavior

- [x] 2.1 Make PhoneObservation prefer structured snapshots and serialize partial/unavailable state compactly
- [x] 2.2 Decouple screenshot image success from its auxiliary tree wait and return explicit tree status

## 3. Verification

- [x] 3.1 Add tests for native traversal budgets and screenshot fallback when tree capture stalls
- [x] 3.2 Run targeted TypeScript tests, Android native tests or compilation, and OpenSpec validation

## 4. Hard wall-clock cancellation

- [x] 4.1 Enforce the elapsed-time deadline and explicit cancellation signal inside TraversalBudget and ScreenReader
- [x] 4.2 Add native capture watchdog/Future cancellation and expose a public cancellation bridge
- [x] 4.3 Separate semantic/ref actions from the tree-capture executor
- [x] 4.4 Cancel the auxiliary native tree capture when screenshot stops waiting for it
- [x] 4.5 Add cancellation/deadline tests, compile Android, run targeted TypeScript tests, and validate OpenSpec

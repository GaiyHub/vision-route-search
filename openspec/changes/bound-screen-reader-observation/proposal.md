## Why

复杂 Android 应用的无障碍树可能包含大量动态节点。当前 ScreenReader 只限制返回元素数，却不限制实际遍历量、深度或耗时，并且遍历占用 React Native 原生模块队列，导致 UI 观察和截图工具整体超时、模型连续重试。

## What Changes

- 为无障碍树采集增加总耗时、访问节点数、深度和返回元素数预算，预算耗尽时返回可用的部分结果及截断原因。
- 将树采集移出 React Native 原生模块队列，并拒绝并发积压，避免慢树阻塞其他原生工具。
- 让截图结果不再依赖完整无障碍树成功；树超时或不可用时仍返回已捕获图片和明确状态。
- 通过结构化采集元数据区分“部分结果”“采集中”和真正异常，减少相同观察动作的无意义重试。
- 增加原生预算和 TypeScript 截图降级测试。

## Capabilities

### New Capabilities

- `bounded-screen-observation`: 规定 Android 无障碍树观察的有界执行、部分结果契约，以及截图与结构树的故障隔离。

### Modified Capabilities


## Impact

- Android `react-native-accessibility-controller` 的 ScreenReader、原生桥接口和线程调度。
- `PhoneObservation` 的结构树序列化与采集状态表达。
- `screenshot` 工具的图片/结构树并行协调逻辑及相关测试。

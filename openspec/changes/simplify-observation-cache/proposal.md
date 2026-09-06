## Why

豆泡当前把同一份手机 UI 观察拆散保存在原生 ref 注册表、`AgentToolkit` 的多份 Map，以及 `AgentLoop` 的多个并行字段中，并由多套逻辑分别失效。状态容易漂移；尤其同一轮先观察、后执行页面变化动作时，旧的瞬态结构仍可能进入下一次模型决策。

## What Changes

- 将 JS 运行时定位状态收敛为“唯一当前 observation”，统一保存 observation id、类型、物理尺寸和 ref 元数据。
- 将模型侧瞬态结构、截图附件及消费状态收敛为一个模型 observation 状态对象。
- 页面变化或等待通过同一失效入口清除旧 observation；动作返回后置截图时，以新截图替换旧状态。
- 坐标和 OCR ref 仅接受当前有效 observation，避免旧截图 id 在后续观察后继续可用。
- 保留原生 `NodeRefRegistry`、实时节点刷新校验、推理重试期间截图复用和 `visual_memory`。

## Capabilities

### New Capabilities

- `unified-ui-observation-lifecycle`: 规定手机 UI 观察的创建、单次模型消费、替换和失效语义。

### Modified Capabilities

无。

## Impact

- 主要影响 `guidedog-agent/src/device-agent/agent/AgentToolkit.ts` 与 `AgentLoop.ts`。
- `ui_screenshot`、`ui_inspect`、坐标点击及 OCR ref 的模型可见协议保持兼容。
- 不修改 Android 原生 `NodeRefRegistry`，不引入新依赖。

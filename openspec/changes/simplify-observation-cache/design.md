## Context

当前 observation 生命周期横跨两层：`AgentToolkit` 用 `activeUiObservations` 和 `observedRefTargets` 支持坐标、OCR ref、风险说明及循环指纹；`AgentLoop` 用多个字段支持瞬态结构、一次性视觉附件和 `visual_memory`。两层依据 `uiEffect` 分别失效，历史构建阶段还会重新扫描事件推导 observation revision。

原生 `NodeRefRegistry` 持有可刷新的 `AccessibilityNodeInfo`，属于 Android 安全执行边界，不应被 JS 重构替代。

## Goals / Non-Goals

**Goals:**

- JS 定位状态只表达“当前 observation”，删除无实际契约价值的多 observation 保留。
- 模型瞬态结构和截图附件由一个对象管理，避免字段组合漂移。
- 页面变化、等待和后置观察采用一致顺序：失效旧状态，再登记新状态。
- 保持工具协议、模型重试、坐标换算和视觉记忆行为兼容。

**Non-Goals:**

- 不修改原生 ref 的生成、TTL 或点击算法。
- 不引入基于无障碍事件的主动观察。
- 不改变截图缩放、OCR 或 UI 动作验证策略。
- 本次不重写整个历史压缩机制。

## Decisions

### AgentToolkit 使用单个当前定位 observation

用一个包含 `id`、`kind`、可选物理尺寸和 ref Map 的状态替代 `activeUiObservations` 与 `observedRefTargets`。新观察整体替换旧观察；坐标和 OCR ref 只查询该对象。

备选方案是保留 16 项 Map 并增加 revision。该方案仍允许多个旧 id 存活，增加失效和边界判断，因此不采用。

### AgentLoop 使用单个当前模型 observation

用一个对象保存 `id`、可选完整结构、可选截图、截图是否消费以及视觉记忆是否采集。完整结构和截图可以来自同一个 `ui_screenshot`，也可以只出现其中之一。

该对象在成功模型请求后清除瞬态结构并标记截图已消费；请求失败重试期间不改变。

### 统一动作后的更新顺序

每个工具完成后先解析 `uiEffect`。若为 `change` 或 `wait`，先清空旧模型 observation；随后从工具结果提取新的结构或后置截图并登记。这样同轮“观察后操作”不会泄漏旧结构，而动作验证得到的新截图仍能进入下一轮。

Toolkit 继续在工具执行末尾同步清理定位 observation，因为它位于动作派发边界；Loop 只管理模型上下文，不再分别维护结构和图片的不同失效规则。

### 暂时保留历史 observation revision

历史中的 `ui_find_node`、`ui_get_node` 等结果仍可能含当前状态信息。为了把本次重构控制在可验证范围内，先保留历史 revision 扫描；待所有 UI 观察结果都采用“一轮完整内容 + 历史回执”后再独立删除。

## Risks / Trade-offs

- [连续观察后旧 observation id 将立即失效，行为比当前最多保留 16 个 id 更严格] → 工具描述本就要求最新 observation，并补充覆盖测试。
- [模型状态对象同时支持只有结构或只有图片，可能出现空状态] → 通过集中构造函数，仅在至少存在一种有效载荷时保存。
- [同轮多个工具的顺序处理容易再次引入先后错误] → 明确采用“先按 effect 失效，后登记结果”的固定顺序并测试。
- [原生无障碍 ref 注册表仍可能短期保留旧节点] → 实际执行继续依赖原生 `refresh`、窗口及包名校验；JS 只收敛元数据，不放宽安全边界。

## Migration Plan

该状态仅存在于单次 Agent 运行内，无持久数据迁移。先替换 Toolkit 定位状态并运行工具测试，再替换 Loop 模型状态并运行循环测试；任一阶段可独立回滚对应文件。

## Open Questions

无。历史 revision 扫描的进一步简化明确留给后续独立变更。

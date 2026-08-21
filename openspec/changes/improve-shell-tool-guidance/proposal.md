## Why

豆泡当前的意图路由把问答、总结和转换类请求一律限制为不调用工具，导致本可由 Shell 提供精确、可验证结果的计算、文本处理、文件、网络和诊断任务被直接回答或绕到低效的 UI 操作路径。

## What Changes

- 放宽系统提示词中的绝对禁用规则：普通知识问答和创作仍直接回答，但需要精确计算、结构化转换、文件处理、网络请求或诊断执行时允许调用合适工具。
- 在 `shell_execute` 工具描述中定义其优先场景和禁用边界，使模型能在 Shell 比纯推理或 UI 操作更准确、高效、可验证时主动选择它。
- 删除容易把“单步任务”误解为“无需工具”的“简单任务直接完成”表述；时间类动态事实通过现有 Shell `date` 命令查询，并在简洁的工具描述中禁止猜测。
- 不增加每轮工具筛选，不改变工具预设、工具顺序或执行权限。

## Capabilities

### New Capabilities

- `shell-tool-guidance`: 规定模型何时应优先调用 Shell，以及何时应继续直接回答或使用专用工具。

### Modified Capabilities

无。

## Impact

- 修改 `guidedog-agent/src/agent/agentBridge.ts` 的意图路由文案。
- 修改 `guidedog-agent/src/shell/ShellTool.ts` 的模型可见工具描述。
- 增加提示词与工具描述的回归测试；不改变 Shell 执行器、安全策略和工具列表组装逻辑。

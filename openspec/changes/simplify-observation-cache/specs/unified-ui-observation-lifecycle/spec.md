## ADDED Requirements

### Requirement: 唯一当前 UI 观察
系统 SHALL 在 JS 运行时只保留一份可用于后续 UI 定位的当前 observation；每次成功结构观察或截图观察 SHALL 替换上一份当前 observation。

#### Scenario: 连续读取两次观察
- **WHEN** Agent 连续成功调用两次 UI 观察工具
- **THEN** 只有第二次返回的 observation id、尺寸与 ref 元数据可用于后续定位

### Requirement: 页面变化统一失效
系统 SHALL 在成功的 `change` 或 `wait` 类工具执行后，通过统一入口使此前的当前 observation、瞬态结构和未消费截图失效。

#### Scenario: 同轮观察后执行页面动作
- **WHEN** 同一次模型响应先执行 UI 观察、随后执行一个成功的页面变化动作且该动作未返回新观察
- **THEN** 下一次模型决策不得收到该动作前的完整结构或截图

#### Scenario: 动作返回后置截图
- **WHEN** 页面变化动作完成并返回一张后置截图
- **THEN** 系统先使旧 observation 失效，再将后置截图登记为新的当前模型观察

### Requirement: 模型观察单次消费与重试
系统 SHALL 将截图附件和完整 UI 结构提供给紧随其后的模型决策，并 SHALL 在该决策成功前对同一请求的提供方重试保持可用；成功后不得在后续决策重复附带。

#### Scenario: 模型请求发生可重试失败
- **WHEN** 携带当前 observation 的模型请求失败并进入提供方重试
- **THEN** 每次重试接收同一份截图和完整 UI 结构

#### Scenario: 模型请求成功
- **WHEN** 携带当前 observation 的模型请求成功返回
- **THEN** 后续模型决策不再自动附带该截图或完整结构

### Requirement: 原生 ref 安全边界保持不变
系统 MUST 保留原生节点 ref 的 TTL、窗口/包名检查和使用前刷新校验；JS observation 状态收敛不得使 ref 跨真实页面变化持久化。

#### Scenario: 原生节点已过期
- **WHEN** 模型提交的无障碍 ref 已无法在当前窗口刷新
- **THEN** 操作返回陈旧 ref 错误并要求重新观察


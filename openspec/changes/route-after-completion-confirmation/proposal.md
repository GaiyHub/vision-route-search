## Why

当前完成确认流程在确认框被处理后总会返回确认框弹出前的 App，即使任务只是知识问答或纯文本回复，也会把用户从豆泡错误切走。系统需要根据本次任务是否实际代用户操作外部手机 UI，选择恢复最近 App 或留在豆泡。

## What Changes

- 为每次 Agent 任务维护一个宿主侧、任务级的交互类型：`question_answer` 或 `device_operation`。
- 以实际执行的外部 UI 变更工具作为代操作证据；纯文本回答、只读观察、记事/清单工具和豆泡内置浏览器不触发代操作分类。
- 将任务完成确认框改为“完成”“继续”“补充信息”三个选项；“继续”和提交后的“补充信息”都表示任务未完成，并通过现有 continuation 通道让 Agent 继续。
- “补充信息”先进入多行输入态，用户提交有效内容后才释放完成 gate；输入期间任务保持暂停，且不会被自动完成超时抢先结算。
- 完成确认被“完成”、超时默认完成、“继续”或补充信息提交处理后，仅代操作任务恢复确认框弹出前的外部 App；问答任务保持豆泡在前台。
- 复用现有前台包名捕获和 `returnToPreviousApp` 能力，并在捕获目标为空时使用最近外部 App 记录作为受约束的后备。
- 增加任务分类、确认结果路由、状态重置及失败降级的自动化测试与 ADB 验收场景。

## Capabilities

### New Capabilities

- `completion-return-routing`: 提供三选项完成确认，并根据当前任务的实际交互类型，在确认结束后决定恢复最近外部 App 或留在豆泡。

### Modified Capabilities

<!-- 无已发布主规格需要修改；现有完成确认变更为旧式单文件规格。 -->

## Impact

- `guidedog-agent/src/agent/agentBridge.ts`：任务级交互类型、工具动作归类、补充输入阶段、完成确认后的条件回跳。
- `guidedog-agent/src/store/agentStore.ts`：完成确认状态增加决策/补充输入阶段；不持久化用户草稿。
- `guidedog-agent/app/chat/ChatScreen.tsx`：完成确认框三选项、多行输入、长度与空值校验。
- `react-native-accessibility-controller`：继续复用现有 `getCurrentForegroundApp`、`getLastForegroundApp` 和 `returnToPreviousApp`，预计无需修改原生接口。
- 测试覆盖 agentBridge 的完成确认行为；真机验证豆泡/外部 App 的前台切换结果。

## Why

guidedog 的长期愿景是"录制轨迹 → 经验库 → 代操/指导"三合一。经调研与多轮架构讨论，决定**先聚焦链路 B（代操执行链路）**：基于语音交互的自主手机操作 agent。链路 A（录制经验库）暂缓，但保留 `query_experience` 作为工具接口位，未来即插即用。

市场调研结论：没有现成开源项目完整实现"纯 App + 语音交互 + 敏感确认 + 中途打断注入"。最接近的基座是 **deft**（MIT，React Native/TypeScript）：已具备 ReAct 主循环、25 个手机控制工具、多 Provider 模型路由、语音 STT/TTS、实时悬浮 overlay。在其上做增量改造，是最快路径。

## What Changes

- 以 deft 1.4.5 为基座，新建 guidedog-agent RN/TS 工程（含三个本地依赖库：react-native-device-agent、react-native-accessibility-controller、react-native-executorch）
- 主流程：**单上下文 ReAct 主 agent + 工具集**（非四阶段流水线、非一次性预规划）
- 工具集（7 个）：read_screen / screenshot / execute / verify / ask_user / plan / query_experience(stub)
- 语音交互：ASR/TTS 可配置；初始目标语音输入；执行中随时打断（紧急停止 + CORRECTION 改向注入）
- 安全边界 A：打断在决策点注入，注入前强制刷新感知
- 安全边界 B：敏感动作由 LLM 判断（开放语义，不限支付），代码级门控确认；支持 confirm / hand_over 两种干涉
- 模型层全配置化：OpenAI 兼容 / Anthropic / 本地，capabilities（vision / tool_calling / native_planning）驱动运行时自适应
- 上下文管理：消费后移图 + 滑动窗口 + 摘要压缩
- 经验库：只定义 `query_experience` 工具契约，stub 返回空，决策循环零依赖

## Capabilities

### New Capabilities

- `agent-loop`: 单上下文 ReAct 主循环（观察→推理→工具调用→执行→观察），步数/超时/中止控制，事件流输出。
- `tool-set`: 7 个核心工具，含执行门控、验证、询问用户、规划、经验查询。
- `voice-interaction`: 语音初始目标、执行中打断（CORRECTION 注入 + 紧急停止）、语音确认，ASR/TTS 可配置。
- `safety-boundary`: 安全边界 A（决策点注入 + 刷新感知）与 B（execute 敏感门控 + confirm/hand_over）。
- `model-config`: 可配置模型层（预设 + 自定义 base_url），capabilities 自适应。
- `context-management`: 消费后移图 + 滑动窗口 + 摘要压缩。

### Modified Capabilities

（无 — 全新工程，基于 deft 派生）

## Impact

- 新建 RN/TS 工程 guidedog-agent（基于 deft 1.4.5，MIT，保留 LICENSE 声明）
- 三个本地依赖库需保持为兄弟目录并构建（lib 产出）
- Android minSdk 26；权限：无障碍、悬浮窗、录音、前台服务、通知
- 产出物：可 sideload 的 APK；M1 先以云端模型跑通，本地 ExecuTorch 可选
- 不影响现有 Kotlin guidedog 录制工程（链路 A 暂缓，代码保留）

## Non-goals

- 链路 A（录制 → 异步分析 → 经验库）本阶段不实现，仅保留 query_experience 接口
- 不做云手机/云端沙箱形态；运行在用户本机
- 不引入多 agent（主从/子代理）——单 agent + 工具即可覆盖，出现"上下文超预算/真并行/风险隔离"信号后再评估
- 不实现多设备/多窗口/折叠屏专项适配
- 不做 App Store 发布合规（Google Play 无障碍自动化政策风险已知，先走侧载/F-Droid 形态）

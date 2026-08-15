# guidedog-agent 任务清单

> 状态约定：`[ ]` 未开始 / `[x]` 完成

## M0：基座就绪（已完成）

- [x] 克隆 deft 1.4.5 为 guidedog-agent（MIT，保留 LICENSE）
- [x] 克隆并构建三个本地依赖库（device-agent / accessibility-controller / executorch）
- [x] npm install 完成（1228 包）
- [x] `npm run typecheck` 通过
- [x] 核心工具迁移：device-agent 22 个文件迁入 `src/device-agent/`，外部依赖移除，typecheck + 33 测试通过

## M1：云端模型跑通

- [x] 工程更名：package.json / app.json（**WatchDog**，com.watchdog.agent）
- [x] `npx expo prebuild --platform android` 生成 Android 工程
- [ ] 接入 OpenAI 兼容 CloudProvider（先用通用端点验证）
- [x] 真机/模拟器构建 APK：`cd android && ./gradlew assembleDebug`（BUILD SUCCESSFUL，9m57s）
- [x] 文本语音输入：ChatScreen 文本路由统一走 handleUserTextInput（空闲=新任务 / 运行中=修正或停止），AgentLoop 决策边界注入修正并强制刷新感知
- [x] metro.config.js：修复 file: 外部依赖的 Metro 解析，release 打包成功
- [x] Release APK（内嵌 JS，debug 签名）：app-release.apk（116.6MB）
- [ ] 验收：文字给目标（如"打开设置"）→ agent 自主完成 → 事件流可见

## M2：安全边界

- [ ] device-agent 新增工具 schema：ask_user / verify / query_experience / plan
- [ ] AgentLoop：executeToolCall 敏感门控（sensitive=true → CONFIRM_REQUIRED）
- [ ] AgentLoop：ask_user 确认通道（挂起等待 + 30s 超时 + 语音联动）
- [ ] AgentLoop：hand_over 接管（暂停执行，用户处理后"继续"恢复）
- [ ] 打断通道：InstructionBus（STOP 紧急 / CORRECTION 改向）
- [ ] 边界 A：决策点注入 + 注入前强制刷新感知
- [ ] 自保护：前台检测（agent 自身 UI 时等待）+ prompt 注入防护
- [ ] 验收：敏感操作弹确认；执行中说"改成 X"影响下一步；说"停"立即停止

## M3：上下文治理 + 规划 + 经验接口

- [ ] AgentLoop 历史事件消费后移图（只留文本）
- [ ] 滑动窗口按 token 预算收缩 + 窗口外摘要压缩
- [ ] TaskPlanner 重规划通道（replan with priorResults + screenState）
- [ ] plan 工具接入 AgentLoop（模型可多次调用）
- [ ] query_experience stub 工具（恒 found=false，契约冻结）
- [ ] buildPrompt 注入段：用户修正 / 经验先验
- [ ] 验收：长任务上下文不膨胀；计划中途可修订；经验查询返回空不影响决策

## M4：模型配置化 + 设置页

- [ ] ModelPreset：zhipu / bailian / volcengine / openai / anthropic / custom / local
- [ ] capabilities 声明（vision / tool_calling / native_planning）接入运行时自适应
- [ ] 设置页：预设下拉 + base_url / api_key / model + 加密存储
- [ ] 语音设置：ASR/TTS provider 选择
- [ ] 验收：切换任意预设不改代码即可运行

## 非目标（本阶段不执行）

- 链路 A：录制 → 异步分析 → 经验库（仅保留 query_experience 接口）
- 多 agent / 子代理
- Google Play 发布合规（先侧载 / F-Droid）

## Context

豆泡当前以单个前台 React Native WebView 实现九个 browser action，并把 browser 页面变化复用为手机 UI effect。OpenMinis 使用独立的最多三标签 WebView 会话，提供二十二个 action、DOM/正文/滚动采集能力，并只在显式 screenshot 时把图片作为模型输入。豆泡现有工具调用与历史协议必须保持兼容，且网页内容仍属于不可信数据。

## Goals / Non-Goals

**Goals:**

- 对齐 OpenMinis Android `browser_use` 的 action 集合与关键参数语义。
- 让浏览器默认通过结构化 DOM/文本结果驱动模型，显式截图可靠进入视觉请求。
- 将浏览器页面状态、标签页和进展指纹从手机无障碍屏幕状态中分离。
- 保留现有 action 名称和稳定 `ref` 作为向后兼容扩展。
- 通过单元测试覆盖 schema、会话路由、脚本生成、图片提取和观察调度。

**Non-Goals:**

- 不复制 OpenMinis 的 `minis://` 文件系统和 shell offload 集成。
- 不绕过现有风险确认、网络地址限制或 Android WebView 安全模型。
- 不承诺桌面浏览器扩展、DRM、Google WebView 登录或反自动化站点兼容。

## Decisions

### 1. 规范 action 与兼容别名并存

工具 schema 暴露 OpenMinis 的规范 action；`page_info`、`read_page`、`wait_for_stable` 继续解析并分别映射到 `get_page_info`、`get_readable`、`wait_for_dom_stable`。这样新任务获得能力对齐，已有历史和测试不被破坏。

### 2. BrowserHost 管理最多三个真实 WebView tab

每个 tab 保留独立 WebView ref、URL、标题、加载状态和 pending navigation/evaluation。SessionController 负责 action 分派和 selected tab；Host 只负责具体 WebView 生命周期。相比在单 WebView 中切换 URL，真实多 WebView 能保留页面 DOM、滚动位置和站点会话。

### 3. 浏览器结果携带原生观察元数据

所有结果包含 action、实际 `tab_id`、`pageURL` 和必要的 DOM/滚动数据。AgentLoop 对 browser action 不执行手机树 settle；熔断器使用工具结果中的 URL、DOM/scroll fingerprint 判断进展。浏览器不再暴露 `_changesScreen` 给模型。

### 4. 图片使用 ToolResult 的独立 observationImage 通道

`screenshot` 捕获当前 WebView 可见区域（现阶段使用宿主前台的原生截图通道），返回 path/base64/mimeType。AgentLoop 从工具结果提取该图片作为下一轮 `generateWithVision` 输入，但在历史格式化和日志中移除 base64。普通 navigate/click/type/scroll 不自动向模型附图。

### 5. DOM 骨架与稳定 ref 互补

`get_backbone` 输出紧凑层级、可访问名称、状态、selector 与稳定 ref；`find_elements` 同时支持 CSS selector 和语义 query，并匹配 text、aria、placeholder、id、name、type、href。交互优先 ref，selector 和坐标作为兼容后备。

### 6. 高风险能力限制在当前页面会话

`execute_js` 在当前页面异步执行并限制输出长度/超时；`fetch` 只接受允许的 http/https URL并限制下载大小；Cookie action 仅作用于当前站点，结果避免写入普通任务日志。外部副作用仍由现有 `confirm_action` 规则约束。

### 7. 滚动返回已完成状态

基础滚动采用确定性位置更新并等待至少一个渲染帧，返回 before/after/height。`scroll_and_collect` 在单次工具调用中多次滚动、等待和去重，避免每屏一次模型推理。

## Risks / Trade-offs

- [三个 WebView 增加内存占用] → 限制最多三个 tab，关闭时立即卸载，隐藏 tab 不参与交互。
- [截图仍依赖 Android 屏幕捕获授权] → 返回明确失败；DOM action 完全不依赖截图，并保留后续替换为原生 View capture 的接口。
- [任意 JavaScript 和 Cookie 具有安全风险] → 仅当前 tab、超时/长度限制、日志脱敏，并沿用敏感操作确认边界。
- [网页脚本可改变 DOM 导致 ref 失效] → ref 失败返回结构化错误与重新 inspect 的 hint。
- [完整能力一次改动范围较大] → 按类型/schema、会话、DOM、图片/AgentLoop、验证分层提交任务并保持兼容测试。

## Migration Plan

1. 扩展类型和 schema，同时保留旧 action。
2. 将单 WebView host 迁移为 tab-aware host，并让原有单 tab 测试继续通过。
3. 增加 DOM、会话和高级 action。
4. 接入图片工具结果与浏览器观察调度。
5. 运行 Jest、TypeScript、release 构建和真机回归；若出现问题，可禁用新增 action 而不影响旧 action。

## Open Questions

- 后续是否增加不依赖 MediaProjection 的 Android 原生 WebView `draw(Canvas)` 截图模块；本次先保证现有截图结果真实进入模型。
- Cookie 原始值是否需要增加加密 offload 文件通道；本次仅在显式调用结果中返回，并确保日志脱敏。

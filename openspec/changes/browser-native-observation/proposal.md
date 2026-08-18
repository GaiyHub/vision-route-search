## Why

豆泡内置浏览器目前仅覆盖基础导航与少量 DOM 操作，且截图未作为图片工具结果传给模型、浏览器页面变化与手机 UI 变化混用，导致模型在复杂网页中反复试探、猜 selector 或执行无效视觉调用。需要以 OpenMinis Android 的 `browser_use` 为基准完成能力与关键运行语义对齐。

## What Changes

- 将豆泡 `browser_use` 动作集合对齐 OpenMinis：导航、截图、点击、输入、文本与正文读取、页面信息、元素查找、DOM 骨架、滚动与滚动采集、DOM 稳定等待、脚本执行、悬停、UA/视口设置、资源抓取、标签页和 Cookie 管理。
- 保留现有 `page_info`、`read_page`、`wait_for_stable` action 作为兼容别名，新增 OpenMinis 对应的规范 action 名称。
- 引入最多三个标签页的浏览器会话，并让每次结果返回实际执行的 `tab_id` 与页面 URL。
- 将显式浏览器截图作为真正的模型图片输入返回；页面变化后的轻量快照只服务 UI 预览，不自动消耗视觉 Token。
- 将浏览器 DOM/page 状态与手机前台 UI 观察分离，浏览器 action 不再依赖模型填写 `_changesScreen`，也不触发无意义的手机无障碍树稳定和整屏截图。
- 增强结构化 DOM 提取、元素语义字段、滚动完成反馈和无限列表采集，减少视觉兜底和额外模型轮次。
- 对脚本、Cookie、下载与私网访问保持明确安全边界，并为外部副作用继续使用现有确认机制。

## Capabilities

### New Capabilities

- `browser-capability-parity`: 豆泡内置浏览器与 OpenMinis browser 的动作集合、结构化返回、标签页、图片回传和浏览器原生观察语义。

### Modified Capabilities

<!-- None. -->

## Impact

- 主要影响 `guidedog-agent/src/browser/` 的类型、WebView host、脚本与会话控制器。
- 影响 `AgentToolkit`、`AgentLoop` 和 provider 消息构造，使工具结果可携带浏览器图片并采用浏览器原生进展信号。
- 需要扩展 browser 单元测试、AgentLoop 图片工具结果测试和 Android 真机验收。
- 不新增第三方运行时依赖；保持现有手机 UI 工具协议兼容。

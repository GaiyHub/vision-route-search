# 安卓设备实时镜像能力图

## 目标

在现有 `evaluator` 本地 Web 应用顶部提供常驻的“同步真机演示”入口。只要设备已被本机 ADB 识别并处于 `device` 状态，用户即可通过可拖拽悬浮窗选择设备并低延迟查看实时画面；该能力不依赖评测集、评测 Run、豆泡 APK 或其他业务 App。

## 能力拆分

| 模块 ID | 职责 | 复用的现有实现 | 依赖 |
| --- | --- | --- | --- |
| `adb-device-registry` | 发现并持续跟踪 ADB 设备，提供通用设备状态、元数据和连接事件。 | `evaluator/src/adb/adbClient.ts`、`evaluator/src/adb/devices.ts`、`ProcessAdapter` | — |
| `android-screen-capture` | 管理 `scrcpy-server` 的临时部署、启动、停止与清理，并向上游提供 H.264 画面流。 | ADB 进程调用与超时处理 | `adb-device-registry` |
| `web-stream-gateway` | 管理镜像 Session、WebRTC 信令、H.264 转发、订阅复用和断线回收。 | Fastify 本地服务与统一错误结构 | `android-screen-capture` |
| `device-mirror-console` | 提供顶部常驻入口、设备列表、可拖拽实时播放器、全屏、横竖屏和重连交互。 | React、Vite 与现有 WebUI 视觉基础 | `adb-device-registry`、`web-stream-gateway` |

## 依赖与实现顺序

```text
adb-device-registry
→ android-screen-capture
→ web-stream-gateway
→ device-mirror-console
```

## 已确认假设

- 功能集成在现有 `evaluator` 评测平台中，通过顶部常驻按钮打开悬浮窗，不依赖评测流程。
- 任意出现在 `adb devices` 且状态为 `device` 的安卓真机或模拟器均可进入镜像流程。
- 安卓端不安装持久 APK；允许通过 ADB 临时推送并运行 `scrcpy-server`，会话结束后清理。
- 默认使用 USB ADB；设备已通过无线 ADB 连接时也可使用。
- 首期只同步画面，不包含音频、录像和反向控制。
- 画面采用 H.264；PC Bridge 不进行无必要的二次转码，通过 WebRTC 交付浏览器。
- 首期支持现代 Chrome 和 Edge；Safari、Firefox 不作为发布卡点。
- 服务默认只监听 `127.0.0.1`，不包含公网远程访问。
- 每台设备最多运行一个采集 Session，多个页面订阅时复用同一画面源。

## 整体成功指标

- USB 连接的目标测试设备稳定达到 25～30 FPS。
- USB 场景端到端画面延迟 P95 不高于 200 ms。
- 从请求启动镜像到浏览器出现首帧不超过 2 秒。
- 连续运行 30 分钟无非预期断流、进程泄漏或设备不可恢复占用。
- USB 拔出、ADB 重启、浏览器关闭和服务退出后能够终止或回收对应资源。

## 范围边界

### 本期包含

- ADB 设备自动发现与连接状态展示。
- 多设备列表和单设备镜像 Session。
- H.264 实时画面采集及 WebRTC 浏览器播放。
- 顶部常驻入口、可拖拽悬浮窗、缩放、全屏和横竖屏适配。
- Session 复用、断线提示、资源清理和有限自动恢复。

### 本期不包含

- 安卓端持久安装 App。
- 音频同步、完整录像和远程触控。
- 公网访问、跨主机 Local Agent 和 SFU 大规模分发。
- 绕过 DRM、`FLAG_SECURE` 或系统安全限制。
- iOS 设备支持。

## 边界规则

- 模块 ID 为稳定标识，后续 Spec、Plan、Tasks 和目录命名必须沿用。
- `adb-device-registry` 是通用设备事实来源，不包含豆泡安装状态、评测接口版本或评测就绪判断。
- 现有评测专用 `GET /api/devices` 保持兼容；镜像能力使用新增的 `/api/android/devices` 资源。
- 所有 ADB 设备命令必须显式携带 serial，不得依赖默认设备。
- 浏览器不得直接访问 ADB；设备访问和采集只发生在本地后端。
- 镜像能力不得修改豆泡 APK、Manifest、业务配置、账号、聊天记录、Agent状态或评测数据，不得启动、停止、重启、清理或注入豆泡进程。
- 首期镜像为只读画面能力，不注入触控、按键、剪贴板或其他输入事件；临时采集文件只能写入 ADB shell 可控的临时目录，并在会话结束后清理。
- 实时采集的设备资源影响必须受单设备单 Session、分辨率、帧率和码率上限约束；无订阅者时必须停止采集。
- 依赖只按图中方向流动，Provider 模块负责定义跨模块契约。

## 主链路隔离要求

- 未启动镜像 Session 时，除设备发现和只读元数据查询外，不在安卓设备上运行长生命周期进程。
- 启动镜像 Session 不得改变豆泡前后台状态、当前 Activity、任务栈、应用数据和系统授权。
- 停止或异常终止镜像后，豆泡必须保持原有运行状态；不得以重启豆泡作为恢复手段。
- 镜像开启前后，豆泡核心功能回归集必须保持通过；出现新增崩溃、ANR、明显交互卡顿或业务状态变化时禁止发布。
- 无法保证所有设备上的绝对零资源影响；必须通过性能预算与真机验证将编码带来的 CPU、内存、耗电和热影响控制在可接受范围。

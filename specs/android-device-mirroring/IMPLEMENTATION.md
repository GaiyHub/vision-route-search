# 安卓设备实时镜像实施说明

## 当前实现

- WebUI 顶部提供手机图标入口，以可拖拽悬浮窗展示 ADB 设备列表和实时画面，并可跨平台内部页面持续显示。
- 本地后端临时推送并启动 `scrcpy-server`，采集 H.264 视频；`ffmpeg` 仅完成 RTP 封装，不进行视频转码；`werift` 负责 WebRTC 信令和媒体发送。
- 同一设备复用一个底层采集 Session，每个页面持有独立订阅；客户端 ID 用于幂等创建订阅，最后一个订阅释放 5 秒后回收采集进程、ADB 转发和临时文件。
- ADB 转发使用本功能专属 `scid` 和 socket 名称；新 Session 启动前清理同设备遗留的本功能进程和转发，避免开发服务异常退出后占用资源。
- WebRTC 协商、连接或首帧失败时，播放器自动降级为截图模式，并保留失败原因。

## 已实现 API

```text
GET    /api/android/devices
GET    /api/android/devices/:serial/frame
POST   /api/android/mirror-sessions
POST   /api/android/mirror-sessions/:sessionId/peer-connections
DELETE /api/android/mirror-sessions/:sessionId/subscriptions/:subscriptionId
```

请求和响应均使用 `schemaVersion: 1`，设备 serial、Session ID、订阅 ID 和 SDP 在服务边界执行严格校验。

## 当前媒体参数

```text
codec: H.264
maxSize: 1024
maxFps: 30
videoBitRate: 4 Mbps
keyframeInterval: 1 s
audio: disabled
```

## 真机验证

- 设备：`M2011K2C`，Android 13，USB ADB。
- 浏览器成功收到 `460 × 1024` 视频，`readyState = 4`，首帧实测不超过 `2.6 s`。
- 关闭悬浮窗会释放 WebRTC 订阅；空闲期结束后回收采集资源。

## 后续验收项

- 端到端延迟 P95、稳定帧率和 30 分钟长稳测试。
- USB 拔出、ADB 重启、横竖屏切换和多设备并行场景。
- 悬浮窗缩放、收起和全屏交互。

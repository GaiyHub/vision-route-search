# 豆泡批量评测台

PC 端本地 WebUI，通过 ADB 驱动用户已安装的普通豆泡 APK。评测以“评测计划”为入口，执行记录、样本 Attempt、标准化轨迹、确定性断言、LLM-as-Judge 结果和整体报告均按计划运行隔离保存。

## 启动

```bash
npm install
npm run dev
```

- WebUI：`http://127.0.0.1:5173`
- 本地 API：`http://127.0.0.1:4174`
- `DOUPAO_EVALUATOR_RUNTIME=mock npm run dev` 可使用 Mock 设备。
- `DOUPAO_EVALUATOR_DATA_DIR` 可修改评测数据目录，默认使用 `evaluator/.data`。

## 查看手机实时画面

页面顶部手机图标可打开可拖拽的真机画面悬浮窗。该能力通过 ADB 临时运行 `scrcpy-server`，将 H.264 码流无转码封装为 RTP，并通过 WebRTC 交给浏览器播放；不安装额外 APK，也不修改豆泡应用数据。WebRTC 不可用时自动降级为按需截图。

宿主机需安装并可直接执行 `adb`、`scrcpy` 和 `ffmpeg`。macOS 可执行：

```bash
brew install android-platform-tools scrcpy ffmpeg
```

可通过 `ADB_PATH`、`SCRCPY_PATH`、`SCRCPY_SERVER_PATH` 和 `FFMPEG_PATH` 指定非默认安装位置。同一设备只启动一条底层采集流，多个页面订阅复用；最后一个订阅释放 5 秒后停止进程并清理临时文件与端口转发。

## LLM-as-Judge

可在 WebUI 的 `Judge` 页面配置 OpenAI-compatible Provider 并测试连接。API Key 只保存在后端进程内存，不写入浏览器存储、运行数据、轨迹或报告；后端重启后需重新输入。也可通过环境变量启动：

```bash
DOUPAO_JUDGE_BASE_URL=https://example.com/v1 \
DOUPAO_JUDGE_MODEL=judge-model \
DOUPAO_JUDGE_API_KEY=secret \
npm run dev
```

可选变量：`DOUPAO_JUDGE_TIMEOUT_MS`、`DOUPAO_JUDGE_SUPPORTS_IMAGES=true`。计划启用 Judge 且包含 Judge 样本时，配置未就绪会阻止计划启动。

## 校验

```bash
npm run typecheck
npm test
npm run build
```

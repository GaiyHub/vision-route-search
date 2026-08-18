<div align="center">

# 豆泡（DouPao）· Android 手机智能体

**用自然语言控制你的手机 —— 感知屏幕、规划动作、替你完成任务**

[![Platform](https://img.shields.io/badge/platform-Android%20API%2030%2B-green.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![React Native](https://img.shields.io/badge/React%20Native-0.81-61dafb.svg)](#)

</div>

豆泡是一个运行在 Android 手机上的智能体（Agent）应用。对它说出任务——例如"帮我在支付宝找到充水费的入口"——它会阅读屏幕（无障碍树 + 截图）、由大模型规划每一步动作、通过无障碍服务执行点击/输入/滑动，循环往复直到任务完成。本地模型（Gemma）支持完全离线运行，云端模型（Qwen 系列）用于复杂任务。

设计理念：端侧原生、视觉优先、多轮对话干预、风险操作管控、长程任务支持
---

## 主要功能

- **自然语言任务执行**：ReAct 循环（观察 → 思考 → 行动），支持 20+ 手机操作工具（tap、swipe、type_text、open_app、find_node、wait_for_node 等）
- **双通道屏幕感知**：无障碍树提供精确节点坐标（对风控类应用更可靠），视觉截图做多模态兜底；截图时机对齐"无障碍树稳定"时刻，保证模型看到的是最新画面
- **双模型引擎**：云端 LLM（Qwen，OpenAI 兼容端点）与本地 Gemma（ExecuTorch 推理）双通道，云端优先/本地优先可配置，云端不可用时自动降级本地
- **计划模式**：复杂任务先由 LLM 分解为子任务（TaskPlanner），逐个子任务执行并跟踪 TodoList
- **任务完成确认**：任务结束前弹出确认（悬浮窗/通知多通道），模型判断"未完成"则继续执行，防止误报完成
- **技能（Skills）系统**：把可复用的操作流程固化为技能文件，Agent 可按需读取执行；配套经验库两级召回
- **语音交互**：Whisper 语音输入（STT）+ TTS 播报执行结果
- **Watchdog 定时巡检**：`/watch every 5m: <条件>` 定时检查屏幕状态并在条件满足时通知（前台服务保活，重启后自动恢复）
- **悬浮窗执行面板**：实时显示当前动作与步数，可随时停止
- **任务历史与收藏**：历史会话可回看，常用指令以胶囊形式一键复用
- **隐私友好**：默认不留存任何截图到本地相册（可选项配置），本地模型全程离线

## 工作原理

```
用户指令
  │
  ▼
agentBridge ──► AgentLoop（ReAct 循环，最多 N 步）
                   │
   ┌───────────────┼───────────────────┐
   ▼               ▼                   ▼
 观察            思考                行动
 无障碍树      CloudProvider       PhoneTools
 (Kotlin)        (Qwen)                │
   +           ⇄ 降级/兜底              ▼
 截图           GemmaProvider     react-native-
 (树稳定后        (本地 ExecuTorch)  accessibility-
  截最新图)                          controller
                                   (无障碍手势/事件)
```

1. 用户输入任务（文字或语音）
2. AgentLoop 读取当前屏幕：无障碍树（结构化节点 + 坐标）与截图（JPEG，双通道任一可用即可工作）
3. 大模型结合系统提示词与当前屏幕，输出下一步动作（工具名 + 参数）
4. 动作经无障碍服务执行（对支付宝等风控应用，工具内部做 nodeId 位置感知匹配，避免宫格点击错位）
5. 等待屏幕稳定后再次观察，循环至 `task_complete` 或步数/时间上限

## 核心设计

### 双通道感知协同
- **无障碍树优先**：带 nodeId 的可交互元素优先用 nodeId 操作（比裸坐标更抗布局变化）；MIUI 上按 `isActive/isFocused` 窗口读树，避免误读桌面层
- **视觉兜底**：树为空或截图更直观时由视觉模型判断；截图通道为"无障碍截图 → MediaProjection VirtualDisplay"两段式，MIUI 5 秒限流会自愈重试，无新帧直接失败（绝不回退过期缓存帧）

### 双模型 Provider 链
`CloudFirstFallbackProvider` / `DualModelProvider` / `FallbackProvider` 组合：云端超时、限流或不可达时自动切换本地 Gemma；思考模式（thinking）开关、重试、Token 预算均按 Provider 自适应。

### 稳定性防御
- **往返点击熔断**：模型在同一坐标反复点击时强制干预
- **JS 线程冻结防护**：MIUI 后台冻结场景下用四档定时器兜底，任务循环不静默死亡
- **后台保活**：MediaProjection 前台服务持有会话（MIUI 冻结豁免），授权 token 一次复用、会话静默撤销时自愈重建

### 轻量状态管理
无 Redux/Zustand：`src/store/` 下全部为轻量 pub/sub（`Set<listener>` + AsyncStorage 持久化），Agent 循环内同步读、无异步等待。

## 目录结构

```
vision-route-search/
├── guidedog-agent/                      # 豆泡 App（React Native + Expo）
│   ├── App.tsx                          # 根组件：onboarding 门禁 + 三个主 Tab
│   ├── app/
│   │   ├── chat/ChatScreen.tsx          # 聊天界面（输入/语音/最近指令胶囊）
│   │   ├── history/HistoryScreen.tsx    # 历史任务会话
│   │   ├── settings/SettingsScreen.tsx  # 模型/云端 API/循环参数/留存等设置
│   │   └── onboarding/                  # 引导：无障碍权限、悬浮窗、模型下载
│   ├── src/
│   │   ├── agent/                       # agentBridge、llmBridge、watchdog、OTel 日志
│   │   ├── device-agent/
│   │   │   ├── agent/AgentLoop.ts       # ReAct 主循环（观察-思考-行动）
│   │   │   ├── agent/TaskPlanner.ts     # 计划模式子任务分解
│   │   │   ├── agent/TodoList.ts        # 子任务跟踪
│   │   │   ├── tools/PhoneTools.ts      # 20+ 手机操作工具
│   │   │   └── providers/               # 云端/本地 Provider 链
│   │   ├── components/AgentOverlay.tsx  # 悬浮窗执行面板
│   │   ├── store/                       # 轻量 pub/sub 状态仓库
│   │   └── voice/                       # STT/TTS
│   └── android/                         # Android 工程（构建入口）
├── react-native-accessibility-controller/   # 核心 RN 库（豆泡自研）
│   ├── src/                             # TS API：读树/截图/手势/投影
│   └── android/src/main/java/...        # Kotlin 实现：
│       ├── AccessibilityControllerService.kt   # 无障碍服务
│       ├── ScreenReader.kt              # 窗口选择 + 树遍历
│       ├── AccessibilityControllerModule.kt    # 手势/截图/MediaProjection
│       └── ...
└── openspec/                            # 开发规范与变更提案（openspec 工作流）
```

## 快速开始

### 环境要求
- Node.js ≥ 18、Android 真机（API 30+，推荐 MIUI 需额外配置省电豁免）
- macOS 构建环境（Android SDK + JDK）

### 安装依赖

```bash
cd guidedog-agent
npm install
```

> `react-native-accessibility-controller` 与 `react-native-executorch` 通过 `file:` 本地路径引用，需与仓库目录保持同级（`react-native-executorch` 位于上一级目录）。

### 构建与装机

```bash
cd guidedog-agent/android
./gradlew app:assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

### 设备配置（首次）
1. 启动豆泡，按引导开启**无障碍服务**（DouPaoAgent）与**悬浮窗权限**
2. 建议关闭电池优化（MIUI：应用信息 → 省电策略 → 无限制），否则后台任务会被冻结
3. 首次使用本地模型时按引导下载 Gemma 模型

### 已知设备坑（MIUI）
- 重装 APK 后无障碍服务会被系统移除，重新开启后若一直不绑定（`Bound services` 为空），**重启手机**即可恢复
- MIUI 禁止 ADB 写入无障碍设置（`WRITE_SECURE_SETTINGS` 被拒），必须手动在系统设置里开启
- 无障碍截图有 5 秒限流（自愈重试已内置），MediaProjection 授权一次后复用

## 配置

在"设置"页可配置：模型（本地 E2B/E4B 或云端）、云端 API 地址与 Key、工具预设（full/navigation/read_only 等）、视觉模式、思考模式、计划模式、最大步数、超时、截图留存（默认关闭）等。

## 参考与致谢

本项目参考了以下开源工作的思路与设计：

- [MobileAgent](https://github.com/X-PLUG/MobileAgent) —— 移动端感知-规划-执行智能体范式
- [deft](https://github.com/bedda-tech/deft) —— 豆泡 App 层基于其改造（原版 README 见 `guidedog-agent/README.md`）
- [Open-AutoGLM](https://github.com/zai-org/Open-AutoGLM) —— 支持应用清单参考
- [react-native-executorch](https://github.com/software-mansion/react-native-executorch) —— 本地 LLM 推理引擎

## License

MIT

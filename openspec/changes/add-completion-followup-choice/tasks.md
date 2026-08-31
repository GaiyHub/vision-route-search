## 1. Completion state and bridge

- [x] 1.1 Represent decision and supplemental-input phases without settling the active completion resolver
- [x] 1.2 Route 完成, 继续, valid supplement submission, return, timeout, and stop through single-settlement behavior
- [x] 1.3 Validate supplemental input and inject it as attributed user continuation context

## 2. User interface

- [x] 2.1 Present 完成, 继续, and 补充信息 in the primary completion dialog
- [x] 2.2 Add the supplemental text-entry phase with validation, character count, return, and submit controls
- [x] 2.3 Keep notification and overlay fallback behavior compatible with the three-way primary dialog

## 3. Verification and delivery

- [x] 3.1 Add store and bridge tests for phase transitions, validation, timeout, and single settlement
- [x] 3.2 Add UI-focused coverage for the three choices and supplemental submission behavior
- [x] 3.3 Run type checking and focused/full tests, validate the OpenSpec change, and build a release APK
- [ ] 3.4 Install the release APK and verify the completion dialog on device
- [x] 3.5 Prevent blank decision-button labels when returning from an empty supplemental-input phase, then rerun regression checks

## 4. 外部 App 原地输入

- [x] 4.1 在 Android 悬浮层增加可聚焦文本输入模式、校验、提交与返回交互
- [x] 4.2 将完成补充信息接入原地输入，并复用既有消息与 continuation 处理
- [x] 4.3 将 ask_user 接入同一输入弹窗，并保留跳回豆泡的失败降级
- [x] 4.4 增加回归测试、执行完整验证、构建 release APK 并装机

## 5. UI 工具悬浮窗隔离

- [x] 5.1 在 AgentToolkit 统一执行入口识别手机 UI 工具并集中暂停、恢复悬浮窗
- [x] 5.2 覆盖 UI 工具正常、失败恢复和非 UI 工具不受影响的回归测试
- [x] 5.3 执行类型检查、测试、OpenSpec 校验并构建安装 Release APK

## 6. 运行态悬浮窗默认位置

- [x] 6.1 将 App 与原生悬浮窗默认位置统一为状态栏下方的屏幕顶部中央
- [x] 6.2 确认拖动、屏幕边界约束和门控弹窗居中行为不回退
- [x] 6.3 执行类型检查、测试、OpenSpec 校验并构建安装 Release APK
- [x] 6.4 根据用户反馈将默认位置调整为导航栏上方的屏幕底部中央
- [x] 6.5 重新执行类型检查、测试、OpenSpec 校验并构建安装 Release APK

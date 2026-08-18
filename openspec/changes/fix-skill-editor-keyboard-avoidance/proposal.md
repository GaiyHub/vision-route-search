## Why

经验编辑页的正文输入框位于页面下方。Android 软键盘弹出后，当前页面没有可靠地缩小并滚动到实际可视区域，导致正在编辑的内容被输入法遮挡。

## What Changes

- 让经验编辑页在 Android 和 iOS 上都明确响应软键盘高度变化。
- 聚焦名称、描述或正文时，将对应输入框滚动到键盘上方的可视区域。
- 为滚动内容保留键盘态底部空间，确保正文末尾可编辑且页面操作仍可到达。

## Capabilities

### New Capabilities

- `skill-editor-keyboard-avoidance`: 规定经验编辑页在软键盘显示时保持聚焦输入框及其编辑内容可见。

### Modified Capabilities

无。

## Impact

- 主要影响 `guidedog-agent/app/settings/SkillsScreen.tsx` 的编辑页布局和聚焦滚动逻辑。
- 不改变经验存储格式、agent 行为或公开 API，不新增运行时依赖。

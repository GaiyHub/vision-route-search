## Context

经验编辑器是设置页内的全屏子视图，外层 Activity 已配置 `adjustResize`。当前 `KeyboardAvoidingView` 仅在 iOS 指定行为；Android 依赖窗口缩放后，聚焦处理只把字段顶部滚到固定偏移，无法保证光标或输入框底部落在缩小后的可视区域内。

## Goals / Non-Goals

**Goals:**

- 键盘出现时缩小编辑器可用高度。
- 聚焦任意经验字段时，保证输入框进入键盘上方的可视区域。
- 正文很长或光标位于正文末尾时仍可继续编辑。

**Non-Goals:**

- 不重做经验编辑器视觉样式。
- 不改变全局 Activity 的软键盘模式。
- 不引入第三方键盘管理库。

## Decisions

1. 在 Android 上为 `KeyboardAvoidingView` 使用 `height` 行为，iOS 保持 `padding`。这使布局对键盘高度变化有明确响应，同时保留现有 `adjustResize` 配置。
2. 用 React Native `ScrollView` 的 `scrollResponderScrollNativeHandleToKeyboard` 根据原生输入框句柄和当前可视区域执行聚焦滚动，而不是依赖字段初始 y 坐标。该 API 会按输入框真实位置计算所需滚动距离。
3. 编辑器滚动容器启用自动键盘 inset（iOS）并增加可伸展的内容容器，避免正文末尾没有足够滚动空间。

## Risks / Trade-offs

- [部分 Android 输入法上窗口缩放与 `height` 行为可能重复响应] → 保留 Activity 的标准 `adjustResize`，并用真机 release 包验证；如出现双重收缩可仅依赖 `height` 的实际布局结果调整行为。
- [原生句柄在首次 focus 时布局尚未稳定] → 将滚动安排到键盘动画后的短延迟，并在组件卸载时清理定时器。

## Migration Plan

仅包含前端布局修改；发布新 APK 即生效，回滚该组件改动即可恢复旧行为。

## Open Questions

无。

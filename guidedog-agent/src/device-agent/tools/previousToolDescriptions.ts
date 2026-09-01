/**
 * Rollback snapshot captured before the capability-oriented description
 * cleanup on 2026-08-30. These values are not injected into model context.
 */
export const PREVIOUS_TOOL_DESCRIPTIONS_2026_08_30 = Object.freeze({
  ui_fill:
    '定位输入框并替换其中的文本；优先直接写入而不弹出输入法，仅在控件拒绝直接写入或提交时自动聚焦重试。可用 submit=true 随后执行一次 IME 提交。已知输入框文字、内容描述或资源 ID 时直接使用对应模式，无需先查询节点、点击输入框或单独输入；focused 模式用于已经聚焦的输入框。高风险最终提交须先获得授权。',
  clipboard_set:
    '将文本写入 Android 系统剪贴板，只改变剪贴板内容，不点击界面或提交输入。适合随后长按不支持无障碍文本设置的自定义输入区域，并从系统菜单选择粘贴。',
  browser_screenshot:
    '截取内置浏览器当前页面；仅在视觉布局、图像或 DOM 无法表达的内容确有必要时使用。',
});

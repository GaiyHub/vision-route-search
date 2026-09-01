import type { Tool } from '../types';

/**
 * Default tool set for phone control.
 *
 * These tools map directly to react-native-accessibility-controller APIs
 * and are provided to the LLM so it can decide which actions to take.
 */
export const PHONE_TOOLS: Tool[] = [
  {
    name: 'ui_inspect',
    description:
      '轻量读取当前 Android 无障碍结构，不包含屏幕图像。返回可见节点的文字、内容描述、控件状态、边界、短期 ref 和 observationId，适用于读取页面文字、定位标准控件，以及判断 selected、checked、enabled 等结构状态。',
    uiEffect: 'none',
    parameters: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'string',
      description: '以 observationId 开头的当前界面结构文本，包含可见节点的短期 ref、文字、控件状态和边界；界面变化后其中的 ref 和坐标失效。',
    },
  },
  {
    name: 'ui_dump_raw_tree',
    description:
      '按需采集当前 Android 原始无障碍树，不过滤不可见、无标签或不可交互节点，并以 index、parentIndex、depth 保留层级。仅用于轻量树或语义查找与截图矛盾时诊断；结果可能很大并分页保存。',
    uiEffect: 'none',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ui_screenshot',
    description:
      '获取当前手机屏幕图像和 observationId，同时返回采集时的 Android 无障碍结构。适用于所需信息依赖无标签图标、图片、自定义绘制区域、颜色、视觉样式或坐标定位的场景。调用会产生额外的图像传输和推理延迟。全局 OCR 增强开启时会自动补充截图中文字及其视觉坐标。截图坐标空间统一为 0～1000：左上角为 (0,0)，右下角为 (1000,1000)。无障碍节点和 OCR 文字都使用短期 ref，可直接交给 ui_tap 的 ref 模式；工具内部处理不同来源。豆泡主 App 在前台时不采集。',
    uiEffect: 'none',
    parameters: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      description: '截图成功后的结构化数据；截图图像通过独立 observationImage 附件传输，不进入 data。',
      properties: {
        captured: { type: 'boolean', description: '截图是否已成功采集。' },
        observationId: { type: 'string', description: '本次截图及同帧结构观察的标识。' },
        coordinateSpace: {
          type: 'string',
          enum: ['normalized_1000'],
          description: '视觉图像位置的坐标空间；水平和垂直方向均为 0～1000。',
        },
        accessibility_tree: { type: 'string', description: '与截图近似同帧采集的无障碍结构。' },
        accessibility_tree_status: {
          type: 'string',
          enum: ['timeout', 'rejected'],
          description: '辅助结构采集未正常完成时的状态；正常完成时省略。',
        },
        ocr_elements: {
          type: 'array',
          description: '全局 OCR 增强开启时返回的端侧 OCR 文字行，按屏幕位置排序，最多 80 条。ref 是最新观察中的短期引用，可直接用于 ui_tap ref 模式。',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: '本次截图内的临时 OCR 引用。' },
              text: { type: 'string', description: '识别出的文字。' },
              bounds: {
                type: 'object',
                description: '0～1000 归一化边界。',
                properties: {
                  left: { type: 'number' },
                  top: { type: 'number' },
                  right: { type: 'number' },
                  bottom: { type: 'number' },
                },
                required: ['left', 'top', 'right', 'bottom'],
              },
              center: {
                type: 'object',
                description: '0～1000 归一化目标中心，仅用于表达空间位置；点击可直接使用 ref。',
                properties: { x: { type: 'number' }, y: { type: 'number' } },
                required: ['x', 'y'],
              },
            },
            required: ['ref', 'text', 'bounds', 'center'],
          },
        },
        ocr_status: {
          type: 'string',
          enum: ['unavailable', 'timeout', 'failed'],
          description: 'OCR 增强已开启但未获得结果时的状态；正常完成时省略。',
        },
      },
      required: ['captured', 'observationId', 'coordinateSpace', 'accessibility_tree'],
      additionalProperties: false,
    },
  },
  {
    name: 'ui_tap',
    description:
      '点击当前界面目标。ref 可直接使用最新 ui_inspect 或 ui_screenshot 返回的任意短期引用；工具内部自动处理来源：Android 无障碍结构中的 ref 使用节点实时 bounds 中心手势，手势被拒绝时降级到节点动作；OCR ref 使用该观察缓存的文字中心坐标。text、content_description 和 resource_id 用于按无障碍语义定位。coordinate 用于没有 ref 的视觉目标，x、y 固定为 0～1000 归一化坐标并携带该截图的 observationId，工具不会猜测坐标。accepted=true 只表示系统接受了点击派发，工具不会验证页面是否变化。',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: '目标定位方式',
          enum: ['ref', 'text', 'content_description', 'resource_id', 'coordinate'],
        },
        ref: { type: 'string', description: '最新 ui_inspect 或 ui_screenshot 返回的短期目标 ref' },
        x: { type: 'number', minimum: 0, maximum: 1000, description: 'coordinate 模式必填：最新截图中 0～1000 归一化的目标中心 X 坐标' },
        y: { type: 'number', minimum: 0, maximum: 1000, description: 'coordinate 模式必填：最新截图中 0～1000 归一化的目标中心 Y 坐标' },
        observationId: { type: 'string', description: 'coordinate 模式必填：产生 x、y 的 ui_screenshot observationId；界面变化后失效' },
        text: { type: 'string', description: '按 Android 无障碍节点文本原生查找并点击，不识别图像文字' },
        contentDescription: { type: 'string', description: '按节点内容描述原生查找并点击' },
        resourceId: { type: 'string', description: '按 Android 资源 ID 原生查找并点击' },
        matchIndex: { type: 'number', description: '多个语义匹配中的序号，从 0 开始，默认 0' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'ui_fill',
    description:
      '定位输入框并替换其中的文本。支持通过 focused、ref、文本、内容描述或资源 ID 定位；默认直接写入而不弹出输入法，控件拒绝直接写入或提交时会自动聚焦重试。submit=true 时在写入后执行一次 IME 提交。高风险最终提交须先获得授权。',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: '输入框定位方式',
          enum: ['focused', 'ref', 'text', 'content_description', 'resource_id'],
        },
        value: { type: 'string', description: '要写入的文本（替换原内容）' },
        ref: { type: 'string', description: '最新观察中的输入框短期 ref' },
        targetText: { type: 'string', description: '按输入框文本、提示文字或内容描述定位' },
        contentDescription: { type: 'string', description: '按输入框内容描述定位' },
        resourceId: { type: 'string', description: '按 Android 资源 ID 定位输入框' },
        matchIndex: { type: 'number', description: '多个语义匹配中的序号，从 0 开始，默认 0' },
        submit: { type: 'boolean', description: '写入成功后是否执行一次 IME 提交，默认 false' },
      },
      required: ['mode', 'value'],
    },
  },
  {
    name: 'ui_long_press',
    description:
      '长按当前界面元素。ref 使用当前有效节点；coordinate 用于最新截图中的视觉目标，x、y 固定为 0～1000 归一化坐标并携带该截图的 observationId。可用 durationMs 指定按住时长。两种模式互斥。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: '长按目标类型', enum: ['ref', 'coordinate'] },
        ref: { type: 'string', description: '最新观察中的短期节点 ref' },
        x: { type: 'number', minimum: 0, maximum: 1000, description: '最新截图中 0～1000 归一化的目标中心 X 坐标' },
        y: { type: 'number', minimum: 0, maximum: 1000, description: '最新截图中 0～1000 归一化的目标中心 Y 坐标' },
        observationId: { type: 'string', description: '产生该坐标的最新 ui_screenshot observationId' },
        durationMs: { type: 'number', description: '长按持续毫秒数，范围 500–5000，默认 1000；两种模式均可使用' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'clipboard_set',
    description:
      '将文本写入 Android 系统剪贴板，只改变剪贴板内容，不点击界面、粘贴文本或提交输入。适用于无法通过无障碍接口设置文本、但支持系统粘贴的输入区域。',
    uiEffect: 'none',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要写入系统剪贴板的文本' },
      },
      required: ['text'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        written: { type: 'boolean', description: '文本是否已写入系统剪贴板' },
        length: { type: 'number', description: '已写入文本的字符数' },
      },
      required: ['written', 'length'],
      additionalProperties: false,
    },
  },
  {
    name: 'ui_clear_text',
    description:
      '清空 ref 指定或当前聚焦的可编辑字段。省略 ref 时使用当前聚焦输入框。',
    parameters: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: '可编辑字段的短期 ref（可选，省略时自动检测聚焦的输入框）',
        },
      },
    },
  },
  {
    name: 'ui_press_enter',
    description:
      '对 ref 指定或当前聚焦的输入框执行回车或 IME 动作键，可能触发搜索、发送或提交。高风险最终提交须先获得授权。',
    parameters: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: '可编辑字段的短期 ref（可选，省略时自动检测聚焦的输入框）',
        },
      },
    },
  },
  {
    name: 'ui_swipe',
    description:
      '在屏幕两点之间执行精细滑动手势，适合拖动、轮播、滑块或需要精确控制起止位置的场景。',
    parameters: {
      type: 'object',
      properties: {
        startX: { type: 'number', description: '起始 X 坐标' },
        startY: { type: 'number', description: '起始 Y 坐标' },
        endX: { type: 'number', description: '结束 X 坐标' },
        endY: { type: 'number', description: '结束 Y 坐标' },
        durationMs: { type: 'number', description: '持续时长（毫秒，默认 300）' },
      },
      required: ['startX', 'startY', 'endX', 'endY'],
    },
  },
  {
    name: 'ui_scroll',
    description:
      '沿指定方向滚动一个可滚动元素，适合单次普通滚动。distance 支持 short、medium、long，默认 medium；存在多个容器时必须传目标 ref。',
    parameters: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: '可滚动元素的短期 ref（只有一个可滚动容器时可省略）',
        },
        direction: {
          type: 'string',
          description: '滚动方向',
          enum: ['up', 'down', 'left', 'right'],
        },
        distance: {
          type: 'string',
          description: '滚动步长：short 约为容器的 30%，medium 约为 55%，long 约为 80%；默认 medium',
          enum: ['short', 'medium', 'long'],
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'ui_scroll_page',
    description:
      '将长列表或长表格推进接近一个可视区域并保留少量重叠，适合逐页浏览或连续采集。返回最新截图、无障碍树、changed 和 atEdge。',
    parameters: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: '可滚动容器的短期 ref（可选，省略时自动检测；检测不到时使用分页手势）',
        },
        direction: {
          type: 'string',
          description: '内容浏览方向',
          enum: ['up', 'down', 'left', 'right'],
        },
        overlapRatio: {
          type: 'number',
          description: '坐标分页时保留的页面重叠比例，范围 0.1–0.4，默认 0.2',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'open_app',
    description:
      '通过 Android 包名启动应用，并返回 launchAccepted（请求已受理）和 launchConfirmed（目标包已进入前台）。已在前台时直接成功；不知道本机有哪些应用或不确定包名时，先调用 list_apps 获取。',
    parameters: {
      type: 'object',
      properties: {
        packageName: { type: 'string', description: 'Android 包名（如 com.android.settings）' },
      },
      required: ['packageName'],
    },
  },
  {
    name: 'ui_global_action',
    description:
      '执行 Android 系统级导航动作，包括 home、back、recents、notifications、quickSettings 和 powerDialog。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '要执行的系统动作',
          enum: ['home', 'back', 'recents', 'notifications', 'quickSettings', 'powerDialog'],
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'wait',
    description:
      '等待手机界面的异步加载或动画完成，最长等待 ms；检测到屏幕文本变化时提前返回。一次等待仍无变化时适合重新观察或更换策略，不适合连续延长等待。',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: '最长等待毫秒数（默认 1000）' },
      },
    },
  },
  {
    name: 'list_apps',
    description:
      '列出设备上用户可启动的应用，返回 {packageName, label} 数组，适合根据应用名称查询启动包名。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ui_find_node',
    description: '只查询当前无障碍树中的节点并返回 observationId、matchCount 和 matches。每个候选包含 ref、文本、边界、中心坐标、资源 ID 与交互状态，并按匹配精确度排序；唯一命中时还会在顶层返回该节点字段，多于一个候选时 ambiguous=true 且不提供默认顶层 ref。ref、bounds 和 center 仅对当前界面有效。目标明确且下一步就是点击或填写时，直接使用 ui_tap 或 ui_fill，不需要先查询节点。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '匹配节点文本的子串（区分大小写）' },
        contentDescription: { type: 'string', description: '匹配节点内容描述的子串' },
        className: { type: 'string', description: '精确匹配的类名（如 android.widget.Button）' },
        isChecked: { type: 'boolean', description: '按选中状态过滤（true=已选中，false=未选中）' },
        isEnabled: { type: 'boolean', description: '按可用状态过滤（false 用于查找已禁用节点）' },
      },
    },
  },
  {
    name: 'ui_wait_for_node',
    description:
      '按给定特征轮询当前手机无障碍树，节点出现时返回 ref，超过 timeoutMs 时返回 null。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '匹配节点文本的子串（区分大小写）' },
        contentDescription: { type: 'string', description: '匹配节点内容描述的子串' },
        className: { type: 'string', description: '精确匹配的类名（如 android.widget.Button）' },
        isChecked: { type: 'boolean', description: '按选中状态过滤（true=已选中，false=未选中）' },
        isEnabled: { type: 'boolean', description: '按可用状态过滤（false 用于查找已禁用节点）' },
        timeoutMs: { type: 'number', description: '最大等待毫秒数（默认 5000）' },
        intervalMs: { type: 'number', description: '轮询间隔毫秒数（默认 500）' },
      },
    },
  },
  {
    name: 'ui_wait_for_change',
    description:
      '轮询手机屏幕文本是否变化，变化时返回 true，超过 timeoutMs 时返回 false。true 仅表示界面文本发生变化。',
    parameters: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', description: '最大等待毫秒数（默认 5000）' },
        pollIntervalMs: { type: 'number', description: '检查变化的频率（毫秒，默认 500）' },
      },
    },
  },
  {
    name: 'ui_get_node',
    description:
      '按当前有效 ref 一次返回节点的文本、内容描述、资源 ID、类名、边界、中心坐标和交互状态。',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: '要读取属性的短期 ref' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'ui_set_checked',
    description:
      '将当前复选框、开关或单选按钮设为指定布尔状态；工具会校验控件类型和当前值，仅在状态不同时执行切换，并复查最终状态。高风险设置变更须先获得授权。',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: '复选框、开关或切换按钮的短期 ref' },
        checked: { type: 'boolean', description: '目标状态: true 勾选/开启，false 取消勾选/关闭' },
      },
      required: ['ref', 'checked'],
    },
  },
  {
    name: 'task_complete',
    description:
      '仅在手机代操作或外部状态变更已被真实结果确认达成时结束执行，并用 summary 简述完成内容；查询、计算、读取或分析结果直接文字回答。',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '已完成内容的简要总结' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'task_failed',
    description:
      '仅在已尝试可用恢复方式，或用户拒绝继续所必需的条件后，确认无法继续时结束执行；单次工具失败不适用。',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: '任务失败或不可能完成的原因说明' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'write_note',
    description:
      '在当前任务中存储一条命名笔记，适合保存后续步骤需要引用的稳定值；不跨任务共享。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '笔记名称（如 "target_app"、"wifi_node_id"）' },
        value: { type: 'string', description: '要存储的值' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'read_note',
    description:
      '读取之前用 write_note 存储的笔记。返回存储的字符串值；如果不存在该 key 的笔记则返回 null。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '要查找的笔记名称' },
      },
      required: ['key'],
    },
  },
];

/**
 * Named subsets of PHONE_TOOLS for use with `AgentOptions.toolFilter`.
 *
 * Pass one of these arrays (or a custom list) to `toolFilter` to restrict
 * which actions the LLM can take for a given task. `task_complete` and
 * `task_failed` are always included by the agent loop regardless.
 *
 * @example
 * // Read-only analysis — agent can observe but not act
 * new AgentLoop({ provider, toolFilter: PHONE_TOOL_PRESETS.READ_ONLY })
 *
 * // Form-filling — agent can interact with inputs but not navigate freely
 * new AgentLoop({ provider, toolFilter: PHONE_TOOL_PRESETS.TEXT_INPUT })
 */
export const PHONE_TOOL_PRESETS = {
  /** All available tools (default — same as omitting toolFilter). */
  FULL: undefined as string[] | undefined,

  /**
   * Web browsing — Chrome on Android exposes full accessibility trees (headings, links,
   * inputs, tab bar). Keeps the tool list focused on browser controls to reduce token
   * usage and hallucinations on web-only tasks.
   */
  WEB: [
    'ui_inspect',
    'ui_screenshot',
    'open_app',
    'ui_tap',
    'ui_long_press',
    'ui_fill',
    'clipboard_set',
    'ui_press_enter',
    'ui_scroll',
    'ui_scroll_page',
    'ui_find_node',
    'ui_wait_for_change',
  ] as string[],

  /** Read-only analysis only. No device actions are taken. */
  READ_ONLY: ['ui_inspect', 'ui_screenshot', 'list_apps', 'write_note', 'read_note'] as string[],

  /** Navigate the phone: tap, swipe, scroll, open apps, use system buttons. No text input. */
  NAVIGATION: [
    'ui_inspect',
    'ui_screenshot',
    'ui_tap',
    'ui_long_press',
    'ui_swipe',
    'ui_scroll',
    'ui_scroll_page',
    'ui_global_action',
    'open_app',
    'list_apps',
    'ui_find_node',
    'wait',
    'ui_wait_for_node',
    'ui_wait_for_change',
    'ui_get_node',
    'ui_set_checked',
    'write_note',
    'read_note',
  ] as string[],

  /**
   * Fill forms and interact with text fields.
   * Includes tap (to focus fields) but restricts free navigation.
   */
  TEXT_INPUT: [
    'ui_inspect',
    'ui_screenshot',
    'ui_tap',
    'ui_long_press',
    'ui_fill',
    'clipboard_set',
    'ui_clear_text',
    'ui_press_enter',
    'ui_find_node',
    'ui_wait_for_node',
    'ui_wait_for_change',
    'ui_get_node',
    'ui_scroll',
    'ui_scroll_page',
    'write_note',
    'read_note',
  ] as string[],

  /**
   * Fast tool dispatch for FunctionGemma 270M.
   *
   * Contains only the 12 direct-action tools — no search, read, or find tools.
   * Keeps the schema under ~800 tokens so FunctionGemma can prefill within
   * its ≤500ms target at 1,916 tok/s on a Pixel 8.
   *
   * Use this as the toolFilter when constructing a FunctionGemmaProvider:
   *   new AgentLoop({
   *     provider: new DualModelProvider({ ... }),
   *     toolFilter: PHONE_TOOL_PRESETS.DISPATCH,
   *   })
   * Or pass it to FunctionGemmaProvider's generateWithTools by filtering the
   * tools argument before calling the dispatch model.
   */
  DISPATCH: [
    'ui_inspect',
    'ui_screenshot',
    'ui_tap',
    'ui_fill',
    'ui_long_press',
    'ui_swipe',
    'ui_scroll',
    'ui_scroll_page',
    'clipboard_set',
    'ui_clear_text',
    'ui_press_enter',
    'ui_global_action',
    'open_app',
    'wait',
    'task_complete',
    'task_failed',
  ] as string[],

  /**
   * Access the info/settings of a specific app without leaving it.
   * Excludes open_app and global_action (HOME/BACK) to prevent navigating away.
   */
  IN_APP: [
    'ui_inspect',
    'ui_screenshot',
    'ui_tap',
    'ui_fill',
    'ui_long_press',
    'clipboard_set',
    'ui_clear_text',
    'ui_press_enter',
    'ui_swipe',
    'ui_scroll',
    'ui_scroll_page',
    'ui_find_node',
    'wait',
    'ui_wait_for_node',
    'ui_wait_for_change',
    'ui_get_node',
    'ui_set_checked',
    'write_note',
    'read_note',
  ] as string[],
} as const;

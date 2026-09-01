import { PHONE_TOOLS } from '../tools/PhoneTools';
import { TODO_CREATE_TOOL, TODO_UPDATE_TOOL } from '../tools/TodoTool';
import {
  ASK_USER_DEFAULT_DESCRIPTION,
  CONFIRM_ACTION_DEFAULT_DESCRIPTION,
} from '../tools/ToolCircuitBreakerPolicy';
import { PREVIOUS_TOOL_DESCRIPTIONS_2026_08_30 } from '../tools/previousToolDescriptions';

function descriptionOf(name: string): string {
  const tool = PHONE_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool: ${name}`);
  return tool.description;
}

describe('unified general-assistant tool guidance', () => {
  test('removed scroll-until-found capability is not exposed to models', () => {
    expect(PHONE_TOOLS.some((tool) => tool.name === 'scroll_until_found')).toBe(false);
  });

  test('device descriptions retain only tool-specific targeting contracts', () => {
    expect(descriptionOf('ui_tap')).toContain('Android 无障碍结构');
    expect(descriptionOf('ui_tap')).toContain('ref');
    expect(descriptionOf('ui_tap')).toContain('coordinate');
    expect(descriptionOf('ui_tap')).toContain('中心手势');
    expect(descriptionOf('ui_tap')).toContain('手势被拒绝');
    expect(descriptionOf('ui_tap')).toContain('不会猜测坐标');
    expect(descriptionOf('ui_tap')).toContain('工具不会验证页面是否变化');
    expect(descriptionOf('ui_tap')).toContain('accepted=true');
    expect(PHONE_TOOLS.find((tool) => tool.name === 'ui_tap')?.parameters.properties.text.description)
      .toContain('不识别图像文字');
    expect(descriptionOf('ui_fill')).toContain('支持通过 focused、ref、文本、内容描述或资源 ID 定位');
    expect(descriptionOf('ui_fill')).not.toContain('无需先查询节点');
    expect(descriptionOf('ui_fill')).toContain('submit=true');
    expect(descriptionOf('ui_inspect')).toContain('Android 无障碍结构');
    expect(descriptionOf('ui_inspect')).toContain('不包含屏幕图像');
    expect(descriptionOf('ui_inspect')).toContain('定位标准控件');
    expect(descriptionOf('ui_inspect')).toContain('selected、checked、enabled');
    expect(descriptionOf('ui_screenshot')).toContain('屏幕图像');
    expect(descriptionOf('ui_screenshot')).toContain('采集时的 Android 无障碍结构');
    expect(descriptionOf('ui_screenshot')).not.toContain('图像尺寸');
    expect(descriptionOf('ui_screenshot')).toContain('坐标空间');
    expect(descriptionOf('ui_screenshot')).toContain('自定义绘制区域');
    expect(descriptionOf('ui_screenshot')).toContain('额外的图像传输和推理延迟');
    expect(descriptionOf('ui_screenshot')).not.toContain('视觉 Token');
    expect(descriptionOf('ui_screenshot')).not.toContain('当下一步');
    expect(descriptionOf('ui_screenshot')).not.toContain('时使用');
    expect(descriptionOf('ui_screenshot')).not.toContain('无需重复截图');
    expect(descriptionOf('ui_find_node')).toContain('matchCount');
    expect(descriptionOf('ui_find_node')).toContain('matches');
    expect(descriptionOf('ui_find_node')).toContain('ui_tap 或 ui_fill');
    expect(PHONE_TOOLS.map((tool) => tool.name)).not.toContain('ui_find_all_nodes');
    expect(PHONE_TOOLS.map((tool) => tool.name)).toContain('ui_get_node');
    expect(PHONE_TOOLS.map((tool) => tool.name)).not.toContain('ui_get_node_text');
    expect(PHONE_TOOLS.map((tool) => tool.name)).not.toContain('ui_get_bounds');
    expect(PHONE_TOOLS.map((tool) => tool.name)).not.toContain('ui_type_text');
    expect(descriptionOf('wait')).toContain('异步加载或动画');
    expect(descriptionOf('wait')).toContain('重新观察或更换策略');
    expect(descriptionOf('wait')).toContain('不适合连续延长等待');
    expect(descriptionOf('wait')).not.toContain('browser_use');
  });

  test('keeps the pre-cleanup descriptions available as a rollback snapshot', () => {
    expect(PREVIOUS_TOOL_DESCRIPTIONS_2026_08_30.ui_fill).toContain('无需先查询节点');
    expect(PREVIOUS_TOOL_DESCRIPTIONS_2026_08_30.clipboard_set).toContain('随后长按');
    expect(PREVIOUS_TOOL_DESCRIPTIONS_2026_08_30.browser_screenshot).toContain('仅在');
  });

  test('observation protocols live in schemas instead of selection descriptions', () => {
    const inspect = PHONE_TOOLS.find((tool) => tool.name === 'ui_inspect')!;
    const screenshot = PHONE_TOOLS.find((tool) => tool.name === 'ui_screenshot')!;
    const tap = PHONE_TOOLS.find((tool) => tool.name === 'ui_tap')!;

    expect(inspect.parameters.properties).toEqual({});
    expect(inspect.outputSchema).toMatchObject({ type: 'string' });
    expect(screenshot.parameters.properties).toEqual({});
    expect(screenshot.outputSchema).toMatchObject({
      type: 'object',
      required: ['captured', 'observationId', 'coordinateSpace', 'accessibility_tree'],
      additionalProperties: false,
    });
    expect(screenshot.outputSchema?.properties).not.toHaveProperty('imageWidth');
    expect(screenshot.outputSchema?.properties).not.toHaveProperty('imageHeight');
    expect(screenshot.outputSchema?.properties?.coordinateSpace).toMatchObject({
      enum: ['normalized_1000'],
    });
    expect(screenshot.outputSchema?.properties?.observationId.description)
      .toContain('本次截图');
    expect(tap.parameters.properties.x.description).toContain('coordinate 模式必填');
    expect(tap.parameters.properties.observationId.description).toContain('界面变化后失效');
  });

  test('scrolling tools describe their own distinct capabilities', () => {
    expect(descriptionOf('ui_swipe')).toContain('精细滑动手势');
    expect(descriptionOf('ui_scroll')).toContain('单次普通滚动');
    expect(descriptionOf('ui_scroll')).toContain('short、medium、long');
    expect(descriptionOf('ui_scroll')).toContain('存在多个容器时必须传');
    expect(descriptionOf('ui_scroll_page')).toContain('接近一个可视区域');
    expect(descriptionOf('ui_scroll_page')).toContain('逐页浏览或连续采集');
    expect(descriptionOf('ui_scroll_page')).toContain('changed');
    expect(descriptionOf('ui_scroll_page')).toContain('atEdge');
  });

  test('completion tools state their terminal contracts without repeating policy', () => {
    expect(descriptionOf('task_complete')).toContain('外部状态变更已被真实结果确认达成');
    expect(descriptionOf('task_complete')).toContain('查询、计算、读取或分析结果直接文字回答');
    expect(descriptionOf('task_complete')).toContain('summary');
    expect(descriptionOf('task_failed')).toContain('已尝试可用恢复方式');
    expect(descriptionOf('task_failed')).toContain('确认无法继续');
    expect(descriptionOf('task_failed')).toContain('单次工具失败不适用');
    expect(descriptionOf('task_complete').length).toBeLessThan(80);
    expect(descriptionOf('task_failed').length).toBeLessThan(80);
  });

  test('user gates separate missing information from external-impact authorization', () => {
    expect(ASK_USER_DEFAULT_DESCRIPTION).toContain('只能由用户提供');
    expect(ASK_USER_DEFAULT_DESCRIPTION).toContain('实质决定预期结果');
    expect(ASK_USER_DEFAULT_DESCRIPTION).toContain('仅有多种执行方式时不得调用');
    expect(ASK_USER_DEFAULT_DESCRIPTION).toContain('一次只问一个');
    expect(CONFIRM_ACTION_DEFAULT_DESCRIPTION).toContain('真实外部影响');
    expect(CONFIRM_ACTION_DEFAULT_DESCRIPTION).toContain('只确认、不执行动作');
    expect(CONFIRM_ACTION_DEFAULT_DESCRIPTION).toContain('一次授权');
  });

  test('todo guidance separates creation from verified progress updates', () => {
    expect(TODO_CREATE_TOOL.description).toContain('多个可独立验证结果');
    expect(TODO_CREATE_TOOL.description).toContain('不记录点击');
    expect(TODO_CREATE_TOOL.parameters.properties.todos.items?.properties?.description.description)
      .toContain('对象、位置');
    expect(TODO_UPDATE_TOOL.description).toContain('真实结果满足该项完成条件');
    expect(TODO_UPDATE_TOOL.description).toContain('最多一项为 in_progress');
    expect(TODO_UPDATE_TOOL.description.length).toBeLessThan(150);
  });
});

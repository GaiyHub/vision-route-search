import { ToolParser } from '../agent/ToolParser';

describe('ToolParser protocol compatibility', () => {
  test('parses the legacy tool_use history wrapper', () => {
    expect(
      ToolParser.parse(
        '<tool_use id="toolu_35" name="ui_tap">\n{"x":720,"y":2640}\n</tool_use>',
      ),
    ).toEqual([{ name: 'ui_tap', arguments: { x: 720, y: 2640 } }]);
  });

  test('does not turn an incomplete tool_use wrapper into a tool call', () => {
    expect(ToolParser.parse('<tool_use id="toolu_35" name="ui_tap">')).toEqual([]);
  });
});

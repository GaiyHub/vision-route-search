import {
  RECOMMENDED_COMMANDS,
  getFavoriteCommands,
  getCommandSuggestions,
} from '../recommendedCommands';

describe('recommended command suggestions', () => {
  it('contains the complete built-in recommendation set without duplicates', () => {
    expect(RECOMMENDED_COMMANDS).toHaveLength(18);
    expect(new Set(RECOMMENDED_COMMANDS).size).toBe(18);
  });

  it('shows only recent commands on the chat empty state', () => {
    const recent = Array.from({ length: 12 }, (_, index) => `R${index}`);
    expect(getCommandSuggestions(recent)).toEqual(recent.slice(0, 10));
    expect(getCommandSuggestions([])).toEqual([]);
  });

  it('appends recommendations to favorites only when enabled', () => {
    expect(getFavoriteCommands(['用户收藏'], false)).toEqual(['用户收藏']);
    expect(getFavoriteCommands(['用户收藏'], true)).toEqual([
      '用户收藏',
      ...RECOMMENDED_COMMANDS,
    ]);
  });

  it('deduplicates a recommended command already favorited by the user', () => {
    const command = RECOMMENDED_COMMANDS[0];
    const result = getFavoriteCommands([command], true);
    expect(result[0]).toBe(command);
    expect(result.filter((item) => item === command)).toHaveLength(1);
    expect(result).toHaveLength(RECOMMENDED_COMMANDS.length);
  });

  it('excludes recommendations individually dismissed by the user', () => {
    const dismissed = RECOMMENDED_COMMANDS[1];
    const result = getFavoriteCommands([], true, [dismissed]);
    expect(result).not.toContain(dismissed);
    expect(result).toHaveLength(RECOMMENDED_COMMANDS.length - 1);
  });
});

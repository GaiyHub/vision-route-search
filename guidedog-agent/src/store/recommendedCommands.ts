/**
 * Built-in command suggestions curated from the commands favorited on the
 * reference device. They are app-owned and intentionally independent from
 * each user's mutable favorites and recent-command history.
 */
export const RECOMMENDED_COMMANDS = [
  '解释一下什么是手机的无障碍服务',
  '现在几点',
  '查看手机当前电量、Android版本和可用存储空间',
  '查一下杭州明天的天气，并给出穿衣建议',
  '打开支付宝的生活缴费页面',
  '帮我找到缴纳电费的入口',
  '在网易云音乐中搜索“孤勇者”',
  '网易云播放邓紫棋孤独',
  '打开b站播放最近的牛来电影的主题曲',
  '在百度地图中搜索距离我最近的三甲医院',
  '查找小米最新旗舰手机的官方售价和主要配置',
  '发送短信给15528323909，内容是哈哈',
  '在京东搜索iPhone 17，找到价格最低的自营商品，但不要下单',
  '加购两包卫龙小面筋到京东购物车',
  '帮我删除京东购物车中所有商品',
  '帮我交1元水费',
  '分别查看淘宝和京东上的小米最新旗舰手机价格，整理成对比结果',
  '对比淘宝、京东中iPhone 17的价格和配送时间，整理成对比结果',
] as const;

/** The chat empty state only mirrors the user's own recent commands. */
export function getCommandSuggestions(
  recentCommands: readonly string[],
): string[] {
  return recentCommands.slice(0, 10);
}

/** Add built-in recommendations after real favorites without duplicating them. */
export function getFavoriteCommands(
  favorites: readonly string[],
  recommendedEnabled: boolean,
  dismissedRecommendations: readonly string[] = [],
): string[] {
  if (!recommendedEnabled) return [...favorites];
  const favoriteSet = new Set(favorites);
  const dismissedSet = new Set(dismissedRecommendations);
  return [
    ...favorites,
    ...RECOMMENDED_COMMANDS.filter(
      (command) => !favoriteSet.has(command) && !dismissedSet.has(command),
    ),
  ];
}

import { normalizeScreenshotOcrElements } from '../agent/AgentToolkit';

describe('screenshot OCR normalization', () => {
  it('returns bounded visual refs in normalized screenshot coordinates', () => {
    expect(normalizeScreenshotOcrElements([
      { text: ' 管理 ', bounds: { left: 1200, top: 160, right: 1380, bottom: 240 } },
      { text: '商品', bounds: { left: 100, top: 600, right: 300, bottom: 700 } },
    ], 1440, 3200)).toEqual([
      {
        ref: 'ocr_1',
        text: '管理',
        bounds: { left: 833, top: 50, right: 958, bottom: 75 },
        center: { x: 896, y: 63 },
      },
      {
        ref: 'ocr_2',
        text: '商品',
        bounds: { left: 69, top: 188, right: 208, bottom: 219 },
        center: { x: 139, y: 204 },
      },
    ]);
  });

  it('drops invalid duplicates and caps the model payload', () => {
    const repeated = Array.from({ length: 90 }, (_, index) => ({
      text: `文字${index}`,
      bounds: { left: 0, top: index * 10, right: 100, bottom: index * 10 + 8 },
    }));
    repeated.unshift(
      { text: '', bounds: { left: 0, top: 0, right: 10, bottom: 10 } },
      { text: '坏边界', bounds: { left: 10, top: 10, right: 5, bottom: 20 } },
    );
    repeated.push(repeated[2]);

    const result = normalizeScreenshotOcrElements(repeated, 1000, 1000);
    expect(result).toHaveLength(80);
    expect(new Set(result.map((item) => item.ref)).size).toBe(80);
  });

  it('keeps adjacent OCR elements as independent refs', () => {
    expect(normalizeScreenshotOcrElements([
      { text: '管理', bounds: { left: 1000, top: 100, right: 1100, bottom: 160 } },
      { text: '删除', bounds: { left: 1120, top: 100, right: 1220, bottom: 160 } },
      { text: '清空失效商品', bounds: { left: 1240, top: 100, right: 1430, bottom: 160 } },
    ], 1440, 3200)).toEqual([
      {
        ref: 'ocr_1',
        text: '管理',
        bounds: { left: 694, top: 31, right: 764, bottom: 50 },
        center: { x: 729, y: 41 },
      },
      {
        ref: 'ocr_2',
        text: '删除',
        bounds: { left: 778, top: 31, right: 847, bottom: 50 },
        center: { x: 813, y: 41 },
      },
      {
        ref: 'ocr_3',
        text: '清空失效商品',
        bounds: { left: 861, top: 31, right: 993, bottom: 50 },
        center: { x: 927, y: 41 },
      },
    ]);
  });
});

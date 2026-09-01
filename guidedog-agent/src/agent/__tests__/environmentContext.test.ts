import { buildEnvironmentContext } from '../environmentContext';

describe('buildEnvironmentContext', () => {
  it('provides a compact task-stable Android date context', () => {
    expect(buildEnvironmentContext(new Date(2026, 0, 2, 12), 'Asia/Shanghai')).toEqual({
      当前日期: '2026-01-02',
      本地时区: 'Asia/Shanghai',
      运行平台: 'Android',
    });
  });
});

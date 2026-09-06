import { describe, expect, it } from 'vitest';
import { buildFfmpegRtpArgs } from '../../src/mirror/rtpBridge.js';

describe('H.264 RTP 桥接参数', () => {
  it('为裸码流生成墙钟时间戳并在关键帧重复参数集', () => {
    const args = buildFfmpegRtpArgs(27183);
    expect(args).toContain('+genpts');
    expect(args).toContain('-use_wallclock_as_timestamps');
    expect(args).toContain('dump_extra=freq=keyframe');
    expect(args).toContain('rtp://127.0.0.1:27183?pkt_size=1200');
  });
});

import { moveModelProfile } from '../reorderModelProfiles';

describe('moveModelProfile', () => {
  it('moves a profile in either direction without mutating the source', () => {
    const source = ['a', 'b', 'c'];
    expect(moveModelProfile(source, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveModelProfile(source, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(source).toEqual(['a', 'b', 'c']);
  });

  it('keeps the order for invalid and no-op moves', () => {
    expect(moveModelProfile(['a', 'b'], -1, 1)).toEqual(['a', 'b']);
    expect(moveModelProfile(['a', 'b'], 0, 3)).toEqual(['a', 'b']);
    expect(moveModelProfile(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

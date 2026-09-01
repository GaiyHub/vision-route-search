/** Return a copy with one item moved to a new index. Invalid/no-op moves keep the order. */
export function moveModelProfile<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0
    || fromIndex >= items.length
    || toIndex < 0
    || toIndex >= items.length
    || fromIndex === toIndex
  ) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

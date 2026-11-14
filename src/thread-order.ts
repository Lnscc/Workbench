export function sortByUpdatedAtDesc<T extends { updatedAt: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => right.updatedAt - left.updatedAt);
}

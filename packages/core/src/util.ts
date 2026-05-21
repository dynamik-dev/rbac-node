export function dedupeBy<T, K>(items: ReadonlyArray<T>, key: (item: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function toArray<T>(value: T | ReadonlyArray<T>): T[] {
  return Array.isArray(value) ? [...value] : [value as T];
}

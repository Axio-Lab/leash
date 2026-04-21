/** v0.1 in-memory receipt index (no native deps). Swap for SQLite in production. */
export type ReceiptStore = Map<string, string[]>;

export function createMemoryStore(): ReceiptStore {
  return new Map();
}

export function appendLine(store: ReceiptStore, mint: string, line: string): void {
  const cur = store.get(mint) ?? [];
  cur.push(line);
  store.set(mint, cur);
}

export function listLines(store: ReceiptStore, mint: string): string[] {
  return store.get(mint) ?? [];
}

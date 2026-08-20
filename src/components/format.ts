export function formatMs(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 10) return `${n.toFixed(1)} ms`;
  return `${Math.round(n)} ms`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function toneForMs(n: number | null, warn: number, bad: number) {
  if (n === null) return "neutral" as const;
  if (n >= bad) return "bad" as const;
  if (n >= warn) return "warn" as const;
  return "ok" as const;
}

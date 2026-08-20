import type { CompareDelta, PageAnalysis, PageResource } from "./types.ts";

function keyOf(r: PageResource) {
  return r.url.split("#")[0] ?? r.url;
}

export function compareAnalyses(before: PageAnalysis, after: PageAnalysis): CompareDelta {
  const a = new Map(before.resources.map((r) => [keyOf(r), r]));
  const b = new Map(after.resources.map((r) => [keyOf(r), r]));

  const added: CompareDelta["added"] = [];
  const removed: CompareDelta["removed"] = [];
  const slower: CompareDelta["slower"] = [];
  const larger: CompareDelta["larger"] = [];

  for (const [k, r] of b) {
    const prev = a.get(k);
    if (!prev) {
      added.push({ url: r.url, type: r.type, sizeBytes: r.sizeBytes, durationMs: r.durationMs });
      continue;
    }
    const dMs = r.durationMs - prev.durationMs;
    if (dMs >= 80) slower.push({ url: r.url, beforeMs: prev.durationMs, afterMs: r.durationMs, deltaMs: dMs });
    const dB = r.sizeBytes - prev.sizeBytes;
    if (dB >= 8_000) {
      larger.push({ url: r.url, beforeBytes: prev.sizeBytes, afterBytes: r.sizeBytes, deltaBytes: dB });
    }
  }
  for (const [k, r] of a) {
    if (!b.has(k)) {
      removed.push({ url: r.url, type: r.type, sizeBytes: r.sizeBytes, durationMs: r.durationMs });
    }
  }

  slower.sort((x, y) => y.deltaMs - x.deltaMs);
  larger.sort((x, y) => y.deltaBytes - x.deltaBytes);

  return {
    added: added.slice(0, 20),
    removed: removed.slice(0, 20),
    slower: slower.slice(0, 12),
    larger: larger.slice(0, 12),
    bytesDelta: after.totals.bytes - before.totals.bytes,
    countDelta: after.totals.count - before.totals.count,
    totalMsDelta: after.document.totalMs - before.document.totalMs,
  };
}

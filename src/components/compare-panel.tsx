import type { CompareDelta } from "@/lib/net/types";
import { formatBytes, formatMs } from "@/components/format";
import { Badge } from "@/components/ui/badge";

export function ComparePanel({ delta }: { delta: CompareDelta }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-medium">Vergleich zum letzten Lauf</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={delta.totalMsDelta > 80 ? "bad" : delta.totalMsDelta < -80 ? "ok" : "neutral"}>
          Dokument {delta.totalMsDelta >= 0 ? "+" : ""}
          {formatMs(delta.totalMsDelta)}
        </Badge>
        <Badge tone={delta.bytesDelta > 20_000 ? "warn" : delta.bytesDelta < -20_000 ? "ok" : "neutral"}>
          Größe {delta.bytesDelta >= 0 ? "+" : ""}
          {formatBytes(Math.abs(delta.bytesDelta))}
        </Badge>
        <Badge>
          Requests {delta.countDelta >= 0 ? "+" : ""}
          {delta.countDelta}
        </Badge>
      </div>
      {!delta.added.length && !delta.removed.length && !delta.slower.length && !delta.larger.length ? (
        <p className="text-sm text-muted">Kaum Unterschiede.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <List title="Neu" rows={delta.added.map((r) => `${r.type} · ${formatBytes(r.sizeBytes)} · ${r.url}`)} />
          <List title="Weg" rows={delta.removed.map((r) => `${r.type} · ${r.url}`)} />
          <List
            title="Langsamer"
            rows={delta.slower.map(
              (r) => `+${Math.round(r.deltaMs)} ms · ${formatMs(r.beforeMs)} → ${formatMs(r.afterMs)} · ${r.url}`,
            )}
          />
          <List
            title="Größer"
            rows={delta.larger.map(
              (r) => `+${formatBytes(r.deltaBytes)} · ${formatBytes(r.beforeBytes)} → ${formatBytes(r.afterBytes)} · ${r.url}`,
            )}
          />
        </div>
      )}
    </section>
  );
}

function List({ title, rows }: { title: string; rows: string[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-subtle">{title}</p>
      <ul className="space-y-1">
        {rows.slice(0, 6).map((row) => (
          <li key={row} className="truncate font-mono text-[11px] text-muted" title={row}>
            {row}
          </li>
        ))}
      </ul>
    </div>
  );
}

import type { HostBucket } from "@/lib/net/types";
import { formatBytes, formatMs } from "@/components/format";
import { Badge } from "@/components/ui/badge";

export function HostsPanel({ hosts }: { hosts: HostBucket[] }) {
  if (!hosts.length) return null;
  const max = Math.max(...hosts.map((h) => h.bytes), 1);
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-medium">Hosts</h2>
      <ul className="space-y-3">
        {hosts.slice(0, 14).map((h) => (
          <li key={h.host}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-fg">{h.host || "—"}</p>
                <p className="text-[11px] text-subtle">
                  {h.count} Dateien · {formatMs(h.durationMs)} summiert
                  {h.failed ? ` · ${h.failed} Fehler` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {h.thirdParty && <Badge>Drittanbieter</Badge>}
                <span className="font-mono text-xs tabular-nums text-muted">{formatBytes(h.bytes)}</span>
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-sm bg-surface-3">
              <div
                className={`h-full rounded-sm ${h.thirdParty ? "bg-script" : "bg-fg/60"}`}
                style={{ width: `${Math.max(2, (h.bytes / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

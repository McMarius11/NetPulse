import { cn } from "@/lib/utils";
import type { PageResource, ResourceType } from "@/lib/net/types";

const TYPE_CLASS: Record<ResourceType, string> = {
  document: "bg-fg",
  image: "bg-image",
  script: "bg-script",
  stylesheet: "bg-stylesheet",
  font: "bg-font",
  media: "bg-media",
  xhr: "bg-other",
  other: "bg-other",
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function short(url: string) {
  try {
    const u = new URL(url);
    const file = u.pathname.split("/").filter(Boolean).at(-1) ?? u.pathname;
    return file || u.host;
  } catch {
    return url;
  }
}

export function Waterfall({ resources, lcpUrl }: { resources: PageResource[]; lcpUrl?: string | null }) {
  if (!resources.length) {
    return <p className="text-sm text-muted">Keine Ressourcen erfasst.</p>;
  }
  const maxEnd = Math.max(...resources.map((r) => r.startMs + r.durationMs), 1);
  const rows = [...resources].sort((a, b) => a.startMs - b.startMs);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px] space-y-1">
        {rows.map((r) => {
          const left = (r.startMs / maxEnd) * 100;
          const width = Math.max((r.durationMs / maxEnd) * 100, 0.8);
          const isLcp = Boolean(lcpUrl && r.url === lcpUrl);
          return (
            <div key={`${r.url}-${r.startMs}`} className="grid grid-cols-[minmax(0,1fr)_220px] items-center gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-fg" title={r.url}>
                  {short(r.url)}
                  {isLcp ? " · LCP" : ""}
                </p>
                <p className="truncate text-[11px] text-subtle">{r.url}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-surface-3">
                  <div
                    className={cn(
                      "absolute inset-y-0 rounded-sm opacity-90",
                      TYPE_CLASS[r.type],
                      !r.ok && "opacity-40",
                      isLcp && "ring-1 ring-fg",
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                </div>
                <span className="w-16 text-right font-mono text-[11px] tabular-nums text-muted">
                  {Math.round(r.durationMs)} ms
                </span>
                <span className="w-14 text-right font-mono text-[11px] tabular-nums text-subtle">
                  {formatBytes(r.sizeBytes)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

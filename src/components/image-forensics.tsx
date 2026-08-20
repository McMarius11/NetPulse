import type { ImageFinding, LcpCandidate } from "@/lib/net/types";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatMs } from "@/components/format";

const SOURCE: Record<ImageFinding["imageSource"], string> = {
  img: "img",
  srcset: "srcset",
  picture: "picture",
  css: "CSS",
  lazy: "data-src",
  preload: "preload",
  icon: "icon",
  og: "og:image",
  other: "—",
};

export function ImageForensics({
  findings,
  lcp,
}: {
  findings: ImageFinding[];
  lcp: LcpCandidate | null;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-medium">Warum Bilder hängen</h2>
      {lcp && (
        <div className="mb-4 rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-[11px] uppercase tracking-wide text-subtle">LCP-Kandidat</p>
          <p className="mt-1 truncate font-mono text-xs text-fg" title={lcp.url}>
            {lcp.url}
          </p>
          <p className="mt-1 text-xs text-muted">
            {lcp.reason} · {formatBytes(lcp.sizeBytes)} · {formatMs(lcp.durationMs)}
            {lcp.startMs ? ` ab ${formatMs(lcp.startMs)}` : ""}
          </p>
        </div>
      )}
      <p className="mb-4 text-xs text-muted">
        Pro Bild: Dateigröße, Pixel vs. HTML-Größe, TTFB vs. Download, Format, Lazy/Preload, neuer Host, Redirects.
        Bilder, die nur per JavaScript nachgeladen werden, siehst du in einem Chrome-HAR (Tab HAR).
      </p>
      {!findings.length && <p className="text-sm text-muted">Keine Bilder im HTML gefunden.</p>}
      <ul className="space-y-4">
        {findings.map((f) => (
          <li key={f.url} className="border-b border-border/60 pb-4 last:border-0 last:pb-0">
            <div className="flex gap-3">
              <Badge tone={f.severity}>
                {f.severity === "bad" ? "Problem" : f.severity === "warn" ? "Hinweis" : "OK"}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">{f.issue}</p>
                <p className="truncate font-mono text-[11px] text-subtle" title={f.url}>
                  {f.url}
                </p>
                <p className="mt-1 text-[11px] text-muted">
                  {SOURCE[f.imageSource]}
                  {f.format ? ` · ${f.format}` : ""}
                  {f.width && f.height ? ` · Datei ${f.width}×${f.height}` : ""}
                  {f.displayWidth ? ` · HTML ${f.displayWidth}×${f.displayHeight ?? "?"}` : ""}
                  {` · ${formatBytes(f.sizeBytes)}`}
                  {f.bitsPerPixel ? ` · ${f.bitsPerPixel.toFixed(1)} bpp` : ""}
                  {` · ${formatMs(f.durationMs)}`}
                  {f.ttfbMs !== null ? ` · TTFB ${formatMs(f.ttfbMs)}` : ""}
                  {f.transferMs !== null ? ` · Transfer ${formatMs(f.transferMs)}` : ""}
                  {f.hasSrcset ? " · srcset" : ""}
                  {f.loading ? ` · ${f.loading}` : ""}
                  {f.preloaded ? " · preload" : ""}
                  {f.newHost ? " · neuer Host" : ""}
                  {f.thirdParty ? ` · ${f.host}` : ""}
                </p>
                {f.reasons.length > 1 && (
                  <ul className="mt-2 space-y-1">
                    {f.reasons
                      .filter((r) => r.severity !== "ok")
                      .slice(0, 6)
                      .map((r) => (
                        <li key={r.title} className="text-xs text-muted">
                          <span className="text-fg">{r.title}.</span> {r.detail}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

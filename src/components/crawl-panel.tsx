import { useState } from "react";
import { Loader2, Map } from "lucide-react";
import { toast } from "sonner";
import { crawlSiteFn } from "@/lib/net/fns";
import type { CrawlResult } from "@/lib/net/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes, formatMs, toneForMs } from "@/components/format";

export function CrawlPanel() {
  const [url, setUrl] = useState("https://www.wikipedia.org");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<CrawlResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      setData(await crawlSiteFn({ data: { url } }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Crawl fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const worst = data ? [...data.pages].sort((a, b) => b.totalMs - a.totalMs)[0] : null;

  return (
    <div className="space-y-6">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono" aria-label="Start-URL" />
        <Button type="submit" disabled={busy} className="sm:w-48">
          {busy ? <Loader2 className="animate-spin" /> : <Map />}
          {busy ? "Crawlt…" : "Mini-Crawl"}
        </Button>
      </form>
      <p className="text-sm text-muted">
        Startseite plus bis zu acht interne Links. Zeigt, welche Unterseite am längsten braucht — ohne den ganzen Shop zu
        scannen.
      </p>
      {data && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          {worst && (
            <p className="mb-4 text-sm text-muted">
              Langsamste: <span className="font-mono text-fg">{worst.url}</span> · {formatMs(worst.totalMs)}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-subtle">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">URL</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">TTFB</th>
                  <th className="py-2 pr-3 font-medium">Gesamt</th>
                  <th className="py-2 font-medium">Größe</th>
                </tr>
              </thead>
              <tbody>
                {data.pages.map((p) => (
                  <tr key={p.url} className="border-b border-border/60">
                    <td className="max-w-[360px] truncate py-2 pr-3 font-mono" title={p.url}>
                      {p.url}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={p.ok ? "ok" : "bad"}>{p.status ?? "err"}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{formatMs(p.ttfbMs)}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">
                      <Badge tone={toneForMs(p.totalMs, 800, 2000)}>{formatMs(p.totalMs)}</Badge>
                    </td>
                    <td className="py-2 font-mono tabular-nums">{formatBytes(p.sizeBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

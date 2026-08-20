import { useState } from "react";
import { Loader2, Timer } from "lucide-react";
import { toast } from "sonner";
import { timeUrlFn } from "@/lib/net/fns";
import type { TimedRequest } from "@/lib/net/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes, formatMs, toneForMs } from "@/components/format";
import { asUrl, readLastTarget, writeLastTarget } from "@/lib/net/target";

const PHASES: { key: keyof TimedRequest; label: string; warn: number; bad: number }[] = [
  { key: "dnsMs", label: "DNS", warn: 80, bad: 180 },
  { key: "tcpMs", label: "TCP", warn: 80, bad: 200 },
  { key: "tlsMs", label: "TLS", warn: 120, bad: 280 },
  { key: "ttfbMs", label: "TTFB", warn: 400, bad: 1000 },
  { key: "transferMs", label: "Transfer", warn: 400, bad: 1200 },
  { key: "totalMs", label: "Gesamt", warn: 1200, bad: 3000 },
];

export function UrlTiming() {
  const [url, setUrl] = useState(() => asUrl(readLastTarget()));
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<TimedRequest | null>(null);

  async function run() {
    setBusy(true);
    writeLastTarget(url);
    try {
      setData(await timeUrlFn({ data: { url } }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Messung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const max = data ? Math.max(data.totalMs, 1) : 1;

  return (
    <div className="space-y-6">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono" aria-label="URL" />
        <Button type="submit" disabled={busy} className="sm:w-44">
          {busy ? <Loader2 className="animate-spin" /> : <Timer />}
          Messen
        </Button>
      </form>

      {data && (
        <div className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={data.ok ? "ok" : "bad"}>{data.status ?? "Fehler"}</Badge>
            <span className="truncate font-mono text-xs text-muted">{data.finalUrl}</span>
          </div>
          {data.error && <p className="text-sm text-bad">{data.error}</p>}
          <dl className="grid gap-3 sm:grid-cols-3">
            <Meta k="IP" v={data.ip ?? "—"} />
            <Meta k="TLS" v={data.tlsProtocol ?? "—"} />
            <Meta k="ALPN / HTTP" v={data.alpn ?? data.httpVersion ?? "—"} />
            <Meta k="Größe" v={formatBytes(data.sizeBytes)} />
            <Meta k="Server" v={data.server ?? "—"} />
            <Meta k="Cache" v={data.cacheControl ?? "—"} />
            <Meta k="Kompression" v={data.contentEncoding ?? "keine"} />
            <Meta k="CDN" v={data.cdnCache ?? "—"} />
            <Meta k="Typ" v={data.contentType ?? "—"} />
            <Meta k="Zertifikat" v={data.tls?.subject ?? "—"} />
            <Meta k="Issuer" v={data.tls?.issuer ?? "—"} />
            <Meta
              k="Gültig noch"
              v={
                data.tls?.daysLeft === null || data.tls?.daysLeft === undefined
                  ? "—"
                  : `${data.tls.daysLeft} Tage`
              }
            />
          </dl>
          <div className="space-y-3">
            {PHASES.map((p) => {
              const n = data[p.key];
              const ms = typeof n === "number" ? n : null;
              return (
                <div key={p.key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted">{p.label}</span>
                    <span className="font-mono tabular-nums">{formatMs(ms)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-sm bg-surface-3">
                    <div
                      className={`h-full rounded-sm ${
                        toneForMs(ms, p.warn, p.bad) === "bad"
                          ? "bg-bad"
                          : toneForMs(ms, p.warn, p.bad) === "warn"
                            ? "bg-warn"
                            : "bg-ok"
                      }`}
                      style={{ width: `${ms === null ? 0 : Math.min(100, (ms / max) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {data.redirects.length > 0 && (
            <p className="font-mono text-[11px] text-subtle">Redirects: {data.redirects.join(" → ")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-subtle">{k}</dt>
      <dd className="truncate font-mono text-sm">{v}</dd>
    </div>
  );
}

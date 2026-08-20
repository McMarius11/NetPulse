import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { analyzePageFn } from "@/lib/net/fns";
import { analysisToHar } from "@/lib/net/har";
import { compareAnalyses } from "@/lib/net/compare";
import { listReports, saveReport } from "@/lib/net/reports";
import type { PageAnalysis, ResourceType } from "@/lib/net/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Waterfall } from "@/components/waterfall";
import { HostsPanel } from "@/components/hosts-panel";
import { ImageForensics } from "@/components/image-forensics";
import { CachePanel } from "@/components/cache-panel";
import { ComparePanel } from "@/components/compare-panel";
import { downloadHar, downloadJson } from "@/components/download";
import { formatBytes, formatMs, toneForMs } from "@/components/format";

const FILTERS: { id: ResourceType | "all"; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "document", label: "HTML" },
  { id: "image", label: "Bilder" },
  { id: "script", label: "Scripts" },
  { id: "stylesheet", label: "CSS" },
  { id: "font", label: "Fonts" },
  { id: "media", label: "Media" },
  { id: "other", label: "Sonstiges" },
];

export function PageAnalyzer() {
  const [url, setUrl] = useState("https://www.wikipedia.org");
  const [blockTrackers, setBlockTrackers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<PageAnalysis | null>(null);
  const [baseline, setBaseline] = useState<PageAnalysis | null>(null);
  const [filter, setFilter] = useState<ResourceType | "all">("all");
  const [onlySlow, setOnlySlow] = useState(false);
  const [reports, setReports] = useState<ReturnType<typeof listReports>>([]);

  useEffect(() => {
    setReports(listReports());
  }, []);

  const delta = useMemo(() => (baseline && data ? compareAnalyses(baseline, data) : null), [baseline, data]);

  async function run() {
    setBusy(true);
    try {
      const result = await analyzePageFn({ data: { url, blockTrackers } });
      if (data && !baseline) setBaseline(data);
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analyse fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const rows =
    data?.resources.filter((r) => {
      if (filter !== "all" && r.type !== filter) return false;
      if (onlySlow && r.durationMs < 400) return false;
      return true;
    }) ?? [];

  return (
    <div className="space-y-6">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://beispiel.de"
            aria-label="URL"
            className="font-mono"
          />
          <Button type="submit" disabled={busy} className="sm:w-44">
            {busy ? <Loader2 className="animate-spin" /> : <Search />}
            {busy ? "Analysiert…" : "Seite prüfen"}
          </Button>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={blockTrackers}
            onChange={(e) => setBlockTrackers(e.target.checked)}
            className="size-4 accent-fg"
          />
          Tracker/Ads nicht laden (Reanalyse ohne Dritt-Pixel)
        </label>
      </form>

      {data && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                downloadHar(`netpulse-${hostStamp(data)}.har`, analysisToHar(data));
                toast.success("HAR exportiert");
              }}
            >
              <Download />
              HAR exportieren
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                downloadJson(`netpulse-${hostStamp(data)}.json`, data);
                toast.success("JSON exportiert");
              }}
            >
              <Download />
              JSON
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                saveReport(data);
                setReports(listReports());
                toast.success("Report gespeichert");
              }}
            >
              Report merken
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setBaseline(data);
                toast.success("Baseline gesetzt — nächster Lauf wird verglichen");
              }}
            >
              Als Baseline
            </Button>
            {baseline && (
              <Button type="button" variant="ghost" onClick={() => setBaseline(null)}>
                Baseline weg
              </Button>
            )}
            {reports.length > 0 && (
              <select
                className="h-10 max-w-full rounded-md border border-border bg-surface px-3 font-mono text-xs text-fg"
                defaultValue=""
                onChange={(e) => {
                  const row = reports.find((r) => r.id === e.target.value);
                  if (row) {
                    if (data) setBaseline(data);
                    setData(row.data);
                  }
                  e.currentTarget.value = "";
                }}
                aria-label="Gespeicherte Reports"
              >
                <option value="">Gespeicherte Reports…</option>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.savedAt).toLocaleString()} · {r.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Dokument" value={formatMs(data.document.totalMs)} tone={toneForMs(data.document.totalMs, 1500, 3500)} />
            <Stat label="DNS / TTFB" value={`${formatMs(data.document.dnsMs)} / ${formatMs(data.document.ttfbMs)}`} />
            <Stat label="Ressourcen" value={`${data.totals.count} · ${formatBytes(data.totals.bytes)}`} />
            <Stat
              label="Drittanbieter"
              value={`${data.totals.thirdParty} · ${formatBytes(data.totals.thirdPartyBytes)}`}
              tone={data.totals.thirdParty > 8 ? "warn" : "neutral"}
            />
          </div>

          {data.blockedTrackers.length > 0 && (
            <p className="text-sm text-muted">
              {data.blockedTrackers.length} Tracker nicht geladen
              {data.blockedTrackers[0] ? ` (z. B. ${data.blockedTrackers[0].host})` : ""}.
            </p>
          )}

          {delta && <ComparePanel delta={delta} />}

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-medium">Engpässe</h2>
            <ul className="space-y-2">
              {data.bottlenecks.map((b) => (
                <li key={`${b.title}-${b.relatedUrl ?? ""}`} className="flex gap-3">
                  <Badge tone={b.severity}>{b.severity === "ok" ? "OK" : b.severity === "warn" ? "Hinweis" : "Problem"}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm text-fg">{b.title}</p>
                    <p className="text-xs text-muted">{b.detail}</p>
                    {b.relatedUrl && (
                      <p className="mt-0.5 truncate font-mono text-[11px] text-subtle">{b.relatedUrl}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <HostsPanel hosts={data.hosts} />
          <ImageForensics findings={data.images} lcp={data.lcp} />
          <CachePanel findings={data.cache} doc={data.document} tls={data.tls} />

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-medium">Waterfall</h2>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    className={`h-8 rounded-full px-3 text-xs ${
                      filter === f.id ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-fg"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setOnlySlow((v) => !v)}
                  className={`h-8 rounded-full px-3 text-xs ${
                    onlySlow ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted"
                  }`}
                >
                  Nur langsam
                </button>
              </div>
            </div>
            <Waterfall resources={rows} lcpUrl={data.lcp?.url} />
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-medium">Ressourcen</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="text-subtle">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">Typ</th>
                    <th className="py-2 pr-3 font-medium">Host</th>
                    <th className="py-2 pr-3 font-medium">URL</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Dauer</th>
                    <th className="py-2 font-medium">Größe</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.url}-${r.startMs}`} className="border-b border-border/60">
                      <td className="py-2 pr-3 text-muted">{r.type}</td>
                      <td className="py-2 pr-3 font-mono text-subtle">{r.host}</td>
                      <td className="max-w-[280px] truncate py-2 pr-3 font-mono" title={r.url}>
                        {r.url}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={r.ok ? "ok" : "bad"}>{r.status ?? "err"}</Badge>
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{formatMs(r.durationMs)}</td>
                      <td className="py-2 font-mono tabular-nums">{formatBytes(r.sizeBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {!data && !busy && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-fg">Gib eine URL ein und klicke auf Seite prüfen.</p>
          <p className="mt-2 text-sm text-muted">
            NetPulse lädt die Seite, gruppiert Hosts, prüft Bilder, Cache und TLS und zeigt, welche Datei die Ladezeit
            auffrisst. Der zweite Lauf wird automatisch mit dem ersten verglichen. HAR/JSON kannst du exportieren oder
            unter dem Tab HAR importieren.
          </p>
        </div>
      )}
    </div>
  );
}

function hostStamp(data: PageAnalysis) {
  return (data.pageHost || "report").replace(/[^a-z0-9.-]/gi, "_");
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "neutral" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 font-mono text-lg tabular-nums text-fg">{value}</p>
      {tone && tone !== "neutral" && (
        <div className="mt-2">
          <Badge tone={tone}>{tone === "ok" ? "gut" : tone === "warn" ? "mittel" : "kritisch"}</Badge>
        </div>
      )}
    </div>
  );
}

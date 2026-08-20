import { useMemo, useState } from "react";
import { Download, FileUp } from "lucide-react";
import { toast } from "sonner";
import { analysisToHar, parseHarText } from "@/lib/net/har";
import { compareAnalyses } from "@/lib/net/compare";
import type { PageAnalysis } from "@/lib/net/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Waterfall } from "@/components/waterfall";
import { HostsPanel } from "@/components/hosts-panel";
import { ImageForensics } from "@/components/image-forensics";
import { CachePanel } from "@/components/cache-panel";
import { ComparePanel } from "@/components/compare-panel";
import { downloadHar, downloadJson } from "@/components/download";
import { formatBytes, formatMs } from "@/components/format";

export function HarLab() {
  const [data, setData] = useState<PageAnalysis | null>(null);
  const [baseline, setBaseline] = useState<PageAnalysis | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState("");

  function applyText(text: string, label: string, asBaseline = false) {
    try {
      const parsed = parseHarText(text);
      if (asBaseline) {
        setBaseline(parsed);
        toast.success(`Baseline: ${parsed.resources.length} Einträge`);
        return;
      }
      if (data && !baseline) setBaseline(data);
      setData(parsed);
      setName(label);
      toast.success(`${parsed.resources.length} Einträge aus HAR`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "HAR unlesbar");
    }
  }

  function onFile(file: File, asBaseline = false) {
    const reader = new FileReader();
    reader.onload = () => applyText(String(reader.result ?? ""), file.name, asBaseline);
    reader.readAsText(file);
  }

  const delta = useMemo(() => (baseline && data ? compareAnalyses(baseline, data) : null), [baseline, data]);

  return (
    <div className="space-y-6">
      <label
        className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center ${
          over ? "border-fg bg-surface-2" : "border-border bg-surface"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
      >
        <FileUp className="mb-2 size-5 text-muted" />
        <p className="text-sm text-fg">HAR-Datei hier ablegen oder klicken</p>
        <p className="mt-1 max-w-md text-xs text-muted">
          Chrome, Firefox, Safari, WebPageTest — oder ein NetPulse-Export. Danach dieselbe Auswertung wie bei der
          Live-Analyse: Waterfall, Hosts, Bilder, Cache, Engpässe.
        </p>
        <input
          type="file"
          accept=".har,.json,application/json"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.currentTarget.value = "";
          }}
        />
      </label>

      <details className="rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm text-fg">HAR als Text einfügen</summary>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          className="mt-3 min-h-28 w-full rounded-md border border-border bg-surface-2 p-3 font-mono text-xs text-fg"
          placeholder='{ "log": { "entries": [...] } }'
          aria-label="HAR JSON"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              applyText(paste, "paste.har");
              setPaste("");
            }}
          >
            Einfügen auswerten
          </Button>
        </div>
      </details>

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {name && <Badge>{name}</Badge>}
            <span className="text-sm text-muted">
              {data.totals.count} Requests · {formatBytes(data.totals.bytes)} · Dokument {formatMs(data.document.totalMs)}
            </span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => downloadHar(`${(name ?? "netpulse").replace(/\.har$/i, "")}.export.har`, analysisToHar(data))}
            >
              <Download />
              Als HAR
            </Button>
            <Button type="button" variant="secondary" onClick={() => downloadJson(`${name ?? "netpulse"}.json`, data)}>
              <Download />
              JSON
            </Button>
            <label className="inline-flex h-10 cursor-pointer items-center rounded-md border border-border bg-surface-2 px-3 text-sm text-fg">
              Zweite HAR als Baseline
              <input
                type="file"
                accept=".har,.json,application/json"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFile(file, true);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {baseline && (
              <Button type="button" variant="ghost" onClick={() => setBaseline(null)}>
                Baseline weg
              </Button>
            )}
          </div>

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
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <HostsPanel hosts={data.hosts} />
          <ImageForensics findings={data.images} lcp={data.lcp} />
          <CachePanel findings={data.cache} doc={data.document} tls={data.tls} />
          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-medium">Waterfall</h2>
            <Waterfall resources={data.resources} lcpUrl={data.lcp?.url} />
          </section>
        </>
      )}
    </div>
  );
}

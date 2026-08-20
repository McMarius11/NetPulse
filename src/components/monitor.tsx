import { useEffect, useRef, useState } from "react";
import { Activity, Square } from "lucide-react";
import { timeUrlFn } from "@/lib/net/fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMs } from "@/components/format";

type Sample = { t: number; total: number; ttfb: number | null; ok: boolean };

export function Monitor() {
  const [url, setUrl] = useState("https://example.com");
  const [running, setRunning] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const runningRef = useRef(false);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    async function tick() {
      while (runningRef.current && !cancelled) {
        try {
          const r = await timeUrlFn({ data: { url } });
          if (cancelled) return;
          setSamples((prev) =>
            [...prev, { t: Date.now(), total: r.totalMs, ttfb: r.ttfbMs, ok: r.ok }].slice(-40),
          );
        } catch {
          if (cancelled) return;
          setSamples((prev) => [...prev, { t: Date.now(), total: 0, ttfb: null, ok: false }].slice(-40));
        }
        await new Promise((res) => setTimeout(res, 2500));
      }
    }
    void tick();
    return () => {
      cancelled = true;
    };
  }, [running, url]);

  const last = samples.at(-1);
  const okRate = samples.length ? Math.round((samples.filter((s) => s.ok).length / samples.length) * 100) : 0;
  const max = Math.max(...samples.map((s) => s.total), 1);

  return (
    <div className="space-y-6">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setSamples([]);
          setRunning(true);
        }}
      >
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={running}
          className="font-mono"
          aria-label="URL"
        />
        {running ? (
          <Button type="button" variant="secondary" className="sm:w-44" onClick={() => setRunning(false)}>
            <Square />
            Stop
          </Button>
        ) : (
          <Button type="submit" className="sm:w-44">
            <Activity />
            Überwachen
          </Button>
        )}
      </form>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Letzte Messung" value={last ? formatMs(last.total) : "—"} />
        <Tile label="TTFB" value={last ? formatMs(last.ttfb) : "—"} />
        <Tile label="Erfolg" value={samples.length ? `${okRate}%` : "—"} />
      </div>

      <div className="flex h-36 items-end gap-1 rounded-xl border border-border bg-surface p-3">
        {samples.length === 0 && <p className="self-center text-sm text-muted">Noch keine Samples.</p>}
        {samples.map((s) => (
          <div
            key={s.t}
            className={`flex-1 rounded-sm ${s.ok ? "bg-ok/80" : "bg-bad/80"}`}
            style={{ height: `${Math.max(8, (s.total / max) * 100)}%` }}
            title={`${formatMs(s.total)}`}
          />
        ))}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 font-mono text-lg tabular-nums">{value}</p>
    </div>
  );
}

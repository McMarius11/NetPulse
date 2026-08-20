import { useMemo, useState } from "react";
import { Loader2, Globe } from "lucide-react";
import { toast } from "sonner";
import { dnsBenchFn, dnsInspectFn, dnsLoadFn } from "@/lib/net/fns";
import type { DnsBenchmark, DnsFinding, DnsInspect, DnsLoadResult } from "@/lib/net/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMs, toneForMs } from "@/components/format";
import { hostFromTarget, readLastTarget, writeLastTarget } from "@/lib/net/target";

export function DnsBench() {
  const [domain, setDomain] = useState(() => hostFromTarget(readLastTarget()) || "wikipedia.org");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<DnsBenchmark | null>(null);
  const [inspect, setInspect] = useState<DnsInspect | null>(null);
  const [load, setLoad] = useState<DnsLoadResult | null>(null);

  async function run() {
    setBusy(true);
    writeLastTarget(domain);
    try {
      const [bench, records, loadResult] = await Promise.all([
        dnsBenchFn({ data: { domain } }),
        dnsInspectFn({ data: { domain } }),
        dnsLoadFn({ data: { domain } }),
      ]);
      setData(bench);
      setInspect(records);
      setLoad(loadResult);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "DNS-Test fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const max = Math.max(...(data?.probes.map((p) => p.ms ?? 0) ?? [1]), 1);
  const nsMax = Math.max(...(inspect?.nameservers.map((n) => n.ms ?? 0) ?? [1]), 1);
  const hostMax = Math.max(...(load?.hosts.map((h) => h.ms ?? 0) ?? [1]), 1);
  const burstMax = Math.max(...(load?.bursts.map((b) => b.p95Ms ?? b.wallMs ?? 0) ?? [1]), 1);

  const findings: DnsFinding[] = useMemo(() => {
    const extra: DnsFinding[] = [];
    if (data && !data.answersMatch) {
      extra.push({
        severity: "bad",
        title: "Resolver widersprechen sich",
        detail: "Cloudflare/Google/Quad9/System liefern unterschiedliche A-Records.",
      });
    }
    const seen = new Set(extra.map((e) => e.title));
    const rest = [...(load?.findings ?? []), ...(inspect?.findings ?? [])].filter((f) => {
      if (seen.has(f.title)) return false;
      seen.add(f.title);
      return true;
    });
    return [...extra, ...rest];
  }, [data, inspect, load]);

  return (
    <div className="space-y-6">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} className="font-mono" aria-label="Domain" />
        <Button type="submit" disabled={busy} className="sm:w-44">
          {busy ? <Loader2 className="animate-spin" /> : <Globe />}
          DNS prüfen
        </Button>
      </form>
      <p className="text-sm text-muted">
        Eine Query reicht nicht: Seiten feuern viele Lookups. Burst = 8 parallele Fragen pro Resolver, plus alle Hosts
        aus dem HTML.
      </p>

      {findings.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-medium">Befund</h2>
          <ul className="space-y-2">
            {findings.map((f) => (
              <li key={f.title} className="flex gap-3">
                <Badge tone={f.severity}>{f.severity === "ok" ? "OK" : f.severity === "warn" ? "Hinweis" : "Problem"}</Badge>
                <div className="min-w-0">
                  <p className="text-sm text-fg">{f.title}</p>
                  <p className="text-xs text-muted">{f.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {load && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-medium">Burst — 8 parallele Queries</h2>
          <p className="mb-3 text-xs text-muted">
            p50 / p95 / Wandzeit. Steigt p95 deutlich über p50, wird der Resolver bei einem echten Seitenaufruf zum
            Nadelöhr.
          </p>
          <ul className="space-y-3">
            {load.bursts.map((b) => (
              <li key={b.name}>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="text-sm text-fg">
                    {b.name}{" "}
                    <span className="font-mono text-[11px] text-subtle">
                      {b.ok}/{b.count}
                    </span>
                  </p>
                  <span className="font-mono text-[11px] tabular-nums text-muted">
                    p50 {formatMs(b.p50Ms)} · p95 {formatMs(b.p95Ms)} · wall {formatMs(b.wallMs)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-sm bg-surface-3">
                  <div
                    className="h-full rounded-sm bg-fg/50"
                    style={{ width: `${Math.min(100, ((b.p95Ms ?? 0) / burstMax) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {load && load.hosts.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-medium">Hosts der Seite</h2>
          <p className="mb-3 text-xs text-muted">
            {load.hosts.length} Namen parallel, Wandzeit {formatMs(load.hostsWallMs)} — wie beim ersten Besuch, bevor
            der Resolver cached.
          </p>
          <ul className="space-y-2">
            {load.hosts.map((h) => (
              <li key={h.host} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-fg">{h.host}</p>
                  {h.error && <p className="text-[11px] text-bad">{h.error}</p>}
                </div>
                <div className="h-1.5 w-28 overflow-hidden rounded-sm bg-surface-3">
                  <div
                    className="h-full rounded-sm bg-fg/50"
                    style={{ width: `${h.ms === null ? 0 : Math.min(100, (h.ms / hostMax) * 100)}%` }}
                  />
                </div>
                <Badge tone={h.error ? "bad" : toneForMs(h.ms, 40, 100)}>{formatMs(h.ms)}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>
              Einzelquery für <span className="font-mono text-fg">{data.domain}</span>:{" "}
              <span className="text-fg">{data.fastest ?? "keiner"}</span>
            </span>
            <Badge tone={data.answersMatch ? "ok" : "bad"}>{data.answersMatch ? "Antworten gleich" : "Antworten verschieden"}</Badge>
            {data.spreadMs !== null && <Badge>Δ {formatMs(data.spreadMs)}</Badge>}
          </div>
          {data.probes.map((p) => (
            <div key={p.name} className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {p.name}{" "}
                    <span className="font-mono text-xs font-normal text-subtle">
                      {p.server === "system" ? "lokal" : p.server}
                    </span>
                  </p>
                  {p.addresses[0] && <p className="font-mono text-[11px] text-muted">{p.addresses.join(", ")}</p>}
                  {p.error && <p className="text-xs text-bad">{p.error}</p>}
                </div>
                <Badge tone={p.ms === null ? "bad" : toneForMs(p.ms, 40, 100)}>
                  {p.name === data.fastest ? "schnellster" : formatMs(p.ms)}
                </Badge>
              </div>
              <div className="h-2 overflow-hidden rounded-sm bg-surface-3">
                <div
                  className="h-full rounded-sm bg-fg/50"
                  style={{ width: `${p.ms === null ? 0 : Math.min(100, (p.ms / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {inspect && (
        <>
          {inspect.nameservers.length > 0 && (
            <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-medium">Autoritative Nameserver</h2>
              <ul className="space-y-3">
                {inspect.nameservers.map((n) => (
                  <li key={n.ns}>
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-fg">{n.ns}</p>
                        <p className="font-mono text-[11px] text-subtle">
                          {n.ip ?? "—"}
                          {n.addresses[0] ? ` · ${n.addresses.join(", ")}` : ""}
                        </p>
                        {n.error && <p className="text-xs text-bad">{n.error}</p>}
                      </div>
                      <Badge tone={n.ms === null ? "bad" : toneForMs(n.ms, 80, 200)}>{formatMs(n.ms)}</Badge>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-sm bg-surface-3">
                      <div
                        className="h-full rounded-sm bg-fg/50"
                        style={{ width: `${n.ms === null ? 0 : Math.min(100, (n.ms / nsMax) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-medium">Records · Mail · DNSSEC</h2>
            <dl className="mb-4 grid gap-3 sm:grid-cols-2">
              <Meta k="SPF" v={inspect.spf ?? "kein SPF"} />
              <Meta k="DMARC" v={inspect.dmarc ?? "kein _dmarc"} />
              <Meta k="CAA" v={inspect.caa.length ? inspect.caa.map((r) => r.value).join(", ") : "kein CAA"} />
              <Meta
                k="DNSSEC"
                v={
                  inspect.dnssecAd === true
                    ? "AD gesetzt (validiert)"
                    : inspect.ds.length
                      ? "DS da, AD nicht gesetzt"
                      : "kein DS"
                }
              />
              <Meta k="SOA" v={inspect.soa ?? "—"} />
              <Meta
                k="CNAME"
                v={inspect.cname.length ? inspect.cname.map((c) => c.value).join(" → ") : "keine Kette"}
              />
            </dl>
            <RecordList title="A" rows={inspect.a} />
            <RecordList title="AAAA" rows={inspect.aaaa} />
            <RecordList title="MX" rows={inspect.mx} />
            <RecordList title="NS" rows={inspect.ns} />
            <RecordList title="TXT" rows={inspect.txt} />
            <RecordList title="HTTPS/SVCB" rows={inspect.https} />
            {inspect.ptr.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-subtle">PTR (Reverse)</p>
                <ul className="space-y-1">
                  {inspect.ptr.map((p) => (
                    <li key={p.ip} className="truncate font-mono text-xs text-fg">
                      {p.ip} → {p.names.length ? p.names.join(", ") : "kein PTR"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-subtle">DNS over HTTPS</p>
              {inspect.doh.map((p) => (
                <p key={p.name} className="font-mono text-xs text-muted">
                  {p.name}: {p.ms === null ? p.error : `${formatMs(p.ms)} · ${p.addresses[0] ?? "—"}`}
                </p>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function RecordList({ title, rows }: { title: string; rows: { value: string; ttl: number | null }[] }) {
  if (!rows.length) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-subtle">{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={`${title}-${r.value}`} className="truncate font-mono text-xs text-fg">
            {r.value}
            {r.ttl !== null ? <span className="text-subtle"> · TTL {r.ttl}s</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-subtle">{k}</dt>
      <dd className="truncate font-mono text-sm" title={v}>
        {v}
      </dd>
    </div>
  );
}

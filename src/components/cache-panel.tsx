import type { CacheFinding, TimedRequest, TlsInfo } from "@/lib/net/types";
import { Badge } from "@/components/ui/badge";

export function CachePanel({
  findings,
  doc,
  tls,
}: {
  findings: CacheFinding[];
  doc: TimedRequest;
  tls: TlsInfo | null;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-medium">Cache, Header, TLS</h2>
      <dl className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Meta k="HTTP" v={doc.httpVersion ?? doc.alpn ?? "—"} />
        <Meta k="Kompression" v={doc.contentEncoding ?? "keine"} />
        <Meta k="Cache-Control" v={doc.cacheControl ?? "—"} />
        <Meta k="CDN" v={doc.cdnCache ?? "—"} />
        <Meta k="Age" v={doc.age ?? "—"} />
        <Meta k="TLS" v={tls?.protocol ?? doc.tlsProtocol ?? "—"} />
        <Meta k="Zertifikat" v={tls?.subject ?? "—"} />
        <Meta k="Issuer" v={tls?.issuer ?? "—"} />
        <Meta
          k="Gültig"
          v={
            tls?.daysLeft === null || tls?.daysLeft === undefined
              ? (tls?.validTo ?? "—")
              : tls.daysLeft < 0
                ? "abgelaufen"
                : `${tls.daysLeft} Tage`
          }
        />
      </dl>
      {doc.redirects.length > 0 && (
        <p className="mb-4 font-mono text-[11px] text-subtle">Redirects: {doc.redirects.join(" → ")}</p>
      )}
      {!findings.length ? (
        <p className="text-sm text-muted">Statische Dateien sehen beim Caching unauffällig aus.</p>
      ) : (
        <ul className="space-y-2">
          {findings.map((f) => (
            <li key={f.url} className="flex gap-3">
              <Badge tone={f.severity}>{f.severity === "bad" ? "Problem" : "Hinweis"}</Badge>
              <div className="min-w-0">
                <p className="text-sm text-fg">{f.issue}</p>
                <p className="truncate font-mono text-[11px] text-subtle">{f.url}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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

import dns from "node:dns/promises";
import { Resolver } from "node:dns/promises";
import { fetchHtml } from "./http.ts";
import { isBlockedHostname, isPrivateOrReservedIp, normalizeTargetUrl } from "./ssrf.ts";
import type {
  DnsBenchmark,
  DnsBurst,
  DnsFinding,
  DnsHostLookup,
  DnsInspect,
  DnsLoadResult,
  DnsProbe,
  DnsRecord,
  NsProbe,
} from "./types.ts";

const PUBLIC_RESOLVERS: { name: string; server: string }[] = [
  { name: "Cloudflare", server: "1.1.1.1" },
  { name: "Google", server: "8.8.8.8" },
  { name: "Quad9", server: "9.9.9.9" },
  { name: "OpenDNS", server: "208.67.222.222" },
  { name: "AdGuard", server: "94.140.14.14" },
];

function withTimeout<T>(p: Promise<T>, ms: number, label = "Timeout"): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(label)), ms)),
  ]);
}

export function cleanDomain(domainRaw: string): string {
  const trimmed = domainRaw.trim();
  if (!trimmed) throw new Error("Bitte eine Domain eingeben.");
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    const domain = url.hostname.replace(/\.$/, "").toLowerCase();
    if (!domain || !/^[a-z0-9.-]+$/.test(domain)) throw new Error("Ungültige Domain.");
    if (isBlockedHostname(domain)) throw new Error("Lokale und interne Hosts sind gesperrt.");
    return domain;
  } catch (err) {
    if (err instanceof Error && (err.message === "Ungültige Domain." || err.message.includes("gesperrt"))) {
      throw err;
    }
    throw new Error("Ungültige Domain.");
  }
}

async function rec(fn: () => Promise<DnsRecord[]>): Promise<DnsRecord[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

async function probeResolver(domain: string, name: string, server: string): Promise<DnsProbe> {
  const resolver = new Resolver();
  resolver.setServers([server]);
  const t0 = performance.now();
  try {
    const addresses = await withTimeout(resolver.resolve4(domain), 4000);
    return { name, server, ms: performance.now() - t0, addresses, error: null };
  } catch (err) {
    return {
      name,
      server,
      ms: null,
      addresses: [],
      error: err instanceof Error ? err.message : "Fehler",
    };
  }
}

function setKey(addrs: string[]): string {
  return [...addrs].sort().join(",");
}

export async function benchmarkDns(domainRaw: string): Promise<DnsBenchmark> {
  const domain = cleanDomain(domainRaw);

  const system: DnsProbe = await (async () => {
    const t0 = performance.now();
    try {
      const looked = await withTimeout(dns.lookup(domain, { all: true }), 4000);
      return {
        name: "System",
        server: "system",
        ms: performance.now() - t0,
        addresses: looked.map((r) => r.address),
        error: null,
      };
    } catch (err) {
      return {
        name: "System",
        server: "system",
        ms: null,
        addresses: [],
        error: err instanceof Error ? err.message : "Fehler",
      };
    }
  })();

  const rest = await Promise.all(PUBLIC_RESOLVERS.map((r) => probeResolver(domain, r.name, r.server)));
  const probes = [system, ...rest];
  const ok = probes.filter((p) => p.ms !== null);
  const byMs = [...ok].sort((a, b) => (a.ms ?? 9e9) - (b.ms ?? 9e9));
  const fastest = byMs[0]?.name ?? null;
  const slowest = byMs.at(-1)?.name ?? null;
  const fastestMs = byMs[0]?.ms ?? 0;
  const core = ok.filter((p) => (p.ms ?? 0) <= Math.max(120, fastestMs * 12));
  const coreSorted = [...core].sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));
  const spreadMs =
    coreSorted.length >= 2 ? (coreSorted.at(-1)!.ms ?? 0) - (coreSorted[0]!.ms ?? 0) : null;
  const keys = ok.filter((p) => p.addresses.length).map((p) => setKey(p.addresses.filter((a) => a.includes("."))));
  const answersMatch = keys.length <= 1 || keys.every((k) => k === keys[0]);
  return { domain, probes, fastest, slowest, spreadMs, answersMatch };
}

type DohJson = {
  Status?: number;
  AD?: boolean;
  Answer?: { name?: string; type?: number; TTL?: number; data?: string }[];
};

async function probeDoh(name: string, endpoint: string): Promise<DnsProbe & { ad: boolean | null; records: DnsRecord[] }> {
  const t0 = performance.now();
  try {
    const res = await fetch(endpoint, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json()) as DohJson;
    const records = (json.Answer ?? [])
      .filter((a) => a.data)
      .map((a) => ({
        type: String(a.type ?? ""),
        value: a.data!,
        ttl: a.TTL ?? null,
      }));
    const addresses = records.filter((r) => r.type === "1" || r.value.match(/^\d+\.\d+\.\d+\.\d+$/)).map((r) => r.value);
    return {
      name,
      server: "DoH",
      ms: performance.now() - t0,
      addresses: addresses.length ? addresses : records.map((r) => r.value),
      error: res.ok ? null : `HTTP ${res.status}`,
      ad: typeof json.AD === "boolean" ? json.AD : null,
      records,
    };
  } catch (err) {
    return {
      name,
      server: "DoH",
      ms: null,
      addresses: [],
      error: err instanceof Error ? err.message : "Fehler",
      ad: null,
      records: [],
    };
  }
}

async function followCname(domain: string): Promise<DnsRecord[]> {
  const chain: DnsRecord[] = [];
  let cur = domain;
  for (let i = 0; i < 8; i += 1) {
    try {
      const next = await withTimeout(dns.resolveCname(cur), 3000);
      if (!next.length) break;
      const hop = next[0]!;
      chain.push({ type: "CNAME", value: hop, ttl: null });
      cur = hop.replace(/\.$/, "");
    } catch {
      break;
    }
  }
  return chain;
}

async function probeNs(domain: string, nsHost: string): Promise<NsProbe> {
  const t0 = performance.now();
  try {
    const looked = await withTimeout(dns.lookup(nsHost, { all: true }), 3000);
    const ip = looked.map((r) => r.address).find((a) => !isPrivateOrReservedIp(a)) ?? null;
    if (!ip) return { ns: nsHost, ip: null, ms: null, addresses: [], error: "Kein öffentliches NS-A" };
    const resolver = new Resolver();
    resolver.setServers([ip]);
    const addresses = await withTimeout(resolver.resolve4(domain), 4000);
    return { ns: nsHost, ip, ms: performance.now() - t0, addresses, error: null };
  } catch (err) {
    return {
      ns: nsHost,
      ip: null,
      ms: null,
      addresses: [],
      error: err instanceof Error ? err.message : "Fehler",
    };
  }
}

export function diagnoseDns(input: {
  a: DnsRecord[];
  aaaa: DnsRecord[];
  mx: DnsRecord[];
  ns: DnsRecord[];
  spf: string | null;
  dmarc: string | null;
  caa: DnsRecord[];
  cname: DnsRecord[];
  nameservers: NsProbe[];
  answersMatch: boolean;
  spreadMs: number | null;
  dnssecAd: boolean | null;
  ds: DnsRecord[];
}): DnsFinding[] {
  const notes: DnsFinding[] = [];
  if (!input.a.length && !input.cname.length) {
    notes.push({ severity: "bad", title: "Kein A-Record", detail: "Die Domain löst nicht auf IPv4 auf." });
  }
  if (!input.aaaa.length) {
    notes.push({
      severity: "warn",
      title: "Kein AAAA",
      detail: "Kein IPv6. Clients mit IPv6-only (manche Mobilnetze) scheitern.",
    });
  }
  if (!input.answersMatch) {
    notes.push({
      severity: "bad",
      title: "Resolver widersprechen sich",
      detail: "Öffentliche Resolver liefern unterschiedliche A-Records — Propagation, Geo-DNS oder ein lame NS.",
    });
  }
  if (input.spreadMs !== null && input.spreadMs > 80) {
    notes.push({
      severity: input.spreadMs > 200 ? "bad" : "warn",
      title: "Resolver stark unterschiedlich",
      detail: `${Math.round(input.spreadMs)} ms zwischen schnellstem und langsamstem Resolver.`,
    });
  }
  if (input.cname.length >= 3) {
    notes.push({
      severity: "warn",
      title: "Lange CNAME-Kette",
      detail: `${input.cname.length} Hops: ${input.cname.map((c) => c.value).join(" → ")}`,
    });
  }
  if (!input.spf) {
    notes.push({ severity: "warn", title: "Kein SPF", detail: "Kein TXT v=spf1 — Mail wird leichter gefälscht." });
  } else if (/\+all\b/i.test(input.spf)) {
    notes.push({ severity: "bad", title: "SPF +all", detail: `${input.spf} — erlaubt jedem Host, Mail zu senden.` });
  }
  if (!input.dmarc) {
    notes.push({
      severity: "warn",
      title: "Kein DMARC",
      detail: "_dmarc fehlt. Ohne policy landen Spoof-Mails oft im Posteingang.",
    });
  }
  if (!input.caa.length) {
    notes.push({
      severity: "warn",
      title: "Kein CAA",
      detail: "Keine CA-Restriction. Jede Zertifizierungsstelle darf ein Zertifikat ausstellen.",
    });
  }
  if (!input.ns.length) {
    notes.push({ severity: "bad", title: "Keine NS", detail: "Keine Nameserver-Records." });
  }
  const nsOk = input.nameservers.filter((n) => n.ms !== null);
  const nsFail = input.nameservers.filter((n) => n.error);
  if (nsFail.length && nsOk.length) {
    notes.push({
      severity: "bad",
      title: "Lame / toter Nameserver",
      detail: nsFail.map((n) => `${n.ns}: ${n.error}`).join(" · "),
    });
  }
  if (nsOk.length >= 2) {
    const keys = nsOk.map((n) => setKey(n.addresses));
    if (keys.some((k) => k !== keys[0])) {
      notes.push({
        severity: "bad",
        title: "NS liefern unterschiedliche A",
        detail: "Autoritative Server sind nicht synchron.",
      });
    }
    const times = nsOk.map((n) => n.ms ?? 0);
    const max = Math.max(...times);
    const min = Math.min(...times);
    if (max - min > 150) {
      const slow = nsOk.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))[0];
      notes.push({
        severity: "warn",
        title: "Langsamer Nameserver",
        detail: `${slow?.ns} braucht ${Math.round(slow?.ms ?? 0)} ms, andere ~${Math.round(min)} ms.`,
      });
    }
  }
  const ttl = [...input.a, ...input.aaaa].map((r) => r.ttl).filter((n): n is number => n !== null);
  if (ttl.some((t) => t > 0 && t < 30)) {
    notes.push({
      severity: "warn",
      title: "Sehr kurze TTL",
      detail: `TTL ${Math.min(...ttl)} s — Resolver cachen kaum, jeder Seitenaufruf fragt neu.`,
    });
  }
  if (input.ds.length && input.dnssecAd === false) {
    notes.push({
      severity: "bad",
      title: "DNSSEC kaputt",
      detail: "DS ist da, aber der Resolver setzt das Authentic-Data-Bit nicht.",
    });
  } else if (!input.ds.length && input.dnssecAd === false) {
    notes.push({
      severity: "ok",
      title: "Kein DNSSEC",
      detail: "Optional. Ohne DS kann niemand die Antwort kryptografisch prüfen.",
    });
  }
  if (input.mx.length === 0 && input.spf) {
    notes.push({
      severity: "warn",
      title: "SPF ohne MX",
      detail: "Es gibt eine Mail-Policy, aber keinen MX-Record.",
    });
  }
  if (!notes.some((n) => n.severity === "bad" || n.severity === "warn")) {
    notes.push({
      severity: "ok",
      title: "DNS unauffällig",
      detail: "Resolver einig, NS antworten, keine groben Mail-/CAA-Lücken erkannt.",
    });
  }
  return notes.filter((n) => n.severity !== "ok" || notes.length === 1);
}

export async function inspectDns(domainRaw: string): Promise<DnsInspect> {
  const domain = cleanDomain(domainRaw);

  const [a, aaaa, mx, ns, txt, caa, cname, soaRows, dmarcTxt, dohPack, ds, dnskey, httpsRec] = await Promise.all([
    rec(async () => {
      const rows = await dns.resolve4(domain, { ttl: true });
      return rows.map((r) => ({ type: "A", value: r.address, ttl: r.ttl ?? null }));
    }),
    rec(async () => {
      const rows = await dns.resolve6(domain, { ttl: true });
      return rows.map((r) => ({ type: "AAAA", value: r.address, ttl: r.ttl ?? null }));
    }),
    rec(async () => {
      const rows = await dns.resolveMx(domain);
      return rows.map((r) => ({ type: "MX", value: `${r.priority} ${r.exchange}`, ttl: null }));
    }),
    rec(async () => {
      const rows = await dns.resolveNs(domain);
      return rows.map((r) => ({ type: "NS", value: r.replace(/\.$/, ""), ttl: null }));
    }),
    rec(async () => {
      const rows = await dns.resolveTxt(domain);
      return rows.map((r) => ({ type: "TXT", value: r.join(""), ttl: null }));
    }),
    rec(async () => {
      const rows = await dns.resolveCaa(domain);
      return rows.map((r) => ({
        type: "CAA",
        value: `${r.critical} ${r.issue ?? r.issuewild ?? r.iodef ?? ""}`.trim(),
        ttl: null,
      }));
    }),
    followCname(domain),
    rec(async () => {
      const s = await dns.resolveSoa(domain);
      return [
        {
          type: "SOA",
          value: `${s.nsname} ${s.hostmaster} serial ${s.serial} refresh ${s.refresh} retry ${s.retry} expire ${s.expire} minttl ${s.minttl}`,
          ttl: s.minttl ?? null,
        },
      ];
    }),
    rec(async () => {
      const rows = await dns.resolveTxt(`_dmarc.${domain}`);
      return rows.map((r) => ({ type: "DMARC", value: r.join(""), ttl: null }));
    }),
    Promise.all([
      probeDoh("Cloudflare DoH", `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A&do=1`),
      probeDoh("Google DoH", `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A&do=1`),
      probeDoh("Quad9 DoH", `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(domain)}&type=A`),
    ]),
    rec(async () => {
      const rows = (await dns.resolve(domain, "DS")) as
        | string[]
        | { key_tag?: number; algorithm?: number; digest?: string }[];
      if (Array.isArray(rows) && rows.length && typeof rows[0] === "string") {
        return (rows as string[]).map((v) => ({ type: "DS", value: v, ttl: null }));
      }
      return (rows as { key_tag?: number; algorithm?: number; digest?: string }[]).map((r) => ({
        type: "DS",
        value: `${r.key_tag ?? ""} ${r.algorithm ?? ""} ${r.digest ?? ""}`.trim(),
        ttl: null,
      }));
    }),
    rec(async () => {
      const rows = (await dns.resolve(domain, "DNSKEY")) as string[];
      return (Array.isArray(rows) ? rows : []).slice(0, 4).map((v) => ({ type: "DNSKEY", value: String(v).slice(0, 80), ttl: null }));
    }),
    rec(async () => {
      const doh = await probeDoh("HTTPS", `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=HTTPS`);
      return doh.records
        .filter((r) => r.type === "65" || r.value.toLowerCase().includes("alpn"))
        .map((r) => ({ type: "HTTPS", value: r.value, ttl: r.ttl }));
    }),
  ]);

  const spf = txt.map((t) => t.value).find((v) => v.toLowerCase().startsWith("v=spf1")) ?? null;
  const dmarc = dmarcTxt[0]?.value ?? null;
  const nameservers = await Promise.all(ns.slice(0, 5).map((n) => probeNs(domain, n.value)));

  const ptr: DnsInspect["ptr"] = [];
  for (const recA of a.slice(0, 4)) {
    try {
      const names = await withTimeout(dns.reverse(recA.value), 3000);
      ptr.push({ ip: recA.value, names });
    } catch {
      ptr.push({ ip: recA.value, names: [] });
    }
  }

  const benchLike = {
    answersMatch: true,
    spreadMs: null as number | null,
  };
  const aSets = nameservers.filter((n) => n.addresses.length).map((n) => setKey(n.addresses));
  if (aSets.length >= 2 && aSets.some((k) => k !== aSets[0])) benchLike.answersMatch = false;

  const dnssecAd = dohPack.find((d) => d.ad !== null)?.ad ?? null;
  const findings = diagnoseDns({
    a,
    aaaa,
    mx,
    ns,
    spf,
    dmarc,
    caa,
    cname,
    nameservers,
    answersMatch: benchLike.answersMatch,
    spreadMs: null,
    dnssecAd,
    ds,
  });

  return {
    domain,
    a,
    aaaa,
    mx,
    ns,
    txt: txt.slice(0, 12),
    caa,
    cname,
    soa: soaRows[0]?.value ?? null,
    spf,
    dmarc,
    ds,
    dnskey,
    https: httpsRec,
    dnssecAd,
    ptr,
    nameservers,
    doh: dohPack.map(({ ad: _ad, records: _r, ...p }) => p),
    findings,
  };
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx] ?? null;
}

async function burstResolver(domain: string, name: string, server: string | null, count: number): Promise<DnsBurst> {
  const wall0 = performance.now();
  const jobs = Array.from({ length: count }, async () => {
    const t0 = performance.now();
    try {
      if (server) {
        const resolver = new Resolver();
        resolver.setServers([server]);
        const addresses = await withTimeout(resolver.resolve4(domain), 4000);
        return { ms: performance.now() - t0, ok: true as const, addresses };
      }
      const looked = await withTimeout(dns.lookup(domain, { all: true }), 4000);
      return { ms: performance.now() - t0, ok: true as const, addresses: looked.map((r) => r.address) };
    } catch {
      return { ms: performance.now() - t0, ok: false as const, addresses: [] as string[] };
    }
  });
  const rows = await Promise.all(jobs);
  const wallMs = performance.now() - wall0;
  const okTimes = rows.filter((r) => r.ok).map((r) => r.ms);
  return {
    name,
    server: server ?? "system",
    count,
    ok: okTimes.length,
    minMs: okTimes.length ? Math.min(...okTimes) : null,
    p50Ms: percentile(okTimes, 50),
    p95Ms: percentile(okTimes, 95),
    maxMs: okTimes.length ? Math.max(...okTimes) : null,
    wallMs,
  };
}

function hostsFromHtml(html: string, base: string): string[] {
  const set = new Set<string>();
  try {
    set.add(new URL(base).hostname.toLowerCase());
  } catch {
    /* ignore */
  }
  const consider = (raw: string) => {
    try {
      const abs = new URL(raw.trim(), base);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
      const h = abs.hostname.toLowerCase();
      if (!h) return;
      if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return;
      set.add(h);
    } catch {
      /* ignore */
    }
  };
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) consider(m[0]!);
  for (const m of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) consider(m[1]!);
  for (const m of html.matchAll(/srcset=["']([^"']+)["']/gi)) {
    for (const part of (m[1] ?? "").split(",")) {
      const u = part.trim().split(/\s+/)[0];
      if (u) consider(u);
    }
  }
  return [...set];
}

async function lookupHost(host: string): Promise<DnsHostLookup> {
  const t0 = performance.now();
  try {
    const looked = await withTimeout(dns.lookup(host, { all: true }), 4000);
    const addresses = looked.map((r) => r.address).filter((ip) => !isPrivateOrReservedIp(ip));
    if (!addresses.length) {
      return { host, ms: performance.now() - t0, addresses: [], error: "Nur interne IPs" };
    }
    return { host, ms: performance.now() - t0, addresses, error: null };
  } catch (err) {
    return {
      host,
      ms: performance.now() - t0,
      addresses: [],
      error: err instanceof Error ? err.message : "Fehler",
    };
  }
}

export function diagnoseDnsLoad(bursts: DnsBurst[], hosts: DnsHostLookup[], hostsWallMs: number): DnsFinding[] {
  const notes: DnsFinding[] = [];
  for (const b of bursts) {
    if (b.ok < b.count) {
      notes.push({
        severity: b.ok === 0 ? "bad" : "warn",
        title: `${b.name} verliert Queries unter Last`,
        detail: `${b.ok}/${b.count} erfolgreich · wall ${Math.round(b.wallMs)} ms.`,
      });
    }
    if (b.p95Ms !== null && b.p50Ms !== null && b.p95Ms > 80 && b.p95Ms > b.p50Ms * 2.2) {
      notes.push({
        severity: b.p95Ms > 200 ? "bad" : "warn",
        title: `${b.name} wird bei parallelen Lookups langsamer`,
        detail: `p50 ${Math.round(b.p50Ms)} ms, p95 ${Math.round(b.p95Ms)} ms — so fühlt sich ein Seitenaufruf mit vielen Hosts an.`,
      });
    }
  }
  const slowHosts = hosts.filter((h) => (h.ms ?? 0) >= 80 || h.error);
  for (const h of slowHosts.slice(0, 6)) {
    notes.push({
      severity: h.error || (h.ms ?? 0) > 180 ? "bad" : "warn",
      title: `Langsames DNS: ${h.host}`,
      detail: h.error ?? `${Math.round(h.ms ?? 0)} ms — dieser Host hängt in der Seite, bevor das erste Byte kommt.`,
    });
  }
  if (hosts.length >= 12) {
    notes.push({
      severity: hosts.length >= 20 ? "bad" : "warn",
      title: "Viele DNS-Namen",
      detail: `${hosts.length} verschiedene Hosts. Jeder neue Name ist ein Lookup, solange der Resolver ihn nicht cached.`,
    });
  }
  if (hosts.length >= 4 && hostsWallMs > 250) {
    notes.push({
      severity: hostsWallMs > 600 ? "bad" : "warn",
      title: "DNS-Bündel dauert",
      detail: `${hosts.length} Lookups parallel in ${Math.round(hostsWallMs)} ms (langsamster bestimmt die Wandzeit).`,
    });
  }
  return notes.slice(0, 12);
}

export async function loadTestDns(domainRaw: string): Promise<DnsLoadResult> {
  const domain = cleanDomain(domainRaw);
  const BURST = 8;
  const bursts = await Promise.all([
    burstResolver(domain, "System", null, BURST),
    ...PUBLIC_RESOLVERS.map((r) => burstResolver(domain, r.name, r.server, BURST)),
  ]);

  const hostSet = new Set<string>([domain]);
  try {
    const url = normalizeTargetUrl(domainRaw.includes("://") ? domainRaw : `https://${domain}/`);
    const html = await fetchHtml(url.href, 8000);
    for (const h of hostsFromHtml(html, url.href).slice(0, 24)) hostSet.add(h);
  } catch {
    for (const sub of ["www", "static", "cdn", "images", "assets", "media"]) {
      hostSet.add(`${sub}.${domain}`);
    }
  }

  const hostsList = [...hostSet].slice(0, 24);
  const wall0 = performance.now();
  const hosts = await Promise.all(hostsList.map((h) => lookupHost(h)));
  const hostsWallMs = performance.now() - wall0;
  const findings = diagnoseDnsLoad(bursts, hosts, hostsWallMs);
  return { domain, bursts, hosts: hosts.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)), hostsWallMs, findings };
}


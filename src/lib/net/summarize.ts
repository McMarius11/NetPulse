import type {
  Bottleneck,
  CacheFinding,
  HostBucket,
  ImageFinding,
  ImageReason,
  ImageSource,
  LcpCandidate,
  PageAnalysis,
  PageResource,
  Severity,
  TimedRequest,
} from "./types.ts";

export const SLOW_MS = 400;
export const LARGE_IMAGE = 350_000;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 42 ? `${u.pathname.slice(0, 39)}…` : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url.slice(0, 64);
  }
}

export function buildHosts(resources: PageResource[]): HostBucket[] {
  const map = new Map<string, HostBucket>();
  for (const r of resources) {
    const cur = map.get(r.host) ?? {
      host: r.host,
      count: 0,
      bytes: 0,
      durationMs: 0,
      thirdParty: r.thirdParty,
      failed: 0,
    };
    cur.count += 1;
    cur.bytes += r.sizeBytes;
    cur.durationMs += r.durationMs;
    if (!r.ok && !r.blocked) cur.failed += 1;
    map.set(r.host, cur);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}

function bpp(r: PageResource): number | null {
  if (!r.imageWidth || !r.imageHeight || r.sizeBytes <= 0) return null;
  const px = r.imageWidth * r.imageHeight;
  if (px <= 0) return null;
  return (r.sizeBytes * 8) / px;
}

const SOURCE_LABEL: Record<ImageSource, string> = {
  img: "img src",
  srcset: "srcset",
  picture: "picture/source",
  css: "CSS background",
  lazy: "data-src (Lazy)",
  preload: "preload",
  icon: "favicon",
  og: "og:image",
  other: "sonstiges",
};

export function diagnoseImage(r: PageResource, lcpUrl: string | null): ImageFinding {
  const reasons: ImageReason[] = [];
  const isLcp = lcpUrl === r.url;
  const bits = bpp(r);
  const ttfb = r.ttfbMs;
  const transfer = r.transferMs;

  if (!r.ok) {
    reasons.push({
      severity: "bad",
      title: "Bild nicht geladen",
      detail: r.error ?? `HTTP ${r.status ?? "?"}`,
    });
  }

  if (r.durationMs >= 1200) {
    reasons.push({
      severity: "bad",
      title: "Sehr langsam",
      detail: `${Math.round(r.durationMs)} ms bis das Bild da war.`,
    });
  } else if (r.durationMs >= SLOW_MS) {
    reasons.push({
      severity: "warn",
      title: "Langsam",
      detail: `${Math.round(r.durationMs)} ms Ladezeit.`,
    });
  }

  if (ttfb !== null && transfer !== null && r.ok) {
    if (ttfb >= 400 && ttfb >= transfer) {
      reasons.push({
        severity: ttfb > 900 ? "bad" : "warn",
        title: "Wartezeit vorm Download",
        detail: `TTFB ${Math.round(ttfb)} ms, Transfer nur ${Math.round(transfer)} ms — der Server/CDN liefert spät, die Datei selbst ist nicht das Hauptproblem.`,
      });
    } else if (transfer >= 400 && r.sizeBytes >= 80_000) {
      reasons.push({
        severity: transfer > 1200 ? "bad" : "warn",
        title: "Download dauert",
        detail: `${formatBytes(r.sizeBytes)} in ${Math.round(transfer)} ms — zu viele Bytes auf der Leitung.`,
      });
    }
  }

  if (r.sizeBytes >= LARGE_IMAGE) {
    reasons.push({
      severity: r.sizeBytes > 900_000 ? "bad" : "warn",
      title: "Datei zu groß",
      detail: `${formatBytes(r.sizeBytes)} über die Leitung.`,
    });
  }

  if (bits !== null && r.ok) {
    const fmt = r.imageFormat ?? "";
    if ((fmt === "png" && bits > 6) || ((fmt === "jpeg" || fmt === "jpg" || fmt === "webp") && bits > 3.5) || bits > 8) {
      reasons.push({
        severity: bits > 10 ? "bad" : "warn",
        title: "Ineffizient komprimiert",
        detail: `${bits.toFixed(1)} Bit/Pixel bei ${r.imageWidth}×${r.imageHeight} ${fmt.toUpperCase()} — WebP/AVIF oder stärkere Kompression.`,
      });
    }
  }

  if (r.imageWidth && r.displayWidth && r.imageWidth > r.displayWidth * 2.2 + 20) {
    reasons.push({
      severity: r.imageWidth > r.displayWidth * 3.5 ? "bad" : "warn",
      title: "Überdimensioniert",
      detail: `Datei ${r.imageWidth}×${r.imageHeight ?? "?"} px, im HTML nur ${r.displayWidth}×${r.displayHeight ?? "?"} — der Browser skaliert runter, zahlt aber die volle Datei.`,
    });
  } else if ((r.imageFormat === "png" || r.imageFormat === "jpeg" || r.imageFormat === "jpg") && r.sizeBytes > 180_000) {
    reasons.push({
      severity: "warn",
      title: "Altes Format",
      detail: `${(r.imageFormat ?? "").toUpperCase()} — WebP/AVIF wäre deutlich kleiner.`,
    });
  }

  if (!r.hasSrcset && r.sizeBytes > 80_000 && r.imageFormat !== "svg" && r.ok) {
    reasons.push({
      severity: "warn",
      title: "Kein srcset",
      detail: "Handy und Desktop laden dieselbe Datei.",
    });
  }

  if (r.newHost && r.ok) {
    reasons.push({
      severity: (r.ttfbMs ?? 0) > 300 ? "warn" : "ok",
      title: "Neue Verbindung",
      detail: `Erstes Bild von ${r.host} — DNS/TLS für diesen Host sitzen in der Zeit.`,
    });
  }

  if (r.thirdParty && r.ok) {
    reasons.push({
      severity: r.durationMs > 800 ? "warn" : "ok",
      title: "Fremder Host",
      detail: `${r.host} ist nicht die Seitendomain. Extra DNS, Cookies, oft langsameres CDN.`,
    });
  }

  if (r.redirects.length) {
    reasons.push({
      severity: r.redirects.length > 1 ? "bad" : "warn",
      title: "Redirect vor dem Bild",
      detail: `${r.redirects.length} Umleitung${r.redirects.length === 1 ? "" : "en"}: ${r.redirects.join(" → ")}`,
    });
  }

  if (isLcp && (r.loading === "lazy" || r.imageSource === "lazy")) {
    reasons.push({
      severity: "bad",
      title: "LCP ist lazy",
      detail: "Das größte sichtbare Bild darf nicht loading=lazy oder data-src sein — der Browser holt es zu spät.",
    });
  }

  if (isLcp && !r.preloaded && r.fetchPriority !== "high" && r.ok) {
    reasons.push({
      severity: "warn",
      title: "LCP ohne Priorität",
      detail: "Weder fetchpriority=high noch <link rel=preload as=image> — der Browser entdeckt das Hero-Bild spät.",
    });
  }

  if (r.imageSource === "css" && r.durationMs > 200) {
    reasons.push({
      severity: "warn",
      title: "Aus CSS geladen",
      detail: "Background-Image hängt am Stylesheet. Ohne Preload startet der Download erst nach CSS.",
    });
  }

  if (r.imageSource === "lazy") {
    reasons.push({
      severity: "warn",
      title: "Nur in data-src",
      detail: "Klassisches Lazy-Load: ohne JS sieht der Browser das Bild im ersten Parse nicht.",
    });
  }

  const cc = (r.cacheControl ?? "").toLowerCase();
  if (r.ok && (!cc || cc.includes("no-store") || cc.includes("no-cache") || cc.includes("max-age=0"))) {
    reasons.push({
      severity: "warn",
      title: "Kaum Cache",
      detail: cc ? `Cache-Control: ${r.cacheControl}` : "Kein Cache-Control — jeder Besuch lädt neu.",
    });
  }

  if (r.ok && r.contentType && !r.contentType.startsWith("image/") && !r.contentType.includes("svg") && !r.contentType.includes("octet-stream")) {
    reasons.push({
      severity: "bad",
      title: "Keine Bild-Antwort",
      detail: `Content-Type ${r.contentType} — oft eine Fehlerseite statt des Bildes.`,
    });
  }

  const ranked = reasons.filter((x) => x.severity !== "ok");
  const pool = ranked.length ? ranked : reasons;
  const severity: Severity = pool.some((x) => x.severity === "bad")
    ? "bad"
    : pool.some((x) => x.severity === "warn")
      ? "warn"
      : "ok";
  const primary = pool.find((x) => x.severity === severity);

  return {
    url: r.url,
    format: r.imageFormat,
    width: r.imageWidth,
    height: r.imageHeight,
    displayWidth: r.displayWidth,
    displayHeight: r.displayHeight,
    sizeBytes: r.sizeBytes,
    durationMs: r.durationMs,
    ttfbMs: r.ttfbMs,
    transferMs: r.transferMs,
    host: r.host,
    thirdParty: r.thirdParty,
    hasSrcset: r.hasSrcset,
    loading: r.loading,
    fetchPriority: r.fetchPriority,
    preloaded: r.preloaded,
    redirects: r.redirects.length,
    bitsPerPixel: bits,
    imageSource: r.imageSource,
    newHost: r.newHost,
    issue: primary ? `${primary.title}: ${primary.detail}` : "Unauffällig.",
    reasons,
    severity,
  };
}

export function imageFindings(resources: PageResource[], lcpUrl: string | null): ImageFinding[] {
  const rank: Record<Severity, number> = { bad: 0, warn: 1, ok: 2 };
  return resources
    .filter((x) => x.type === "image")
    .map((r) => diagnoseImage(r, lcpUrl))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || b.durationMs - a.durationMs)
    .slice(0, 40);
}

export function cacheFindings(resources: PageResource[]): CacheFinding[] {
  const out: CacheFinding[] = [];
  for (const r of resources) {
    if (r.blocked || r.type === "document" || r.type === "image") continue;
    const cc = (r.cacheControl ?? "").toLowerCase();
    const staticAsset = ["stylesheet", "script", "font"].includes(r.type);
    const compressed = Boolean(r.contentEncoding);
    if (staticAsset && r.sizeBytes > 4_000 && !compressed) {
      out.push({
        url: r.url,
        cacheControl: r.cacheControl,
        compressed,
        cdn: r.cdnCache,
        issue: "Keine Kompression (gzip/br) auf Text-Asset.",
        severity: r.sizeBytes > 80_000 ? "bad" : "warn",
      });
    } else if (staticAsset && (!cc || cc.includes("no-store") || cc.includes("no-cache") || cc.includes("max-age=0"))) {
      out.push({
        url: r.url,
        cacheControl: r.cacheControl,
        compressed,
        cdn: r.cdnCache,
        issue: cc ? `Cache schwach: ${r.cacheControl}` : "Kein Cache-Control — Browser muss jedes Mal neu holen.",
        severity: "warn",
      });
    }
  }
  return out.slice(0, 12);
}

export function pickLcp(resources: PageResource[]): LcpCandidate | null {
  const images = resources.filter(
    (r) => r.type === "image" && r.ok && !r.blocked && r.imageSource !== "icon" && r.imageSource !== "og",
  );
  const best = [...images].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
  if (best) {
    return {
      url: best.url,
      type: best.type,
      sizeBytes: best.sizeBytes,
      durationMs: best.durationMs,
      startMs: best.startMs,
      reason: `${SOURCE_LABEL[best.imageSource]} · größtes sichtbares Bild.`,
    };
  }
  const doc = resources.find((r) => r.type === "document");
  if (!doc) return null;
  return {
    url: doc.url,
    type: "document",
    sizeBytes: doc.sizeBytes,
    durationMs: doc.durationMs,
    startMs: 0,
    reason: "Kein Bild gefunden — das HTML selbst bestimmt den First Look.",
  };
}

export function diagnose(
  doc: TimedRequest,
  resources: PageResource[],
  hosts: HostBucket[],
  lcp: LcpCandidate | null,
  images: ImageFinding[],
  opts: { requestCap?: number } = {},
): Bottleneck[] {
  const requestCap = opts.requestCap ?? 48;
  const notes: Bottleneck[] = [];
  if (!doc.ok) {
    notes.push({
      severity: "bad",
      title: "Dokument nicht geladen",
      detail: doc.error ?? `HTTP ${doc.status ?? "?"}`,
      relatedUrl: doc.url,
    });
  }
  if (doc.redirects.length) {
    notes.push({
      severity: doc.redirects.length > 2 ? "bad" : "warn",
      title: `${doc.redirects.length} Redirect${doc.redirects.length === 1 ? "" : "s"}`,
      detail: [doc.url, ...doc.redirects].join(" → "),
    });
  }
  if (doc.dnsMs !== null && doc.dnsMs > 80) {
    notes.push({
      severity: doc.dnsMs > 180 ? "bad" : "warn",
      title: "Langsames DNS",
      detail: `Namensauflösung dauerte ${Math.round(doc.dnsMs)} ms. Ein anderer Resolver kann helfen.`,
    });
  }
  if (doc.ttfbMs !== null && doc.ttfbMs > 500) {
    notes.push({
      severity: doc.ttfbMs > 1200 ? "bad" : "warn",
      title: "Hohe TTFB",
      detail: `Der Server hat ${Math.round(doc.ttfbMs)} ms bis zum ersten Byte gebraucht.`,
      relatedUrl: doc.finalUrl,
    });
  }
  if (doc.tls?.daysLeft !== null && doc.tls?.daysLeft !== undefined && doc.tls.daysLeft < 21) {
    notes.push({
      severity: doc.tls.daysLeft < 0 ? "bad" : "warn",
      title: doc.tls.daysLeft < 0 ? "TLS-Zertifikat abgelaufen" : "TLS-Zertifikat läuft bald ab",
      detail: `${doc.tls.subject ?? "Zertifikat"} · noch ${doc.tls.daysLeft} Tage · Issuer ${doc.tls.issuer ?? "—"}`,
    });
  }
  if (lcp && lcp.durationMs + lcp.startMs > 1500 && lcp.type === "image") {
    notes.push({
      severity: lcp.durationMs > 2500 ? "bad" : "warn",
      title: "LCP-Kandidat ist langsam",
      detail: `${shortUrl(lcp.url)} nach ${Math.round(lcp.startMs + lcp.durationMs)} ms, ${formatBytes(lcp.sizeBytes)}.`,
      relatedUrl: lcp.url,
    });
  }
  const worstImg =
    images.find((i) => i.severity === "bad") ??
    images.find((i) => i.severity === "warn" && i.reasons.some((r) => !["Neue Verbindung", "Fremder Host"].includes(r.title)));
  if (worstImg) {
    const lead = worstImg.reasons.find((r) => r.severity === worstImg.severity) ?? worstImg.reasons[0];
    notes.push({
      severity: worstImg.severity,
      title: `Bild: ${lead?.title ?? "Problem"}`,
      detail: worstImg.issue,
      relatedUrl: worstImg.url,
    });
  }
  const third = hosts.filter((h) => h.thirdParty);
  const thirdBytes = third.reduce((s, h) => s + h.bytes, 0);
  const totalBytes = hosts.reduce((s, h) => s + h.bytes, 0) || 1;
  if (third.length >= 6 || thirdBytes / totalBytes > 0.45) {
    notes.push({
      severity: third.length >= 10 ? "bad" : "warn",
      title: "Viele Drittanbieter",
      detail: `${third.length} fremde Hosts, ${formatBytes(thirdBytes)} — Tracker-Block in der Analyse zum Vergleichen.`,
    });
  }
  const slow = resources.filter((r) => r.ok && !r.blocked && r.durationMs >= SLOW_MS && r.type !== "image");
  for (const r of [...slow].sort((a, b) => b.durationMs - a.durationMs).slice(0, 4)) {
    notes.push({
      severity: r.durationMs > 1200 ? "bad" : "warn",
      title: `Langsame Ressource (${r.type})`,
      detail: `${Math.round(r.durationMs)} ms · ${formatBytes(r.sizeBytes)}`,
      relatedUrl: r.url,
    });
  }
  const failed = resources.filter((r) => !r.ok && !r.blocked);
  if (failed.length) {
    notes.push({
      severity: "bad",
      title: `${failed.length} Ressource${failed.length === 1 ? "" : "n"} fehlgeschlagen`,
      detail: failed
        .slice(0, 4)
        .map((f) => shortUrl(f.url))
        .join(", "),
    });
  }
  if (resources.length >= requestCap) {
    notes.push({
      severity: "warn",
      title: "Viele Requests",
      detail: `${resources.length} Dateien in dieser Analyse. Viele Requests verlängern die Ladezeit.`,
    });
  }
  if (!notes.length && doc.ok) {
    notes.push({
      severity: "ok",
      title: "Keine groben Engpässe",
      detail: "DNS, TTFB und Ressourcen liegen im unkritischen Bereich.",
    });
  }
  return notes;
}

export function enrichAnalysis(
  document: TimedRequest,
  resources: PageResource[],
  extras: Pick<PageAnalysis, "tls" | "blockedTrackers" | "pageHost" | "blockTrackers" | "analyzedAt">,
  opts: { requestCap?: number } = {},
): PageAnalysis {
  const hosts = buildHosts(resources);
  const lcp = pickLcp(resources);
  const imagesList = resources.filter((r) => r.type === "image");
  const findings = imageFindings(resources, lcp?.type === "image" ? lcp.url : null);
  const third = resources.filter((r) => r.thirdParty);
  const failed = resources.filter((r) => !r.ok && !r.blocked);
  return {
    document,
    resources,
    bottlenecks: diagnose(
      document,
      resources.filter((r) => r.type !== "document"),
      hosts,
      lcp,
      findings,
      opts,
    ),
    totals: {
      count: resources.length,
      failed: failed.length,
      bytes: resources.reduce((s, r) => s + r.sizeBytes, 0),
      images: imagesList.length,
      scripts: resources.filter((r) => r.type === "script").length,
      styles: resources.filter((r) => r.type === "stylesheet").length,
      slow: resources.filter((r) => r.durationMs >= SLOW_MS).length,
      thirdParty: third.length,
      thirdPartyBytes: third.reduce((s, r) => s + r.sizeBytes, 0),
    },
    hosts,
    images: findings,
    cache: cacheFindings(resources),
    lcp,
    ...extras,
  };
}

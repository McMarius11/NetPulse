import net from "node:net";
import { cdnFrom, decodeBody, header, httpGet, resolvePublic, timeUrl, timeUrlWithBody } from "./http.ts";
import { formatFromType, readImageMeta } from "./images.ts";
import { normalizeTargetUrl } from "./ssrf.ts";
import { hostOf, isThirdParty, isTrackerUrl } from "./trackers.ts";
import { enrichAnalysis } from "./summarize.ts";
import type {
  CrawlPage,
  CrawlResult,
  ImageSource,
  PageAnalysis,
  PageResource,
  ResourceType,
  TcpCheck,
} from "./types.ts";

export { benchmarkDns, inspectDns, loadTestDns } from "./dns.ts";
export { timeUrl } from "./http.ts";

const RES_TIMEOUT = 12_000;
const MAX_RESOURCES = 72;
const CONCURRENCY = 8;

function classify(url: string, hint: ResourceType, contentType: string | null): ResourceType {
  if (hint !== "other") return hint;
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/.test(path)) return "image";
  if (/\.(js|mjs|cjs)$/.test(path)) return "script";
  if (/\.css$/.test(path)) return "stylesheet";
  if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return "font";
  if (/\.(mp4|webm|mp3|m4a|ogg|wav)$/.test(path)) return "media";
  if (contentType) {
    if (contentType.startsWith("image/")) return "image";
    if (contentType.includes("javascript")) return "script";
    if (contentType.includes("css")) return "stylesheet";
    if (contentType.includes("font")) return "font";
    if (contentType.startsWith("video/") || contentType.startsWith("audio/")) return "media";
  }
  return "other";
}

type FoundRes = {
  type: ResourceType;
  hasSrcset: boolean;
  displayWidth: number | null;
  displayHeight: number | null;
  loading: string | null;
  fetchPriority: string | null;
  preloaded: boolean;
  imageSource: ImageSource;
};

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([:@\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

function px(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mergeFound(set: Map<string, FoundRes>, href: string, patch: Partial<FoundRes> & { type: ResourceType }) {
  const prev = set.get(href);
  if (!prev) {
    set.set(href, {
      type: patch.type,
      hasSrcset: Boolean(patch.hasSrcset),
      displayWidth: patch.displayWidth ?? null,
      displayHeight: patch.displayHeight ?? null,
      loading: patch.loading ?? null,
      fetchPriority: patch.fetchPriority ?? null,
      preloaded: Boolean(patch.preloaded),
      imageSource: patch.imageSource ?? (patch.type === "image" ? "img" : "other"),
    });
    return;
  }
  if (patch.hasSrcset) prev.hasSrcset = true;
  if (patch.preloaded) prev.preloaded = true;
  if (patch.displayWidth && !prev.displayWidth) prev.displayWidth = patch.displayWidth;
  if (patch.displayHeight && !prev.displayHeight) prev.displayHeight = patch.displayHeight;
  if (patch.loading && !prev.loading) prev.loading = patch.loading;
  if (patch.fetchPriority && !prev.fetchPriority) prev.fetchPriority = patch.fetchPriority;
  if (patch.imageSource && prev.imageSource === "other") prev.imageSource = patch.imageSource;
}

function addUrl(set: Map<string, FoundRes>, raw: string, base: string, patch: Partial<FoundRes> & { type: ResourceType }) {
  try {
    const abs = new URL(raw.trim(), base);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    mergeFound(set, abs.href, patch);
  } catch {
    /* ignore */
  }
}

function addSrcset(set: Map<string, FoundRes>, srcset: string, base: string, patch: Partial<FoundRes> & { type: ResourceType }) {
  for (const part of srcset.split(",")) {
    const u = part.trim().split(/\s+/)[0];
    if (u) addUrl(set, u, base, { ...patch, hasSrcset: true, imageSource: patch.imageSource ?? "srcset" });
  }
}

function extractResources(html: string, base: string): Map<string, FoundRes> {
  const found = new Map<string, FoundRes>();

  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1] ?? "");
    const src = a.src;
    const srcset = a.srcset;
    const lazy = a["data-src"] || a["data-lazy-src"] || a["data-original"] || a["data-lazy"];
    const meta = {
      type: "image" as const,
      displayWidth: px(a.width),
      displayHeight: px(a.height),
      loading: a.loading?.toLowerCase() ?? null,
      fetchPriority: (a.fetchpriority ?? a["fetch-priority"])?.toLowerCase() ?? null,
      hasSrcset: Boolean(srcset),
    };
    if (src) addUrl(found, src, base, { ...meta, imageSource: "img" });
    if (srcset) addSrcset(found, srcset, base, { ...meta, imageSource: "srcset" });
    if (lazy && lazy !== src) addUrl(found, lazy, base, { ...meta, imageSource: "lazy", loading: "lazy" });
  }

  for (const m of html.matchAll(/<source\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1] ?? "");
    if (a.srcset) addSrcset(found, a.srcset, base, { type: "image", imageSource: "picture", hasSrcset: true });
    if (a.src && /\.(png|jpe?g|gif|webp|avif|svg)/i.test(a.src)) {
      addUrl(found, a.src, base, { type: "image", imageSource: "picture" });
    }
  }

  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1] ?? "");
    const rel = (a.rel ?? "").toLowerCase();
    if (rel.includes("stylesheet") && a.href) addUrl(found, a.href, base, { type: "stylesheet", imageSource: "other" });
    if (rel.includes("icon") && a.href) addUrl(found, a.href, base, { type: "image", imageSource: "icon" });
    if (rel.includes("preload") && a.href) {
      const as = (a.as ?? "").toLowerCase();
      if (as === "image") addUrl(found, a.href, base, { type: "image", imageSource: "preload", preloaded: true });
      else addUrl(found, a.href, base, { type: "other", imageSource: "other", preloaded: true });
    }
  }

  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1] ?? "");
    const prop = (a.property ?? a.name ?? "").toLowerCase();
    if (prop === "og:image" && a.content) addUrl(found, a.content, base, { type: "image", imageSource: "og" });
  }

  const attr = (re: RegExp, type: ResourceType) => {
    for (const m of html.matchAll(re)) {
      if (m[1]) addUrl(found, m[1], base, { type, imageSource: "other" });
    }
  };
  attr(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi, "script");
  attr(/<(?:video|audio)\b[^>]*\bsrc=["']([^"']+)["']/gi, "media");
  attr(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi, "other");
  return found;
}

function extractCssUrls(css: string, base: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    const raw = m[1]?.trim();
    if (!raw || raw.startsWith("data:")) continue;
    try {
      const abs = new URL(raw, base);
      if (abs.protocol === "http:" || abs.protocol === "https:") out.push(abs.href);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function extractSameOriginLinks(html: string, base: string, origin: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["']/gi)) {
    const raw = m[1]?.trim();
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("javascript:") || raw.startsWith("tel:")) continue;
    try {
      const abs = new URL(raw, base);
      if (abs.origin !== origin) continue;
      if (/\.(pdf|zip|png|jpe?g|gif|webp|mp4|mp3|css|js)$/i.test(abs.pathname)) continue;
      const key = `${abs.origin}${abs.pathname}`.replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(abs.href);
    } catch {
      /* ignore */
    }
  }
  return urls;
}

async function fetchResource(url: string, meta: FoundRes, startMs: number, pageHost: string): Promise<PageResource> {
  const t0 = performance.now();
  const host = hostOf(url);
  const base: PageResource = {
    url,
    type: meta.type,
    status: null,
    ok: false,
    error: null,
    sizeBytes: 0,
    durationMs: 0,
    startMs,
    contentType: null,
    host,
    thirdParty: isThirdParty(host, pageHost),
    cacheControl: null,
    contentEncoding: null,
    cdnCache: null,
    imageWidth: null,
    imageHeight: null,
    imageFormat: null,
    hasSrcset: meta.hasSrcset,
    blocked: false,
    displayWidth: meta.displayWidth,
    displayHeight: meta.displayHeight,
    loading: meta.loading,
    fetchPriority: meta.fetchPriority,
    preloaded: meta.preloaded,
    ttfbMs: null,
    transferMs: null,
    redirects: [],
    imageSource: meta.imageSource,
    newHost: false,
  };
  try {
    const parsed = normalizeTargetUrl(url);
    const got = await httpGet(parsed, RES_TIMEOUT);
    const contentType = header(got.headers, "content-type");
    const encoding = header(got.headers, "content-encoding");
    const kind = classify(parsed.href, meta.type, contentType);
    let width: number | null = null;
    let height: number | null = null;
    let format = formatFromType(contentType, parsed.href);
    if (kind === "image") {
      const decoded = decodeBody(got.body, encoding);
      const img = readImageMeta(decoded);
      if (img) {
        width = img.width || null;
        height = img.height || null;
        format = img.format;
      }
    }
    return {
      ...base,
      url: parsed.href,
      type: kind,
      status: got.status,
      ok: got.status >= 200 && got.status < 400,
      error: got.status >= 200 && got.status < 400 ? null : `HTTP ${got.status}`,
      sizeBytes: got.body.length,
      durationMs: got.totalMs || performance.now() - t0,
      contentType,
      cacheControl: header(got.headers, "cache-control"),
      contentEncoding: encoding,
      cdnCache: cdnFrom(got.headers),
      imageWidth: width,
      imageHeight: height,
      imageFormat: format,
      ttfbMs: got.ttfbMs,
      transferMs: got.transferMs,
      redirects: got.redirects,
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : "Fehler",
      durationMs: performance.now() - t0,
    };
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      if (item === undefined) return;
      out[idx] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function analyzePage(raw: string, opts: { blockTrackers?: boolean } = {}): Promise<PageAnalysis> {
  const blockTrackers = Boolean(opts.blockTrackers);
  const url = normalizeTargetUrl(raw);
  const fetched = await timeUrlWithBody(url.href);
  const doc = fetched.timed;
  const pageHost = hostOf(doc.finalUrl || url.href) || url.hostname;

  if (!doc.ok && !doc.status) {
    return enrichAnalysis(doc, [], {
      tls: doc.tls,
      blockedTrackers: [],
      pageHost,
      blockTrackers,
      analyzedAt: new Date().toISOString(),
    });
  }

  let html = "";
  try {
    html = decodeBody(fetched.body, fetched.encoding).toString("utf8");
  } catch {
    html = "";
  }

  const map = extractResources(html, doc.finalUrl || url.href);
  const stylesheets = [...map.entries()].filter(([, v]) => v.type === "stylesheet").slice(0, 4);
  for (const [cssUrl] of stylesheets) {
    try {
      const parsed = normalizeTargetUrl(cssUrl);
      const got = await httpGet(parsed, 8000);
      const css = decodeBody(got.body, header(got.headers, "content-encoding")).toString("utf8");
      for (const img of extractCssUrls(css, parsed.href).slice(0, 12)) {
        if (!map.has(img)) {
          map.set(img, {
            type: "image",
            hasSrcset: false,
            displayWidth: null,
            displayHeight: null,
            loading: null,
            fetchPriority: null,
            preloaded: false,
            imageSource: "css",
          });
        }
      }
    } catch {
      /* ignore css parse */
    }
  }

  const blockedTrackers: { url: string; host: string }[] = [];
  const fetchable: [string, FoundRes][] = [];
  for (const [href, meta] of map) {
    if (blockTrackers && isTrackerUrl(href)) {
      blockedTrackers.push({ url: href, host: hostOf(href) });
      continue;
    }
    fetchable.push([href, meta]);
  }

  const list = fetchable
    .slice()
    .sort((a, b) => Number(b[1].type === "image") - Number(a[1].type === "image"))
    .slice(0, MAX_RESOURCES);
  const origin = performance.now();
  const resources = await mapPool(list, CONCURRENCY, async ([href, meta]) => {
    const startMs = performance.now() - origin;
    return fetchResource(href, meta, startMs, pageHost);
  });

  const blankExtra = {
    displayWidth: null as number | null,
    displayHeight: null as number | null,
    loading: null as string | null,
    fetchPriority: null as string | null,
    preloaded: false,
    ttfbMs: doc.ttfbMs,
    transferMs: doc.transferMs,
    redirects: doc.redirects,
    imageSource: "other" as const,
    newHost: true,
  };
  const docRow: PageResource = {
    url: doc.finalUrl || url.href,
    type: "document",
    status: doc.status,
    ok: doc.ok,
    error: doc.error,
    sizeBytes: doc.sizeBytes,
    durationMs: doc.totalMs,
    startMs: 0,
    contentType: doc.contentType,
    host: pageHost,
    thirdParty: false,
    cacheControl: doc.cacheControl,
    contentEncoding: doc.contentEncoding,
    cdnCache: doc.cdnCache,
    imageWidth: null,
    imageHeight: null,
    imageFormat: null,
    hasSrcset: false,
    blocked: false,
    ...blankExtra,
  };
  const allResources = [docRow, ...resources];
  const seen = new Set<string>();
  for (const r of [...allResources].sort((a, b) => a.startMs - b.startMs)) {
    if (!seen.has(r.host)) {
      r.newHost = true;
      seen.add(r.host);
    } else {
      r.newHost = false;
    }
  }
  return enrichAnalysis(
    doc,
    allResources.sort((a, b) => b.durationMs - a.durationMs),
    {
      tls: doc.tls,
      blockedTrackers,
      pageHost,
      blockTrackers,
      analyzedAt: new Date().toISOString(),
    },
    { requestCap: MAX_RESOURCES },
  );
}

export async function crawlSite(raw: string): Promise<CrawlResult> {
  const url = normalizeTargetUrl(raw);
  const start = url.href;
  let html = "";
  try {
    const got = await httpGet(url, 20_000);
    html = decodeBody(got.body, header(got.headers, "content-encoding")).toString("utf8");
  } catch (err) {
    return {
      start,
      pages: [
        {
          url: start,
          status: null,
          totalMs: 0,
          ttfbMs: null,
          sizeBytes: 0,
          ok: false,
          error: err instanceof Error ? err.message : "Fehler",
        },
      ],
    };
  }
  const links = extractSameOriginLinks(html, url.href, url.origin).filter((u) => u !== url.href).slice(0, 8);
  const targets = [url.href, ...links];
  const pages = await mapPool(targets, 3, async (href) => {
    try {
      const timed = await timeUrl(href);
      return {
        url: timed.finalUrl || href,
        status: timed.status,
        totalMs: timed.totalMs,
        ttfbMs: timed.ttfbMs,
        sizeBytes: timed.sizeBytes,
        ok: timed.ok,
        error: timed.error,
      } satisfies CrawlPage;
    } catch (err) {
      return {
        url: href,
        status: null,
        totalMs: 0,
        ttfbMs: null,
        sizeBytes: 0,
        ok: false,
        error: err instanceof Error ? err.message : "Fehler",
      } satisfies CrawlPage;
    }
  });
  return { start, pages };
}

export async function tcpCheck(hostRaw: string, port: number): Promise<TcpCheck> {
  const host = hostRaw.trim().replace(/^https?:\/\//, "").split("/")[0] ?? "";
  if (!host) throw new Error("Bitte Host eingeben.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port muss zwischen 1 und 65535 liegen.");
  }
  if (!net.isIP(host) && !/^[a-zA-Z0-9.-]+$/.test(host)) {
    throw new Error("Ungültiger Host.");
  }
  const ips = await resolvePublic(host);
  const ip = ips[0]!;
  const t0 = performance.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port, timeout: 6000 }, () => {
      const ms = performance.now() - t0;
      socket.end();
      resolve({ host, port, ok: true, ms, error: null, ip });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ host, port, ok: false, ms: null, error: "Timeout", ip });
    });
    socket.on("error", (err) => {
      resolve({ host, port, ok: false, ms: null, error: err.message, ip });
    });
  });
}

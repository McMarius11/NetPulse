import type { PageAnalysis, PageResource, ResourceType, TimedRequest } from "./types.ts";
import { hostOf, isThirdParty } from "./trackers.ts";
import { enrichAnalysis } from "./summarize.ts";

type HarHeader = { name: string; value: string };
type HarEntry = {
  startedDateTime?: string;
  time?: number;
  request?: { url?: string; method?: string; httpVersion?: string; headers?: HarHeader[] };
  response?: {
    status?: number;
    httpVersion?: string;
    headers?: HarHeader[];
    content?: { size?: number; mimeType?: string; compression?: number };
    redirectURL?: string;
    bodySize?: number;
  };
  timings?: { dns?: number; connect?: number; ssl?: number; wait?: number; receive?: number };
  _resourceType?: string;
};

type HarFile = {
  log?: { pages?: { id?: string; title?: string; startedDateTime?: string }[]; entries?: HarEntry[] };
  entries?: HarEntry[];
};

const TYPE_MAP: Record<string, ResourceType> = {
  document: "document",
  main_frame: "document",
  image: "image",
  img: "image",
  script: "script",
  javascript: "script",
  stylesheet: "stylesheet",
  css: "stylesheet",
  font: "font",
  media: "media",
  xhr: "xhr",
  fetch: "xhr",
};

function harType(entry: HarEntry, mime: string | null): ResourceType {
  const raw = (entry._resourceType ?? "").toLowerCase();
  if (raw && TYPE_MAP[raw]) return TYPE_MAP[raw]!;
  if (mime?.startsWith("image/")) return "image";
  if (mime?.includes("javascript")) return "script";
  if (mime?.includes("css")) return "stylesheet";
  if (mime?.includes("font")) return "font";
  if (mime?.startsWith("video/") || mime?.startsWith("audio/")) return "media";
  if (mime?.includes("html")) return "document";
  return "other";
}

function header(headers: HarHeader[] | undefined, name: string): string | null {
  const h = headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function emptyDoc(url: string): TimedRequest {
  return {
    url,
    finalUrl: url,
    status: null,
    ok: false,
    error: null,
    sizeBytes: 0,
    contentType: null,
    server: null,
    cacheControl: null,
    contentEncoding: null,
    age: null,
    cdnCache: null,
    httpVersion: null,
    alpn: null,
    ip: null,
    tlsProtocol: null,
    tls: null,
    redirects: [],
    dnsMs: null,
    tcpMs: null,
    tlsMs: null,
    ttfbMs: null,
    transferMs: null,
    totalMs: 0,
  };
}

function isHttpUrl(url: string) {
  return url.startsWith("http://") || url.startsWith("https://");
}

function transferred(entry: HarEntry): number {
  const size = entry.response?.content?.size;
  if (typeof size === "number" && size >= 0) return size;
  const body = entry.response?.bodySize;
  if (typeof body === "number" && body >= 0) return body;
  return 0;
}

export function analysisFromHar(json: unknown): PageAnalysis {
  const har = json as HarFile;
  const entries = har.log?.entries ?? har.entries ?? [];
  if (!entries.length) throw new Error("HAR enthält keine Einträge.");

  const httpEntries = entries.filter((e) => isHttpUrl(e.request?.url ?? ""));
  if (!httpEntries.length) throw new Error("HAR enthält keine http(s)-Requests.");

  const t0 = httpEntries
    .map((e) => Date.parse(e.startedDateTime ?? ""))
    .filter((n) => Number.isFinite(n));
  const origin = t0.length ? Math.min(...t0) : Date.now();
  const pageUrl = har.log?.pages?.[0]?.title || httpEntries[0]?.request?.url || "har://import";
  let pageHost = isHttpUrl(pageUrl) ? hostOf(pageUrl) : "";
  const resources: PageResource[] = [];
  const redirects: string[] = [];

  for (const entry of httpEntries.slice(0, 250)) {
    const url = entry.request?.url;
    if (!url) continue;
    const mime = entry.response?.content?.mimeType ?? header(entry.response?.headers, "content-type");
    const type = harType(entry, mime);
    const start = Date.parse(entry.startedDateTime ?? "");
    const host = hostOf(url);
    if (!pageHost) pageHost = host;
    const status = entry.response?.status ?? null;
    const redirect = entry.response?.redirectURL;
    if (redirect) redirects.push(redirect);
    resources.push({
      url,
      type,
      status,
      ok: status !== null && status >= 200 && status < 400,
      error: status !== null && status >= 400 ? `HTTP ${status}` : status === 0 ? "blockiert" : null,
      sizeBytes: transferred(entry),
      durationMs: Math.max(0, entry.time ?? 0),
      startMs: Number.isFinite(start) ? Math.max(0, start - origin) : 0,
      contentType: mime,
      host,
      thirdParty: isThirdParty(host, pageHost),
      cacheControl: header(entry.response?.headers, "cache-control"),
      contentEncoding: header(entry.response?.headers, "content-encoding"),
      cdnCache: header(entry.response?.headers, "cf-cache-status") ?? header(entry.response?.headers, "x-cache"),
      imageWidth: null,
      imageHeight: null,
      imageFormat: mime?.startsWith("image/") ? mime.slice(6).split(";")[0] ?? null : null,
      hasSrcset: false,
      blocked: status === 0,
      displayWidth: null,
      displayHeight: null,
      loading: null,
      fetchPriority: null,
      preloaded: false,
      ttfbMs: entry.timings?.wait && entry.timings.wait >= 0 ? entry.timings.wait : null,
      transferMs: entry.timings?.receive && entry.timings.receive >= 0 ? entry.timings.receive : null,
      redirects: redirect && isHttpUrl(redirect) ? [redirect] : [],
      imageSource: type === "image" ? "img" : "other",
      newHost: false,
    });
  }

  if (!resources.length) throw new Error("HAR enthält keine auswertbaren Requests.");

  const docRes = resources.find((r) => r.type === "document") ?? resources[0]!;
  const first = httpEntries.find((e) => e.request?.url === docRes.url) ?? httpEntries[0];
  const document: TimedRequest = {
    ...emptyDoc(docRes.url),
    url: isHttpUrl(pageUrl) ? pageUrl : docRes.url,
    finalUrl: docRes.url,
    status: docRes.status,
    ok: docRes.ok,
    sizeBytes: docRes.sizeBytes,
    contentType: docRes.contentType,
    cacheControl: docRes.cacheControl,
    contentEncoding: docRes.contentEncoding,
    cdnCache: docRes.cdnCache,
    httpVersion: first?.response?.httpVersion ?? first?.request?.httpVersion ?? null,
    dnsMs: first?.timings?.dns && first.timings.dns >= 0 ? first.timings.dns : null,
    tcpMs: first?.timings?.connect && first.timings.connect >= 0 ? first.timings.connect : null,
    tlsMs: first?.timings?.ssl && first.timings.ssl >= 0 ? first.timings.ssl : null,
    ttfbMs: first?.timings?.wait && first.timings.wait >= 0 ? first.timings.wait : null,
    transferMs: first?.timings?.receive && first.timings.receive >= 0 ? first.timings.receive : null,
    totalMs: docRes.durationMs,
    redirects: redirects.filter((u) => u && u !== docRes.url).slice(0, 8),
  };

  return enrichAnalysis(
    document,
    resources,
    {
      tls: null,
      blockedTrackers: [],
      pageHost,
      blockTrackers: false,
      analyzedAt: har.log?.pages?.[0]?.startedDateTime ?? new Date().toISOString(),
    },
    { requestCap: 80 },
  );
}

export function analysisToHar(data: PageAnalysis): unknown {
  const started = data.analyzedAt || new Date().toISOString();
  const origin = Date.parse(started) || Date.now();
  return {
    log: {
      version: "1.2",
      creator: { name: "NetPulse", version: "1.1" },
      pages: [
        {
          startedDateTime: started,
          id: "page_1",
          title: data.document.finalUrl || data.document.url,
          pageTimings: { onContentLoad: -1, onLoad: Math.round(data.document.totalMs) },
        },
      ],
      entries: data.resources.map((r) => ({
        startedDateTime: new Date(origin + r.startMs).toISOString(),
        time: Math.round(r.durationMs),
        request: {
          method: "GET",
          url: r.url,
          httpVersion: data.document.httpVersion ?? "HTTP/1.1",
          cookies: [],
          headers: [],
          queryString: [],
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          status: r.status ?? 0,
          statusText: r.ok ? "OK" : r.error ?? "",
          httpVersion: data.document.httpVersion ?? "HTTP/1.1",
          cookies: [],
          headers: [
            ...(r.contentType ? [{ name: "Content-Type", value: r.contentType }] : []),
            ...(r.cacheControl ? [{ name: "Cache-Control", value: r.cacheControl }] : []),
            ...(r.contentEncoding ? [{ name: "Content-Encoding", value: r.contentEncoding }] : []),
          ],
          content: { size: r.sizeBytes, mimeType: r.contentType ?? "application/octet-stream" },
          redirectURL: "",
          headersSize: -1,
          bodySize: r.sizeBytes,
        },
        cache: {},
        timings: {
          blocked: -1,
          dns: r.type === "document" ? (data.document.dnsMs ?? -1) : -1,
          connect: r.type === "document" ? (data.document.tcpMs ?? -1) : -1,
          ssl: r.type === "document" ? (data.document.tlsMs ?? -1) : -1,
          send: 0,
          wait: r.type === "document" ? (data.document.ttfbMs ?? Math.round(r.durationMs)) : Math.round(r.durationMs),
          receive: r.type === "document" ? (data.document.transferMs ?? 0) : 0,
        },
        _resourceType: r.type,
        pageref: "page_1",
      })),
    },
  };
}

export function parseHarText(text: string): PageAnalysis {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("HAR ist kein gültiges JSON.");
  }
  return analysisFromHar(json);
}

import dnsPromises from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import zlib from "node:zlib";
import { assertPublicIps, isPrivateOrReservedIp, normalizeTargetUrl } from "./ssrf.ts";
import type { TimedRequest, TlsInfo } from "./types.ts";

export const UA = "NetPulse/1.1 (network diagnostics)";
export const DOC_TIMEOUT = 20_000;

export type TimedFetch = {
  timed: TimedRequest;
  body: Buffer;
  encoding: string | null;
};

export function header(headers: http.IncomingHttpHeaders, name: string): string | null {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export function cdnFrom(headers: http.IncomingHttpHeaders): string | null {
  return header(headers, "cf-cache-status") ?? header(headers, "x-cache") ?? header(headers, "x-cache-status");
}

export function decodeBody(buf: Buffer, encoding: string | null): Buffer {
  if (!encoding) return buf;
  const e = encoding.toLowerCase();
  try {
    if (e.includes("gzip")) return zlib.gunzipSync(buf);
    if (e.includes("deflate")) return zlib.inflateSync(buf);
    if (e.includes("br")) return zlib.brotliDecompressSync(buf);
  } catch {
    return buf;
  }
  return buf;
}

export async function resolvePublic(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error("Private oder reservierte IP-Adressen sind gesperrt.");
    }
    return [hostname];
  }
  const looked = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  const ips = looked.map((r) => r.address);
  assertPublicIps(ips);
  return ips.filter((ip) => !isPrivateOrReservedIp(ip));
}

/** Pin the TCP connection to a pre-checked public IP so DNS cannot rebind to a private address. */
function pinLookup(ip: string): NonNullable<https.RequestOptions["lookup"]> {
  const family = net.isIP(ip) === 6 ? 6 : 4;
  return ((_hostname, options, callback) => {
    const cb = (typeof options === "function" ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    const all = typeof options === "object" && options !== null && "all" in options && Boolean(options.all);
    if (all) cb(null, [{ address: ip, family }]);
    else cb(null, ip, family);
  }) as NonNullable<https.RequestOptions["lookup"]>;
}

function requestOpts(url: URL, ip: string, extra: https.RequestOptions): https.RequestOptions {
  return {
    hostname: url.hostname,
    servername: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    path: `${url.pathname}${url.search}`,
    lookup: pinLookup(ip),
    family: net.isIP(ip) === 6 ? 6 : 4,
    ...extra,
  };
}

function tlsFromSocket(socket: tls.TLSSocket): TlsInfo {
  const cert = socket.getPeerCertificate?.(true) as
    | {
        subject?: { CN?: string; O?: string };
        issuer?: { CN?: string; O?: string };
        valid_from?: string;
        valid_to?: string;
        subjectaltname?: string;
      }
    | undefined;
  const validTo = cert?.valid_to ?? null;
  let daysLeft: number | null = null;
  if (validTo) {
    const t = Date.parse(validTo);
    if (Number.isFinite(t)) daysLeft = Math.floor((t - Date.now()) / 86_400_000);
  }
  const san = cert?.subjectaltname?.split(",")[0]?.replace(/^DNS:/, "").trim() ?? null;
  return {
    protocol: socket.getProtocol?.() ?? null,
    alpn: socket.alpnProtocol || null,
    authorized: socket.authorized ?? null,
    subject: cert?.subject?.CN ?? san,
    issuer: cert?.issuer?.CN ?? cert?.issuer?.O ?? null,
    validFrom: cert?.valid_from ?? null,
    validTo,
    daysLeft,
  };
}

function emptyFail(
  url: URL,
  error: string,
  t0: number,
  dnsMs: number | null,
  tcpMs: number | null,
  tlsMs: number | null,
  ip: string | null,
): TimedFetch {
  return {
    timed: {
      url: url.href,
      finalUrl: url.href,
      status: null,
      ok: false,
      error,
      sizeBytes: 0,
      contentType: null,
      server: null,
      cacheControl: null,
      contentEncoding: null,
      age: null,
      cdnCache: null,
      httpVersion: null,
      alpn: null,
      ip,
      tlsProtocol: null,
      tls: null,
      redirects: [],
      dnsMs,
      tcpMs,
      tlsMs,
      ttfbMs: null,
      transferMs: null,
      totalMs: performance.now() - t0,
    },
    body: Buffer.alloc(0),
    encoding: null,
  };
}

export async function timeUrl(raw: string): Promise<TimedRequest> {
  return (await timeUrlWithBody(raw)).timed;
}

export async function timeUrlWithBody(raw: string): Promise<TimedFetch> {
  const url = normalizeTargetUrl(raw);
  return timeHop(url, []);
}

async function timeHop(url: URL, redirects: string[]): Promise<TimedFetch> {
  const t0 = performance.now();
  let ips: string[];
  try {
    ips = await resolvePublic(url.hostname);
  } catch (err) {
    return emptyFail(url, err instanceof Error ? err.message : "DNS fehlgeschlagen.", t0, null, null, null, null);
  }
  const dnsMs = performance.now() - t0;
  const ip = ips[0] ?? null;
  if (!ip) return emptyFail(url, "Keine öffentliche IP.", t0, dnsMs, null, null, null);
  return timeUrlInternal(url, ip, t0, dnsMs, redirects);
}

function timeUrlInternal(
  url: URL,
  ip: string,
  t0: number,
  dnsMs: number,
  redirects: string[],
): Promise<TimedFetch> {
  return new Promise((resolve) => {
    let tcpAbs: number | null = null;
    let tlsAbs: number | null = null;
    let ttfbAbs: number | null = null;
    let size = 0;
    let tlsProtocol: string | null = null;
    let alpn: string | null = null;
    let tlsInfo: TlsInfo | null = null;

    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      requestOpts(url, ip, {
        method: "GET",
        timeout: DOC_TIMEOUT,
        headers: {
          Host: url.host,
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,*/*",
          "Accept-Encoding": "gzip, deflate, br",
        },
      }),
      (res) => {
        const loc = header(res.headers, "location");
        if (loc && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          try {
            const next = new URL(loc, url);
            if (redirects.length >= 5) {
              resolve(emptyFail(url, "Zu viele Redirects.", t0, dnsMs, null, null, ip));
              return;
            }
            void timeHop(next, [...redirects, next.href]).then((inner) => {
              resolve({
                timed: { ...inner.timed, url: url.href },
                body: inner.body,
                encoding: inner.encoding,
              });
            });
          } catch {
            resolve(emptyFail(url, "Ungültiger Redirect.", t0, dnsMs, null, null, ip));
          }
          return;
        }

        ttfbAbs = performance.now() - t0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (chunks.reduce((s, c) => s + c.length, 0) < 4_000_000) chunks.push(chunk);
        });
        res.on("end", () => {
          const totalMs = performance.now() - t0;
          const status = res.statusCode ?? null;
          const encoding = header(res.headers, "content-encoding");
          const httpVersion = res.httpVersion ? `HTTP/${res.httpVersion}` : alpn === "h2" ? "HTTP/2" : null;
          const tcpMs = tcpAbs === null ? null : Math.max(0, tcpAbs - dnsMs);
          const tlsMs =
            url.protocol === "https:" && tlsAbs !== null && tcpAbs !== null
              ? Math.max(0, tlsAbs - tcpAbs)
              : url.protocol === "https:"
                ? tlsAbs
                : null;
          resolve({
            timed: {
              url: url.href,
              finalUrl: url.href,
              status,
              ok: status !== null && status >= 200 && status < 400,
              error: null,
              sizeBytes: size,
              contentType: header(res.headers, "content-type"),
              server: header(res.headers, "server"),
              cacheControl: header(res.headers, "cache-control"),
              contentEncoding: encoding,
              age: header(res.headers, "age"),
              cdnCache: cdnFrom(res.headers),
              httpVersion,
              alpn,
              ip,
              tlsProtocol,
              tls: tlsInfo,
              redirects,
              dnsMs,
              tcpMs,
              tlsMs,
              ttfbMs: ttfbAbs === null ? null : Math.max(0, ttfbAbs - (tlsAbs ?? tcpAbs ?? dnsMs)),
              transferMs: ttfbAbs === null ? null : Math.max(0, totalMs - ttfbAbs),
              totalMs,
            },
            body: Buffer.concat(chunks),
            encoding,
          });
        });
      },
    );

    req.on("socket", (socket) => {
      socket.once("connect", () => {
        tcpAbs = performance.now() - t0;
      });
      socket.once("secureConnect", () => {
        tlsAbs = performance.now() - t0;
        const tlsSock = socket as tls.TLSSocket;
        tlsProtocol = tlsSock.getProtocol?.() ?? null;
        alpn = tlsSock.alpnProtocol || null;
        tlsInfo = tlsFromSocket(tlsSock);
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Zeitüberschreitung"));
    });
    req.on("error", (err) => {
      const tcpMs = tcpAbs === null ? null : Math.max(0, tcpAbs - dnsMs);
      const tlsMs = tlsAbs === null || tcpAbs === null ? tlsAbs : Math.max(0, tlsAbs - tcpAbs);
      resolve(emptyFail(url, err.message || "Verbindung fehlgeschlagen.", t0, dnsMs, tcpMs, tlsMs, ip));
    });
    req.end();
  });
}

export function httpGet(
  url: URL,
  timeout: number,
  hop = 0,
  chain: string[] = [],
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  ttfbMs: number;
  transferMs: number;
  totalMs: number;
  redirects: string[];
}> {
  return resolvePublic(url.hostname).then((ips) => {
    const ip = ips[0];
    if (!ip) return Promise.reject(new Error("Keine öffentliche IP."));
    return httpGetPinned(url, ip, timeout, hop, chain);
  });
}

function httpGetPinned(
  url: URL,
  ip: string,
  timeout: number,
  hop: number,
  chain: string[],
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  ttfbMs: number;
  transferMs: number;
  totalMs: number;
  redirects: string[];
}> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      requestOpts(url, ip, {
        method: "GET",
        timeout,
        headers: {
          Host: url.host,
          "User-Agent": UA,
          Accept: "*/*",
          "Accept-Encoding": "gzip, deflate, br",
        },
      }),
      (res) => {
        const loc = header(res.headers, "location");
        if (loc && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          if (hop >= 5) {
            reject(new Error("Zu viele Redirects."));
            return;
          }
          try {
            const next = new URL(loc, url);
            const nextChain = [...chain, next.href];
            void httpGet(next, timeout, hop + 1, nextChain).then(resolve, reject);
          } catch (err) {
            reject(err);
          }
          return;
        }
        const ttfbMs = performance.now() - t0;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          if (size < 4_000_000) chunks.push(c);
          size += c.length;
        });
        res.on("end", () => {
          const totalMs = performance.now() - t0;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            ttfbMs,
            transferMs: Math.max(0, totalMs - ttfbMs),
            totalMs,
            redirects: chain,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung")));
    req.on("error", reject);
    req.end();
  });
}

export async function fetchHtml(raw: string, timeout = 8_000): Promise<string> {
  const url = normalizeTargetUrl(raw);
  const got = await httpGet(url, timeout);
  return decodeBody(got.body, header(got.headers, "content-encoding")).toString("utf8");
}

import assert from "node:assert/strict";
import test from "node:test";
import { compareAnalyses } from "./compare.ts";
import { analysisFromHar, analysisToHar, parseHarText } from "./har.ts";
import { readImageMeta } from "./images.ts";
import { isTrackerHost, isThirdParty, registrable } from "./trackers.ts";
import { diagnoseDns, diagnoseDnsLoad, percentile } from "./dns.ts";
import { diagnoseImage, enrichAnalysis } from "./summarize.ts";
import type { PageAnalysis, PageResource } from "./types.ts";

test("PNG header yields 1x1", () => {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
  ]);
  const meta = readImageMeta(png);
  assert.equal(meta?.format, "png");
  assert.equal(meta?.width, 1);
  assert.equal(meta?.height, 1);
});

test("tracker and eTLD heuristics", () => {
  assert.equal(isTrackerHost("www.google-analytics.com"), true);
  assert.equal(isTrackerHost("wikipedia.org"), false);
  assert.equal(registrable("upload.wikimedia.org"), "wikimedia.org");
  assert.equal(isThirdParty("www.google-analytics.com", "example.com"), true);
  assert.equal(isThirdParty("cdn.example.com", "www.example.com"), false);
});

function res(over: Partial<PageResource> & { url: string }): PageResource {
  return {
    type: "script",
    status: 200,
    ok: true,
    error: null,
    sizeBytes: 1000,
    durationMs: 100,
    startMs: 0,
    contentType: "text/javascript",
    host: "example.com",
    thirdParty: false,
    cacheControl: null,
    contentEncoding: null,
    cdnCache: null,
    imageWidth: null,
    imageHeight: null,
    imageFormat: null,
    hasSrcset: false,
    blocked: false,
    displayWidth: null,
    displayHeight: null,
    loading: null,
    fetchPriority: null,
    preloaded: false,
    ttfbMs: null,
    transferMs: null,
    redirects: [],
    imageSource: "other",
    newHost: false,
    ...over,
  };
}

function analysis(resources: PageResource[]): PageAnalysis {
  const doc = resources[0]!;
  return enrichAnalysis(
    {
      url: doc.url,
      finalUrl: doc.url,
      status: 200,
      ok: true,
      error: null,
      sizeBytes: doc.sizeBytes,
      contentType: "text/html",
      server: null,
      cacheControl: null,
      contentEncoding: null,
      age: null,
      cdnCache: null,
      httpVersion: "HTTP/1.1",
      alpn: null,
      ip: null,
      tlsProtocol: null,
      tls: null,
      redirects: [],
      dnsMs: 10,
      tcpMs: 20,
      tlsMs: 30,
      ttfbMs: 80,
      transferMs: 40,
      totalMs: 200,
    },
    resources,
    {
      tls: null,
      blockedTrackers: [],
      pageHost: "example.com",
      blockTrackers: false,
      analyzedAt: "2026-01-01T00:00:00.000Z",
    },
  );
}

test("compare detects added slower larger", () => {
  const before = analysis([
    res({ url: "https://example.com/", type: "document", durationMs: 200, sizeBytes: 1000 }),
    res({ url: "https://example.com/app.js", durationMs: 100, sizeBytes: 10_000 }),
  ]);
  const after = analysis([
    res({ url: "https://example.com/", type: "document", durationMs: 280, sizeBytes: 1000 }),
    res({ url: "https://example.com/app.js", durationMs: 400, sizeBytes: 40_000 }),
    res({ url: "https://cdn.example.com/extra.js", durationMs: 50, sizeBytes: 2000 }),
  ]);
  const delta = compareAnalyses(before, after);
  assert.equal(delta.added.length, 1);
  assert.ok(delta.slower.some((s) => s.url.endsWith("/app.js")));
  assert.ok(delta.larger.some((s) => s.deltaBytes === 30_000));
});

test("HAR roundtrip keeps urls and bottlenecks", () => {
  const src = analysis([
    res({ url: "https://example.com/", type: "document", durationMs: 210, sizeBytes: 4000 }),
    res({
      url: "https://example.com/hero.png",
      type: "image",
      durationMs: 1800,
      sizeBytes: 400_000,
      host: "example.com",
      imageFormat: "png",
    }),
    res({
      url: "https://www.google-analytics.com/analytics.js",
      type: "script",
      durationMs: 90,
      sizeBytes: 20_000,
      host: "www.google-analytics.com",
      thirdParty: true,
    }),
  ]);
  const har = analysisToHar(src);
  const back = analysisFromHar(har);
  assert.equal(back.resources.length, 3);
  assert.ok(back.resources.some((r) => r.url.endsWith("hero.png")));
  assert.equal(back.lcp?.url.endsWith("hero.png"), true);
  assert.ok(back.bottlenecks.length > 0);
  assert.ok(back.images.some((i) => i.sizeBytes === 400_000));
  const parsed = parseHarText(JSON.stringify(har));
  assert.equal(parsed.totals.count, 3);
});

test("HAR marks status 0 as failed", () => {
  const back = analysisFromHar({
    log: {
      entries: [
        {
          startedDateTime: "2026-01-01T00:00:00.000Z",
          time: 12,
          request: { url: "https://example.com/" },
          response: { status: 200, content: { size: 100, mimeType: "text/html" } },
          _resourceType: "document",
        },
        {
          startedDateTime: "2026-01-01T00:00:00.100Z",
          time: 5,
          request: { url: "https://ads.example.net/pixel.gif" },
          response: { status: 0, content: { size: 0, mimeType: "image/gif" } },
          _resourceType: "image",
        },
      ],
    },
  });
  const pixel = back.resources.find((r) => r.url.includes("pixel"));
  assert.equal(pixel?.ok, false);
  assert.equal(pixel?.blocked, true);
});

test("Chrome HAR skips extensions and uses bodySize fallback", () => {
  const back = analysisFromHar({
    log: {
      pages: [{ title: "https://news.example/", startedDateTime: "2026-01-01T00:00:00.000Z" }],
      entries: [
        {
          startedDateTime: "2026-01-01T00:00:00.000Z",
          time: 40,
          request: { url: "chrome-extension://abc/script.js" },
          response: { status: 200, content: { size: 10, mimeType: "text/javascript" } },
        },
        {
          startedDateTime: "2026-01-01T00:00:00.010Z",
          time: 120,
          request: { url: "https://news.example/" },
          response: {
            status: 200,
            httpVersion: "HTTP/2.0",
            headers: [{ name: "content-type", value: "text/html" }],
            content: { size: -1 },
            bodySize: 8123,
          },
          _resourceType: "document",
        },
        {
          startedDateTime: "2026-01-01T00:00:00.040Z",
          time: 900,
          request: { url: "https://cdn.news.example/hero.jpg" },
          response: {
            status: 200,
            content: { size: 520_000, mimeType: "image/jpeg" },
            headers: [{ name: "cache-control", value: "max-age=0" }],
          },
          _resourceType: "img",
        },
      ],
    },
  });
  assert.equal(back.resources.length, 2);
  assert.equal(
    back.resources.find((r) => r.type === "document")?.sizeBytes,
    8123,
  );
  assert.equal(back.lcp?.url.includes("hero.jpg"), true);
  assert.ok(back.images.some((i) => i.reasons.some((r) => r.title === "Kaum Cache")));
});

test("image why: oversized vs HTML, TTFB, lazy LCP", () => {
  const oversized = diagnoseImage(
    res({
      url: "https://example.com/hero.png",
      type: "image",
      imageFormat: "png",
      imageWidth: 4000,
      imageHeight: 3000,
      displayWidth: 400,
      displayHeight: 300,
      sizeBytes: 1_200_000,
      durationMs: 1800,
      ttfbMs: 80,
      transferMs: 1600,
      imageSource: "img",
    }),
    "https://example.com/hero.png",
  );
  assert.equal(oversized.severity, "bad");
  assert.ok(oversized.reasons.some((r) => r.title === "Überdimensioniert"));
  assert.ok(oversized.reasons.some((r) => r.title === "Download dauert" || r.title === "Datei zu groß"));

  const wait = diagnoseImage(
    res({
      url: "https://cdn.example.com/a.webp",
      type: "image",
      host: "cdn.example.com",
      thirdParty: true,
      imageFormat: "webp",
      imageWidth: 800,
      imageHeight: 600,
      sizeBytes: 40_000,
      durationMs: 900,
      ttfbMs: 820,
      transferMs: 40,
      newHost: true,
      imageSource: "img",
    }),
    null,
  );
  assert.ok(wait.reasons.some((r) => r.title === "Wartezeit vorm Download"));
  assert.ok(wait.reasons.some((r) => r.title === "Neue Verbindung"));

  const lazyLcp = diagnoseImage(
    res({
      url: "https://example.com/hero.webp",
      type: "image",
      imageFormat: "webp",
      imageWidth: 1200,
      imageHeight: 800,
      sizeBytes: 90_000,
      durationMs: 200,
      loading: "lazy",
      imageSource: "img",
    }),
    "https://example.com/hero.webp",
  );
  assert.ok(lazyLcp.reasons.some((r) => r.title === "LCP ist lazy"));
});

test("dns diagnose flags SPF +all, missing AAAA, NS mismatch", () => {
  const notes = diagnoseDns({
    a: [{ type: "A", value: "1.2.3.4", ttl: 10 }],
    aaaa: [],
    mx: [],
    ns: [{ type: "NS", value: "ns1.example.com", ttl: null }],
    spf: "v=spf1 +all",
    dmarc: null,
    caa: [],
    cname: [
      { type: "CNAME", value: "a.cdn.net", ttl: null },
      { type: "CNAME", value: "b.cdn.net", ttl: null },
      { type: "CNAME", value: "c.cdn.net", ttl: null },
    ],
    nameservers: [
      { ns: "ns1.example.com", ip: "1.1.1.1", ms: 20, addresses: ["1.2.3.4"], error: null },
      { ns: "ns2.example.com", ip: "8.8.8.8", ms: 40, addresses: ["9.9.9.9"], error: null },
    ],
    answersMatch: true,
    spreadMs: null,
    dnssecAd: false,
    ds: [],
  });
  const titles = notes.map((n) => n.title);
  assert.ok(titles.includes("Kein AAAA"));
  assert.ok(titles.includes("SPF +all"));
  assert.ok(titles.includes("Kein DMARC"));
  assert.ok(titles.includes("NS liefern unterschiedliche A"));
  assert.ok(titles.includes("Lange CNAME-Kette"));
  assert.ok(titles.includes("Sehr kurze TTL"));
});

test("dns load percentile and burst findings", () => {
  assert.equal(percentile([1, 2, 3, 4, 100], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 100], 95), 100);
  const notes = diagnoseDnsLoad(
    [
      {
        name: "Cloudflare",
        server: "1.1.1.1",
        count: 8,
        ok: 8,
        minMs: 4,
        p50Ms: 5,
        p95Ms: 90,
        maxMs: 110,
        wallMs: 120,
      },
    ],
    [
      { host: "cdn.slow.example", ms: 220, addresses: ["1.1.1.1"], error: null },
      { host: "example.com", ms: 8, addresses: ["1.2.3.4"], error: null },
    ],
    220,
  );
  const titles = notes.map((n) => n.title);
  assert.ok(titles.some((t) => t.includes("parallelen Lookups")));
  assert.ok(titles.some((t) => t.includes("cdn.slow.example")));
});




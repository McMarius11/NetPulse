#!/usr/bin/env node
/**
 * Usage:
 *   npm run cli -- analyze https://example.com
 *   npm run cli -- analyze https://example.com --har --out capture.har
 *   npm run cli -- dns wikipedia.org
 *   npm run cli -- timing https://example.com
 *   npm run cli -- crawl https://example.com
 *   npm run cli -- har ./capture.har
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyzePage, benchmarkDns, crawlSite, inspectDns, loadTestDns, tcpCheck, timeUrl } from "../src/lib/net/engine.ts";
import { analysisToHar, parseHarText } from "../src/lib/net/har.ts";

const argv = process.argv.slice(2);
const cmd = argv[0];
const target = argv[1];
const flags = argv.slice(2);
const wantJson = flags.includes("--json");
const wantHar = flags.includes("--har");
const blockTrackers = flags.includes("--block-trackers");
const outIdx = flags.indexOf("--out");
const outPath = outIdx >= 0 ? flags[outIdx + 1] : undefined;

function out(data: unknown) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (outPath) writeFileSync(outPath, text);
  else process.stdout.write(text);
}

async function main() {
  if (!cmd || cmd === "help" || cmd === "-h") {
    process.stdout.write(`NetPulse CLI
  analyze <url> [--json] [--har] [--block-trackers] [--out datei.har]
  dns <domain> [--json]
  timing <url> [--json]
  crawl <url> [--json]
  tcp <host> [port] [--json]
  har <datei.har> [--json]
`);
    return;
  }
  if (!target) throw new Error("Bitte URL, Domain oder HAR-Datei angeben.");

  if (cmd === "analyze") {
    const data = await analyzePage(target, { blockTrackers });
    if (wantHar) {
      out(analysisToHar(data));
      return;
    }
    if (wantJson) {
      out(data);
      return;
    }
    process.stdout.write(
      `${data.document.finalUrl}\n` +
        `status ${data.document.status}  ${Math.round(data.document.totalMs)} ms  TTFB ${Math.round(data.document.ttfbMs ?? 0)} ms\n` +
        `${data.totals.count} resources  ${data.totals.bytes} B  ${data.totals.failed} failed  ${data.totals.thirdParty} third-party\n` +
        (data.lcp ? `LCP ${data.lcp.url}  ${Math.round(data.lcp.durationMs)} ms\n` : "") +
        data.bottlenecks.map((b) => `- [${b.severity}] ${b.title}: ${b.detail}`).join("\n") +
        "\n",
    );
    return;
  }
  if (cmd === "har") {
    const data = parseHarText(readFileSync(target, "utf8"));
    if (wantJson) {
      out(data);
      return;
    }
    process.stdout.write(
      `${data.document.finalUrl || data.pageHost}\n` +
        `${data.totals.count} entries  ${data.totals.bytes} B  ${data.totals.failed} failed\n` +
        data.bottlenecks.map((b) => `- [${b.severity}] ${b.title}`).join("\n") +
        "\n",
    );
    return;
  }
  if (cmd === "dns") {
    const [bench, records, load] = await Promise.all([benchmarkDns(target), inspectDns(target), loadTestDns(target)]);
    if (wantJson) {
      out({ bench, records, load });
      return;
    }
    process.stdout.write(`fastest: ${bench.fastest}  match=${bench.answersMatch}  Δ${Math.round(bench.spreadMs ?? 0)}ms\n`);
    process.stdout.write(`SPF: ${records.spf ?? "—"}  DMARC: ${records.dmarc ?? "—"}\n`);
    process.stdout.write(`burst wall: ${load.bursts.map((b) => `${b.name} p95=${b.p95Ms === null ? "—" : Math.round(b.p95Ms)}`).join("  ")}\n`);
    process.stdout.write(`hosts: ${load.hosts.length}  wall ${Math.round(load.hostsWallMs)} ms\n`);
    for (const f of [...load.findings, ...records.findings].slice(0, 10)) {
      process.stdout.write(`- [${f.severity}] ${f.title}: ${f.detail}\n`);
    }
    for (const p of bench.probes) {
      process.stdout.write(`  ${p.name.padEnd(16)} ${p.ms === null ? p.error : `${Math.round(p.ms)} ms`}\n`);
    }
    return;
  }
  if (cmd === "timing") {
    const t = await timeUrl(target);
    if (wantJson) {
      out(t);
      return;
    }
    process.stdout.write(
      `${t.finalUrl}  ${t.status}  total ${Math.round(t.totalMs)}  dns ${Math.round(t.dnsMs ?? 0)}  ttfb ${Math.round(t.ttfbMs ?? 0)}\n`,
    );
    return;
  }
  if (cmd === "crawl") {
    const c = await crawlSite(target);
    if (wantJson) {
      out(c);
      return;
    }
    for (const p of c.pages) {
      process.stdout.write(`${Math.round(p.totalMs).toString().padStart(5)} ms  ${p.status}  ${p.url}\n`);
    }
    return;
  }
  if (cmd === "tcp") {
    const portRaw = argv.slice(2).find((a) => !a.startsWith("--"));
    const port = Number(portRaw ?? 443);
    const r = await tcpCheck(target, port);
    if (wantJson) {
      out(r);
      return;
    }
    process.stdout.write(`${r.ok ? "offen" : "zu"}  ${r.host}:${r.port}  ${r.ip ?? "—"}  ${r.ms === null ? r.error : `${Math.round(r.ms)} ms`}\n`);
    return;
  }
  throw new Error(`Unbekanntes Kommando: ${cmd}`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});

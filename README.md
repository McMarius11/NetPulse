# NetPulse

[![CI](https://github.com/McMarius11/NetPulse/actions/workflows/ci.yml/badge.svg)](https://github.com/McMarius11/NetPulse/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/McMarius11/NetPulse)](https://github.com/McMarius11/NetPulse/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Netzwerk-All-in-One: **Seitenanalyse**, **Bild-Forensik**, **HAR**, **DNS-Last**, **Crawl**, **TLS**, **Monitor**. GUI + CLI, Windows / Linux / macOS.

Eine einzelne DNS-Query oder ein TTFB sagt wenig. NetPulse zeigt, **warum** Bilder hängen und ob der Resolver unter 8 parallelen Lookups noch mitkommt — so wie ein echter Seitenaufruf.

## Features

| Tab | Was du siehst |
| --- | --- |
| **Seitenanalyse** | Waterfall, Hosts, LCP, Cache/TLS, Tracker-Block, Lauf-Vergleich |
| **Bilder** | Dateigröße, Pixel vs. HTML, TTFB vs. Transfer, Format/bpp, Lazy/Preload, Redirects, neuer Host |
| **HAR** | Chrome/Firefox/NetPulse importieren, vergleichen, wieder exportieren |
| **DNS** | Resolver-Benchmark, **Burst (8 parallele Queries)**, Hosts aus dem HTML, autoritative NS, CNAME, SOA, SPF/DMARC/CAA, DNSSEC, PTR, DoH |
| **Crawl** | Startseite + interne Links, langsamste Unterseite |
| **URL-Timing** | DNS → TCP → TLS → TTFB → Transfer + Zertifikat |
| **Monitor** | Wiederholte Checks |
| **TCP** | Port erreichbar? |

Export: **HAR** (DevTools-kompatibel) und **JSON**.

Nur öffentliche HTTP(S)-Ziele (SSRF-Schutz). Die Messung läuft auf dem Rechner, auf dem NetPulse startet.

## Voraussetzungen

- [Node.js](https://nodejs.org/) 22+
- Windows, Linux oder macOS

## Starten

```bash
git clone https://github.com/McMarius11/NetPulse.git
cd NetPulse
npm install
npm run dev
```

Browser: [http://localhost:8080](http://localhost:8080)

Windows: `start.bat` · Linux/macOS: `./start-local.sh`

Fertige Pakete: [Releases](https://github.com/McMarius11/NetPulse/releases) (ZIP auspacken, `npm install`, `npm run dev`).

## CLI

```bash
npm run cli -- analyze https://example.com
npm run cli -- analyze https://example.com --har --out capture.har
npm run cli -- har capture.har
npm run cli -- dns wikipedia.org
npm run cli -- timing https://example.com
npm run cli -- crawl https://example.com
npm run cli -- tcp 1.1.1.1 443
```

JSON: `--json` anhängen.

## DNS-Last

`DNS prüfen` macht nicht nur eine A-Query:

1. **Burst** — 8 parallele Lookups je Resolver (System, Cloudflare, Google, Quad9, OpenDNS, AdGuard) → p50 / p95 / Wandzeit
2. **Hosts der Seite** — HTML parsen, alle Namen parallel auflösen
3. Records, NS-Gesundheit, Mail (SPF/DMARC), CAA, DNSSEC

Wenn p95 stark über p50 liegt, wird der Resolver beim echten Seitenaufruf zum Nadelöhr.

## HAR aus Chrome

JS-lazy Bilder fehlen in der Live-Analyse. In Chrome: DevTools → Network → HAR speichern → Tab **HAR**.

## Tests

```bash
npm test
```

## Stack

TanStack Start, React 19, Vite, Tailwind, Node `dns`/`http`/`tls`.

## Lizenz

MIT — siehe [LICENSE](LICENSE).

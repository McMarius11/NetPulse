import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

mkdirSync("screenshots", { recursive: true });
const shot = (name) => `screenshots/${name}`;

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
await page.getByLabel("URL").fill("https://www.wikipedia.org");
await page.getByRole("button", { name: "Seite prüfen" }).click();
await page.getByRole("heading", { name: "Engpässe" }).waitFor({ timeout: 60000 });
await page.getByRole("heading", { name: "Hosts" }).waitFor({ timeout: 5000 });
await page.getByRole("heading", { name: "Warum Bilder hängen" }).waitFor();
await page.getByRole("heading", { name: "Cache, Header, TLS" }).waitFor();
await page.screenshot({ path: shot("analyze.png"), fullPage: true });
const body = await page.locator("body").innerText();
console.log("ANALYZE\n", body.slice(0, 2800));

await page.getByRole("button", { name: "HAR", exact: true }).click();
await page.getByText("HAR-Datei hier ablegen").waitFor();
await page.screenshot({ path: shot("har.png") });
console.log("HAR_TAB_OK");

await page.getByRole("button", { name: "Crawl" }).click();
await page.getByRole("button", { name: "Mini-Crawl" }).click();
await page.getByText("Langsamste:").waitFor({ timeout: 60000 });
await page.screenshot({ path: shot("crawl.png"), fullPage: true });
console.log("CRAWL_OK");

await page.getByRole("button", { name: "DNS" }).click();
await page.getByLabel("Domain").fill("example.com");
await page.getByRole("button", { name: "DNS prüfen" }).click();
await page.getByText("Einzelquery für").waitFor({ timeout: 30000 });
await page.getByText("Records · Mail · DNSSEC").waitFor({ timeout: 10000 });
await page.screenshot({ path: shot("dns.png"), fullPage: true });
console.log("DNS_OK");

await page.getByRole("button", { name: "TCP" }).click();
await page.getByLabel("Host").fill("1.1.1.1");
await page.getByLabel("Port").fill("443");
await page.getByRole("button", { name: "Prüfen" }).click();
await page.getByText("offen").waitFor({ timeout: 20000 });
console.log("TCP_OK");

await page.getByRole("button", { name: "URL-Timing" }).click();
await page.getByLabel("URL").fill("https://example.com");
await page.getByRole("button", { name: "Messen" }).click();
await page.getByText("Gesamt").waitFor({ timeout: 20000 });
await page.getByText("Zertifikat").waitFor();
await page.screenshot({ path: shot("timing.png") });
console.log("TIMING_OK");

await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Seitenanalyse" }).click();
await page.screenshot({ path: shot("mobile.png"), fullPage: true });
console.log("MOBILE_OK errors=", errors);

await browser.close();
if (errors.length) process.exitCode = 1;

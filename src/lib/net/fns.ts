import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const urlField = z.string().trim().min(1, "Bitte eine URL eingeben.");
const domainField = z.string().trim().min(1, "Bitte eine Domain eingeben.");

export const analyzePageFn = createServerFn({ method: "POST" })
  .validator(z.object({ url: urlField, blockTrackers: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const { analyzePage } = await import("./engine");
    return analyzePage(data.url, { blockTrackers: data.blockTrackers });
  });

export const timeUrlFn = createServerFn({ method: "POST" })
  .validator(z.object({ url: urlField }))
  .handler(async ({ data }) => {
    const { timeUrl } = await import("./engine");
    return timeUrl(data.url);
  });

export const dnsBenchFn = createServerFn({ method: "POST" })
  .validator(z.object({ domain: domainField }))
  .handler(async ({ data }) => {
    const { benchmarkDns } = await import("./engine");
    return benchmarkDns(data.domain);
  });

export const dnsInspectFn = createServerFn({ method: "POST" })
  .validator(z.object({ domain: domainField }))
  .handler(async ({ data }) => {
    const { inspectDns } = await import("./engine");
    return inspectDns(data.domain);
  });

export const dnsLoadFn = createServerFn({ method: "POST" })
  .validator(z.object({ domain: domainField }))
  .handler(async ({ data }) => {
    const { loadTestDns } = await import("./engine");
    return loadTestDns(data.domain);
  });

export const tcpCheckFn = createServerFn({ method: "POST" })
  .validator(z.object({ host: z.string().trim().min(1, "Bitte Host eingeben."), port: z.number().int().min(1).max(65535) }))
  .handler(async ({ data }) => {
    const { tcpCheck } = await import("./engine");
    return tcpCheck(data.host, data.port);
  });

export const crawlSiteFn = createServerFn({ method: "POST" })
  .validator(z.object({ url: urlField }))
  .handler(async ({ data }) => {
    const { crawlSite } = await import("./engine");
    return crawlSite(data.url);
  });

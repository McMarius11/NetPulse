import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const analyzePageFn = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string(), blockTrackers: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const { analyzePage } = await import("./engine");
    return analyzePage(data.url, { blockTrackers: data.blockTrackers });
  });

export const timeUrlFn = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string() }))
  .handler(async ({ data }) => {
    const { timeUrl } = await import("./engine");
    return timeUrl(data.url);
  });

export const dnsBenchFn = createServerFn({ method: "POST" })
  .validator(z.object({ domain: z.string() }))
  .handler(async ({ data }) => {
    const { benchmarkDns } = await import("./engine");
    return benchmarkDns(data.domain);
  });

export const dnsLoadFn = createServerFn({ method: "POST" })
  .validator(z.object({ domain: z.string() }))
  .handler(async ({ data }) => {
    const { loadTestDns } = await import("./engine");
    return loadTestDns(data.domain);
  });

export const tcpCheckFn = createServerFn({ method: "POST" })
  .validator(z.object({ host: z.string(), port: z.number() }))
  .handler(async ({ data }) => {
    const { tcpCheck } = await import("./engine");
    return tcpCheck(data.host, data.port);
  });

export const crawlSiteFn = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string() }))
  .handler(async ({ data }) => {
    const { crawlSite } = await import("./engine");
    return crawlSite(data.url);
  });

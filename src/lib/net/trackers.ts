const TRACKER_SUFFIXES = [
  "google-analytics.com",
  "googletagmanager.com",
  "googleadservices.com",
  "googlesyndication.com",
  "doubleclick.net",
  "2mdn.net",
  "facebook.net",
  "connect.facebook.net",
  "facebook.com",
  "ads-twitter.com",
  "analytics.tiktok.com",
  "ads.linkedin.com",
  "snap.licdn.com",
  "hotjar.com",
  "hotjar.io",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "newrelic.com",
  "nr-data.net",
  "fullstory.com",
  "clarity.ms",
  "mouseflow.com",
  "crazyegg.com",
  "taboola.com",
  "outbrain.com",
  "criteo.com",
  "criteo.net",
  "adnxs.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "quantserve.com",
  "scorecardresearch.com",
  "chartbeat.com",
  "mc.yandex.ru",
  "yandex.ru",
  "statcounter.com",
  "matomo.cloud",
  "sentry.io",
  "sentry-cdn.com",
  "adsystem.com",
  "amazon-adsystem.com",
  "bing.com",
  "bat.bing.com",
  "adservice.google.com",
  "pagead2.googlesyndication.com",
  "pixel.wp.com",
  "stats.wp.com",
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function registrable(host: string): string {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const last = parts.at(-1) ?? "";
  const second = parts.at(-2) ?? "";
  if (["co", "com", "net", "org", "ac", "gov"].includes(second) && last.length === 2) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

export function isThirdParty(resourceHost: string, pageHost: string): boolean {
  if (!resourceHost || !pageHost) return false;
  return registrable(resourceHost) !== registrable(pageHost);
}

export function isTrackerHost(host: string): boolean {
  const h = host.toLowerCase();
  return TRACKER_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

export function isTrackerUrl(url: string): boolean {
  return isTrackerHost(hostOf(url));
}

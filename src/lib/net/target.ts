const KEY = "netpulse.last-target";
const DEFAULT_URL = "https://www.wikipedia.org";

export function readLastTarget(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

export function writeLastTarget(value: string) {
  const v = value.trim();
  if (!v) return;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
}

export function hostFromTarget(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProto).hostname || trimmed;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0] ?? trimmed;
  }
}

export function asUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_URL;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

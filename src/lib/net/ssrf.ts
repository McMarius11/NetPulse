import net from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "metadata.google.internal",
]);

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) {
    return true;
  }
  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  if (ip === "::1" || ip === "::") return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  if (net.isIPv6(ip)) {
    if (lower.startsWith("::ffff:")) {
      return isPrivateOrReservedIp(ip.slice(ip.lastIndexOf(":") + 1));
    }
    return false;
  }
  if (!net.isIPv4(ip)) return true;
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

export function normalizeTargetUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Bitte eine URL oder Domain eingeben.");
  const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    throw new Error("Ungültige URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Nur http:// und https:// sind erlaubt.");
  }
  if (url.username || url.password) {
    throw new Error("URLs mit Zugangsdaten sind nicht erlaubt.");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("Lokale und interne Hosts sind gesperrt.");
  }
  if (net.isIP(url.hostname) && isPrivateOrReservedIp(url.hostname)) {
    throw new Error("Private oder reservierte IP-Adressen sind gesperrt.");
  }
  return url;
}

export function assertPublicIps(ips: string[]): void {
  const publicOnes = ips.filter((ip) => !isPrivateOrReservedIp(ip));
  if (publicOnes.length === 0) {
    throw new Error("Ziel löst nur auf interne/private Adressen auf.");
  }
}

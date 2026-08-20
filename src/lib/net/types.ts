export type Severity = "ok" | "warn" | "bad";

export type ResourceType =
  | "document"
  | "image"
  | "script"
  | "stylesheet"
  | "font"
  | "media"
  | "xhr"
  | "other";

export type ImageSource = "img" | "srcset" | "picture" | "css" | "lazy" | "preload" | "icon" | "og" | "other";

export type PhaseTiming = {
  dnsMs: number | null;
  tcpMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  transferMs: number | null;
  totalMs: number;
};

export type TlsInfo = {
  protocol: string | null;
  alpn: string | null;
  authorized: boolean | null;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysLeft: number | null;
};

export type TimedRequest = PhaseTiming & {
  url: string;
  finalUrl: string;
  status: number | null;
  ok: boolean;
  error: string | null;
  sizeBytes: number;
  contentType: string | null;
  server: string | null;
  cacheControl: string | null;
  contentEncoding: string | null;
  age: string | null;
  cdnCache: string | null;
  httpVersion: string | null;
  alpn: string | null;
  ip: string | null;
  tlsProtocol: string | null;
  tls: TlsInfo | null;
  redirects: string[];
};

export type PageResource = {
  url: string;
  type: ResourceType;
  status: number | null;
  ok: boolean;
  error: string | null;
  sizeBytes: number;
  durationMs: number;
  startMs: number;
  contentType: string | null;
  host: string;
  thirdParty: boolean;
  cacheControl: string | null;
  contentEncoding: string | null;
  cdnCache: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageFormat: string | null;
  hasSrcset: boolean;
  blocked: boolean;
  displayWidth: number | null;
  displayHeight: number | null;
  loading: string | null;
  fetchPriority: string | null;
  preloaded: boolean;
  ttfbMs: number | null;
  transferMs: number | null;
  redirects: string[];
  imageSource: ImageSource;
  newHost: boolean;
};

export type Bottleneck = {
  severity: Severity;
  title: string;
  detail: string;
  relatedUrl?: string;
};

export type HostBucket = {
  host: string;
  count: number;
  bytes: number;
  durationMs: number;
  thirdParty: boolean;
  failed: number;
};

export type ImageReason = {
  severity: Severity;
  title: string;
  detail: string;
};

export type ImageFinding = {
  url: string;
  format: string | null;
  width: number | null;
  height: number | null;
  displayWidth: number | null;
  displayHeight: number | null;
  sizeBytes: number;
  durationMs: number;
  ttfbMs: number | null;
  transferMs: number | null;
  host: string;
  thirdParty: boolean;
  hasSrcset: boolean;
  loading: string | null;
  fetchPriority: string | null;
  preloaded: boolean;
  redirects: number;
  bitsPerPixel: number | null;
  imageSource: ImageSource;
  newHost: boolean;
  issue: string;
  reasons: ImageReason[];
  severity: Severity;
};

export type CacheFinding = {
  url: string;
  cacheControl: string | null;
  compressed: boolean;
  cdn: string | null;
  issue: string;
  severity: Severity;
};

export type LcpCandidate = {
  url: string;
  type: ResourceType;
  sizeBytes: number;
  durationMs: number;
  startMs: number;
  reason: string;
};

export type PageAnalysis = {
  document: TimedRequest;
  resources: PageResource[];
  bottlenecks: Bottleneck[];
  totals: {
    count: number;
    failed: number;
    bytes: number;
    images: number;
    scripts: number;
    styles: number;
    slow: number;
    thirdParty: number;
    thirdPartyBytes: number;
  };
  hosts: HostBucket[];
  images: ImageFinding[];
  cache: CacheFinding[];
  lcp: LcpCandidate | null;
  tls: TlsInfo | null;
  blockedTrackers: { url: string; host: string }[];
  pageHost: string;
  blockTrackers: boolean;
  analyzedAt: string;
};

export type DnsProbe = {
  name: string;
  server: string;
  ms: number | null;
  addresses: string[];
  error: string | null;
};

export type DnsBenchmark = {
  domain: string;
  probes: DnsProbe[];
  fastest: string | null;
  slowest: string | null;
  spreadMs: number | null;
  answersMatch: boolean;
};

export type DnsRecord = {
  type: string;
  value: string;
  ttl: number | null;
};

export type NsProbe = {
  ns: string;
  ip: string | null;
  ms: number | null;
  addresses: string[];
  error: string | null;
};

export type DnsFinding = {
  severity: Severity;
  title: string;
  detail: string;
};

export type DnsInspect = {
  domain: string;
  a: DnsRecord[];
  aaaa: DnsRecord[];
  mx: DnsRecord[];
  ns: DnsRecord[];
  txt: DnsRecord[];
  caa: DnsRecord[];
  cname: DnsRecord[];
  soa: string | null;
  spf: string | null;
  dmarc: string | null;
  ds: DnsRecord[];
  dnskey: DnsRecord[];
  https: DnsRecord[];
  dnssecAd: boolean | null;
  ptr: { ip: string; names: string[] }[];
  nameservers: NsProbe[];
  doh: DnsProbe[];
  findings: DnsFinding[];
};

export type DnsBurst = {
  name: string;
  server: string;
  count: number;
  ok: number;
  minMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  wallMs: number;
};

export type DnsHostLookup = {
  host: string;
  ms: number | null;
  addresses: string[];
  error: string | null;
};

export type DnsLoadResult = {
  domain: string;
  bursts: DnsBurst[];
  hosts: DnsHostLookup[];
  hostsWallMs: number;
  findings: DnsFinding[];
};


export type TcpCheck = {
  host: string;
  port: number;
  ok: boolean;
  ms: number | null;
  error: string | null;
  ip: string | null;
};

export type CrawlPage = {
  url: string;
  status: number | null;
  totalMs: number;
  ttfbMs: number | null;
  sizeBytes: number;
  ok: boolean;
  error: string | null;
};

export type CrawlResult = {
  start: string;
  pages: CrawlPage[];
};

export type CompareDelta = {
  added: { url: string; type: ResourceType; sizeBytes: number; durationMs: number }[];
  removed: { url: string; type: ResourceType; sizeBytes: number; durationMs: number }[];
  slower: { url: string; beforeMs: number; afterMs: number; deltaMs: number }[];
  larger: { url: string; beforeBytes: number; afterBytes: number; deltaBytes: number }[];
  bytesDelta: number;
  countDelta: number;
  totalMsDelta: number;
};

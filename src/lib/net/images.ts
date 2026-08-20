export type ImageMeta = { width: number; height: number; format: string };

function u16be(buf: Uint8Array, i: number) {
  return (buf[i]! << 8) | buf[i + 1]!;
}
function u16le(buf: Uint8Array, i: number) {
  return buf[i]! | (buf[i + 1]! << 8);
}
function u32be(buf: Uint8Array, i: number) {
  return ((buf[i]! << 24) | (buf[i + 1]! << 16) | (buf[i + 2]! << 8) | buf[i + 3]!) >>> 0;
}
function u24le(buf: Uint8Array, i: number) {
  return buf[i]! | (buf[i + 1]! << 8) | (buf[i + 2]! << 16);
}
function ascii(buf: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...buf.subarray(start, end));
}

export function readImageMeta(data: Uint8Array): ImageMeta | null {
  if (data.length < 16) return null;

  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    if (data.length < 24) return null;
    return { width: u32be(data, 16), height: u32be(data, 20), format: "png" };
  }

  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return { width: u16le(data, 6), height: u16le(data, 8), format: "gif" };
  }

  if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP") {
    const kind = ascii(data, 12, 16);
    if (kind === "VP8X" && data.length >= 30) {
      return { width: u24le(data, 24) + 1, height: u24le(data, 27) + 1, format: "webp" };
    }
    if (kind === "VP8 " && data.length >= 30) {
      return { width: u16le(data, 26) & 0x3fff, height: u16le(data, 28) & 0x3fff, format: "webp" };
    }
    if (kind === "VP8L" && data.length >= 25) {
      const bits = data[21]! | (data[22]! << 8) | (data[23]! << 16) | (data[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
    }
  }

  if (data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i < data.length - 8) {
      if (data[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = data[i + 1]!;
      if (marker === 0xd8 || marker === 0xd9) {
        i += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xc2) {
        return { width: u16be(data, i + 7), height: u16be(data, i + 5), format: "jpeg" };
      }
      const len = u16be(data, i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
  }

  if (ascii(data, 4, 8) === "ftyp" && data.length > 20) {
    const brand = ascii(data, 8, 12);
    if (brand === "avif" || brand === "avis" || brand === "mif1") {
      return { width: 0, height: 0, format: "avif" };
    }
  }

  if (data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x00) {
    return { width: data[6] || 256, height: data[7] || 256, format: "ico" };
  }

  return null;
}

export function formatFromType(contentType: string | null, url: string): string | null {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (contentType?.includes("png") || path.endsWith(".png")) return "png";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg") || /\.jpe?g$/.test(path)) return "jpeg";
  if (contentType?.includes("webp") || path.endsWith(".webp")) return "webp";
  if (contentType?.includes("avif") || path.endsWith(".avif")) return "avif";
  if (contentType?.includes("gif") || path.endsWith(".gif")) return "gif";
  if (contentType?.includes("svg") || path.endsWith(".svg")) return "svg";
  if (contentType?.includes("icon") || path.endsWith(".ico")) return "ico";
  return contentType?.startsWith("image/") ? contentType.slice(6).split(";")[0] ?? null : null;
}

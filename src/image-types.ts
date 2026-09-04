// src/image-types.ts
// Server-side detection of image content types. Raster types are detected from
// magic bytes in the first 32 bytes; SVG is a text format probed separately.

export type ImageKind = "raster" | "svg";
export interface DetectedImage { kind: ImageKind; mime: string }

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_SVG_BYTES = 2 * 1024 * 1024;
export const SVG_PROBE_BYTES = 4096;

function asciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  for (let i = 0; i < expected.length; i += 1) {
    if (bytes[offset + i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

export function detectImageType(header: Uint8Array): DetectedImage | null {
  const b = (i: number): number => header[i] ?? -1;
  if (b(0) === 0x89 && asciiAt(header, 1, "PNG") && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) {
    return { kind: "raster", mime: "image/png" };
  }
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) {
    return { kind: "raster", mime: "image/jpeg" };
  }
  if (asciiAt(header, 0, "GIF87a") || asciiAt(header, 0, "GIF89a")) {
    return { kind: "raster", mime: "image/gif" };
  }
  if (asciiAt(header, 0, "RIFF") && asciiAt(header, 8, "WEBP")) {
    return { kind: "raster", mime: "image/webp" };
  }
  if (asciiAt(header, 4, "ftyp")) {
    const brand = String.fromCharCode(b(8), b(9), b(10), b(11));
    if (brand === "avif" || brand === "avis") {
      return { kind: "raster", mime: "image/avif" };
    }
  }
  return null;
}

export function looksLikeSvg(sample: string): boolean {
  const window = sample.slice(0, SVG_PROBE_BYTES);
  return /<(?:[a-zA-Z0-9_-]+:)?svg[\s>]/.test(window);
}

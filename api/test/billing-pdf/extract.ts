import { inflateSync } from 'node:zlib';

export interface PlacedText {
  text: string;
  y: number;
}

const CP1252 = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

export function extractPdfText(bytes: Uint8Array): string {
  return extractPlacedText(bytes).map((item) => item.text).join('\n');
}

export function extractPlacedText(bytes: Uint8Array): PlacedText[] {
  const placed: PlacedText[] = [];
  for (const stream of streamsOf(bytes)) {
    const source = Buffer.from(stream).toString('latin1');
    const pattern = /([+-]?(?:\d+\.?\d*|\.\d+)) ([+-]?(?:\d+\.?\d*|\.\d+)) ([+-]?(?:\d+\.?\d*|\.\d+)) ([+-]?(?:\d+\.?\d*|\.\d+)) ([+-]?(?:\d+\.?\d*|\.\d+)) ([+-]?(?:\d+\.?\d*|\.\d+)) Tm\s*<([0-9A-Fa-f]+)>\s*Tj/gu;
    for (const match of source.matchAll(pattern)) {
      const y = Number(match[6]);
      const text = decodeWinAnsi(match[7] ?? '');
      if (text !== '') placed.push({ text, y });
    }
  }
  return placed;
}

export function pdfStreams(bytes: Uint8Array): string[] {
  return streamsOf(bytes).map((stream) => Buffer.from(stream).toString('latin1'));
}

function streamsOf(pdf: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const token = ascii('stream');
  let cursor = 0;
  while (cursor < pdf.length) {
    const at = indexOf(pdf, token, cursor);
    if (at < 0) break;
    const previous = at === 0 ? 0 : pdf[at - 1];
    if (previous !== 0x0a && previous !== 0x0d && previous !== 0x20 && previous !== 0x3e) {
      cursor = at + token.length;
      continue;
    }
    let start = at + token.length;
    if (pdf[start] === 0x0d) start += 1;
    if (pdf[start] === 0x0a) start += 1;
    const look = Buffer.from(pdf.subarray(Math.max(0, at - 400), at)).toString('latin1');
    const lengthMatch = /\/Length\s+(\d+)/u.exec(look);
    if (!lengthMatch?.[1]) {
      cursor = start;
      continue;
    }
    const length = Number(lengthMatch[1]);
    const data = pdf.subarray(start, start + length);
    const flate = look.includes('/FlateDecode');
    try {
      out.push(flate ? inflateSync(data) : data);
    } catch {
      // Image streams that are not the page content are skipped.
    }
    cursor = start + length;
  }
  return out;
}

function decodeWinAnsi(hex: string): string {
  let out = '';
  for (let index = 0; index + 1 < hex.length; index += 2) {
    const byte = Number.parseInt(hex.slice(index, index + 2), 16);
    const code = byte >= 0x80 && byte <= 0x9f ? CP1252[byte - 0x80] : byte;
    out += String.fromCharCode(code ?? byte);
  }
  return out;
}

function ascii(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'ascii'));
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  for (let index = from; index <= haystack.length - needle.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }
  return -1;
}

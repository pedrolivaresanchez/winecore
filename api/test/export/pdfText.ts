import { inflateSync } from 'node:zlib';

/** Pulls WinAnsi text drawn by pdf-lib (`<hex> Tj`) back out of the page streams. */
export function pdfLines(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  const latin = buffer.toString('latin1');
  const matcher = /\/Length\s+(\d+)\s*>>\s*stream\r?\n/g;
  const lines: string[] = [];
  for (const match of latin.matchAll(matcher)) {
    const length = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const body = buffer.subarray(start, start + length);
    let content: Buffer;
    try {
      content = inflateSync(body);
    } catch {
      content = body;
    }
    const text = content.toString('latin1');
    if (!text.includes('Tj')) continue;
    for (const hex of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      const value = hex[1];
      if (!value || value.length % 2 !== 0) continue;
      lines.push(Buffer.from(value, 'hex').toString('latin1'));
    }
  }
  return lines;
}

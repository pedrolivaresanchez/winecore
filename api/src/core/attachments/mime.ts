export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_MCP_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Last path segment only. `../` and control characters never become a stored name. */
export function safeAttachmentName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.replace(/[\u0000-\u001f]/g, '').trim() ?? '';
  return base.replace(/^\.+/, '').slice(0, 180);
}

const PDF = [0x25, 0x50, 0x44, 0x46]; // %PDF
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif']);

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return out;
}

function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return false;
  if (HEIC_BRANDS.has(ascii(bytes, 8, 4))) return true;
  const end = Math.min(bytes.length, 64);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (HEIC_BRANDS.has(ascii(bytes, offset, 4))) return true;
  }
  return false;
}

function textOf(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

function isXml(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<?xml')) return true;
  const tag = /^<([A-Za-z_:][\w:.-]*)/.exec(trimmed);
  const name = tag?.[1]?.toLowerCase();
  if (!name) return false;
  return name !== 'html' && name !== 'head' && name !== 'body' && name !== 'div';
}

function isCsv(text: string): boolean {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '').slice(0, 20);
  const first = lines[0];
  if (!first) return false;
  for (const delimiter of [',', ';', '\t']) {
    const width = splitCount(first, delimiter);
    if (width < 1) continue;
    if (lines.every((line) => splitCount(line, delimiter) === width)) return true;
  }
  return false;
}

function splitCount(line: string, delimiter: string): number {
  return line.split(delimiter).length - 1;
}

/** MIME por el contenido. El nombre y el tipo declarado no intervienen. */
export function detectMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, PDF)) return 'application/pdf';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (isHeic(bytes)) return 'image/heic';
  const text = textOf(bytes);
  if (text === null) return null;
  if (isXml(text)) return 'application/xml';
  if (isCsv(text)) return 'text/csv';
  return 'text/plain';
}

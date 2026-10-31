import { readFile } from 'node:fs/promises';
import { csvRecords } from '../csv';
import { readZip } from '../zip';

export async function readShopifyTable(path: string): Promise<Record<string, string>[]> {
  const buffer = await readFile(path);
  if (path.toLowerCase().endsWith('.zip') || isZip(buffer)) {
    const csv = readZip(buffer).find((entry) => entry.name.toLowerCase().endsWith('.csv'));
    if (!csv) throw new Error('SHOPIFY_ZIP_CSV');
    return csvRecords(csv.data.toString('utf8'));
  }
  return csvRecords(buffer.toString('utf8'));
}

function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

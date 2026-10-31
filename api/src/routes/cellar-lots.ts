import type { Writer } from '../core/db/writer';
import { getLot } from '../core/cellar/service/lots';

export function getLotRoute(writer: Writer, request: Request, code: string) {
  return getLot(writer, request, code);
}

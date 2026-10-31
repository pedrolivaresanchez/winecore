import type { Writer } from '../core/db/writer';
import {
  emptyLotList,
  getLot,
  listLots,
  lotAdditions,
  lotMoves,
  lotTraceability,
} from '../core/cellar/service/lots';
import { listAnalyses } from '../core/winemaking/service';

export function listLotRoute(writer: Writer, request: Request) {
  return listLots(writer, request);
}

export function getLotRoute(writer: Writer, request: Request, code: string) {
  return getLot(writer, request, code);
}

export function lotTraceabilityRoute(writer: Writer, request: Request, code: string) {
  return lotTraceability(writer, request, code);
}

export function lotMovesRoute(writer: Writer, request: Request, code: string) {
  return lotMoves(writer, request, code);
}

export function lotAnalysesRoute(writer: Writer, request: Request, code: string) {
  return listAnalyses(writer, request, code);
}

export function lotAdditionsRoute(writer: Writer, request: Request, code: string) {
  return lotAdditions(writer, request, code);
}

export function lotSalesRoute(writer: Writer, request: Request, code: string) {
  return emptyLotList(writer, request, code);
}

import type { Writer } from '../core/db/writer';
import {
  createVessel,
  getVessel,
  listVessels,
  patchVessel,
  resolveQr,
  retireVessel,
  vesselHistory,
  vesselQr,
} from '../core/cellar/service/vessels';

export function listVesselRoute(writer: Writer, request: Request) {
  return listVessels(writer, request);
}

export function getVesselRoute(writer: Writer, request: Request, code: string) {
  return getVessel(writer, request, code);
}

export function createVesselRoute(writer: Writer, request: Request) {
  return createVessel(writer, request);
}

export function patchVesselRoute(writer: Writer, request: Request, code: string) {
  return patchVessel(writer, request, code);
}

export function retireVesselRoute(writer: Writer, request: Request, code: string) {
  return retireVessel(writer, request, code);
}

export function vesselQrRoute(writer: Writer, request: Request, code: string) {
  return vesselQr(writer, request, code);
}

export function resolveQrRoute(writer: Writer, request: Request, token: string) {
  return resolveQr(writer, request, token);
}

export function vesselHistoryRoute(writer: Writer, request: Request, code: string) {
  return vesselHistory(writer, request, code);
}

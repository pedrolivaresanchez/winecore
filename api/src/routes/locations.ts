import type { Writer } from '../core/db/writer';
import {
  archiveLocation,
  createLocation,
  getLocation,
  listLocations,
  patchLocation,
} from '../core/cellar/service/locations';

export function listLocationRoute(writer: Writer, request: Request) {
  return listLocations(writer, request);
}

export function getLocationRoute(writer: Writer, request: Request, code: string) {
  return getLocation(writer, request, code);
}

export function createLocationRoute(writer: Writer, request: Request) {
  return createLocation(writer, request);
}

export function patchLocationRoute(writer: Writer, request: Request, code: string) {
  return patchLocation(writer, request, code);
}

export function archiveLocationRoute(writer: Writer, request: Request, code: string) {
  return archiveLocation(writer, request, code);
}

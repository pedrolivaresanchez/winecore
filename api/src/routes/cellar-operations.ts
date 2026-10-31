import type { Writer } from '../core/db/writer';
import {
  createOperation,
  getOperation,
  listOperations,
  rejectOperationChange,
} from '../core/cellar/service/operations';

export function listOperationRoute(writer: Writer, request: Request) {
  return listOperations(writer, request);
}

export function getOperationRoute(writer: Writer, request: Request, id: string) {
  return getOperation(writer, request, id);
}

export function createOperationRoute(writer: Writer, request: Request) {
  return createOperation(writer, request);
}

export function rejectOperationRoute(writer: Writer, request: Request, id: string) {
  return rejectOperationChange(writer, request, id);
}

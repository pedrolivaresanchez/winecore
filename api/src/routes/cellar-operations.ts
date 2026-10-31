import type { Writer } from '../core/db/writer';
import {
  confirmOperation,
  createOperation,
  getOperation,
  listOperations,
  previewOperation,
  rectifyOperation,
  updateOperation,
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

export function updateOperationRoute(writer: Writer, request: Request, id: string) {
  return updateOperation(writer, request, id);
}

export function previewOperationRoute(writer: Writer, request: Request, id: string) {
  return previewOperation(writer, request, id);
}

export function confirmOperationRoute(writer: Writer, request: Request, id: string) {
  return confirmOperation(writer, request, id);
}

export function rectifyOperationRoute(writer: Writer, request: Request, id: string) {
  return rectifyOperation(writer, request, id);
}

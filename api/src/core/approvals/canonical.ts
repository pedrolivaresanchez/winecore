/**
 * Canonical JSON for approval payloads (sorted keys, no whitespace) and its SHA-256.
 * The hash is what `ops.approval_request.payload_sha256` freezes.
 */
/// <reference path="./node-crypto.d.ts" />
import { createHash } from 'node:crypto';

import { APPROVAL_MESSAGES, approvalError } from './types';

export function canonicalJson(value: unknown): string {
  return serialize(value, new WeakSet());
}

export function payloadSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function fail(): never {
  throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.canonical);
}

function serialize(value: unknown, stack: WeakSet<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return serializeNumber(value);
  if (typeof value !== 'object') fail();

  if (stack.has(value)) fail();
  stack.add(value);
  try {
    if (Array.isArray(value)) return serializeArray(value, stack);
    if (!isPlainObject(value)) fail();
    return serializeObject(value, stack);
  } finally {
    stack.delete(value);
  }
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) fail();
  if (Object.is(value, -0)) return '0';
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail();
  const text = JSON.stringify(value);
  if (text === undefined) fail();
  return text;
}

function serializeArray(items: readonly unknown[], stack: WeakSet<object>): string {
  const parts: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    if (!Object.hasOwn(items, index)) fail();
    const item = items[index];
    if (item === undefined) fail();
    parts.push(serialize(item, stack));
  }
  return `[${parts.join(',')}]`;
}

function serializeObject(value: object, stack: WeakSet<object>): string {
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = record[key];
    if (child === undefined) fail();
    parts.push(`${JSON.stringify(key)}:${serialize(child, stack)}`);
  }
  return `{${parts.join(',')}}`;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

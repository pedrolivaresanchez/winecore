import type { Writer } from './writer';

/** DuckDB reports a missing table or view as "does not exist". Other errors must surface. */
export function isMissingRelation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
  return /does not exist/i.test(`${message} ${cause}`);
}

/** `null` when the statement touches a relation that is not deployed. */
export async function readOptional<T>(writer: Writer, statement: string): Promise<T[] | null> {
  try {
    return await writer.read<T>(statement);
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

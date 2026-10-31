export interface KbClient {
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  close?(): Promise<void>;
}

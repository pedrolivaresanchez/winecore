import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type RefObject = {
  kind: "table" | "view";
  schema: string;
  name: string;
  columns: string[];
};

/** Strip `--` comments that are outside string literals. */
export function stripLineComments(sql: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      out += ch;
      if (ch === "'" && sql[i + 1] === "'") {
        out += "'";
        i++;
        continue;
      }
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      current += ch;
      if (ch === "'" && body[i + 1] === "'") {
        current += "'";
        i++;
        continue;
      }
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function capture(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error('Captura de expresión regular vacía');
  return value;
}

function columnName(part: string): string | null {
  const text = part.trim();
  if (!text) return null;
  if (/^(constraint|primary|unique|check|exclude|foreign)\b/i.test(text)) return null;
  const match = /^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\b/.exec(text);
  const name = match?.[1];
  return name ? name.toLowerCase() : null;
}

function tableColumns(body: string): string[] {
  const cols: string[] = [];
  for (const part of splitTopLevel(body)) {
    const name = columnName(part);
    if (name) cols.push(name);
  }
  return cols;
}

/** Output names of a `SELECT` list (aliases when present). */
function selectColumns(selectList: string): string[] {
  const cols: string[] = [];
  for (const part of splitTopLevel(selectList)) {
    const text = part.trim();
    if (!text) continue;
    const asMatch = /\bas\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*$/i.exec(text);
    const alias = asMatch?.[1];
    if (alias) {
      cols.push(alias.toLowerCase());
      continue;
    }
    const bare = /([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(text.replace(/\s+/g, " "));
    const tail = bare?.[1];
    if (tail) cols.push(tail.toLowerCase());
  }
  return cols;
}

function matchParen(sql: string, openIndex: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = openIndex; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      if (ch === "'" && sql[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("unbalanced parenthesis");
}

export function parseReferenceSql(sql: string): RefObject[] {
  const clean = stripLineComments(sql);
  const objects: RefObject[] = [];
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(clean))) {
    const open = match.index + match[0].length - 1;
    const close = matchParen(clean, open);
    objects.push({
      kind: "table",
      schema: capture(match, 1).toLowerCase(),
      name: capture(match, 2).toLowerCase(),
      columns: tableColumns(clean.slice(open + 1, close)),
    });
    tableRe.lastIndex = close + 1;
  }
  const viewRe = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s+AS\s+SELECT\b/gi;
  while ((match = viewRe.exec(clean))) {
    const selectAt = match.index + match[0].length;
    let depth = 0;
    let inStr = false;
    let fromAt = -1;
    for (let i = selectAt; i < clean.length; i++) {
      const ch = clean[i];
      if (inStr) {
        if (ch === "'" && clean[i + 1] === "'") {
          i++;
          continue;
        }
        if (ch === "'") inStr = false;
        continue;
      }
      if (ch === "'") {
        inStr = true;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0 && /\bfrom\b/i.test(clean.slice(i, i + 4)) && /^\s*from\b/i.test(clean.slice(i))) {
        fromAt = i;
        break;
      }
    }
    if (fromAt < 0) throw new Error(`view ${capture(match, 1)}.${capture(match, 2)} has no FROM`);
    objects.push({
      kind: "view",
      schema: capture(match, 1).toLowerCase(),
      name: capture(match, 2).toLowerCase(),
      columns: selectColumns(clean.slice(selectAt, fromAt)),
    });
  }
  return objects;
}

export function referenceDir(root: string): string {
  return join(root, "docs/02-ddl");
}

export function readReferenceFiles(root: string): { file: string; sql: string }[] {
  const dir = referenceDir(root);
  return readdirSync(dir)
    .filter((name) => /^00\d\d_.*\.sql$/.test(name) && name !== "0000_roles.sql")
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
}

export function referenceObjects(root: string): RefObject[] {
  return readReferenceFiles(root).flatMap((entry) => parseReferenceSql(entry.sql));
}

export function wcCodesIn(sql: string): string[] {
  const found = new Set<string>();
  const re = /RAISE\s+EXCEPTION\s+'((?:WC\d{3}|WC_[A-Z0-9_]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) found.add(capture(match, 1));
  return [...found].sort();
}

export function partialUniqueIndexNames(sql: string): string[] {
  const names: string[] = [];
  const re = /CREATE\s+UNIQUE\s+INDEX\s+([a-zA-Z0-9_]+)\b[\s\S]*?;/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const body = match[0];
    const name = match[1];
    if (body !== undefined && name !== undefined && /\bWHERE\b/i.test(body)) names.push(name.toLowerCase());
  }
  return names;
}

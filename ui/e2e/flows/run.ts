/**
 * Arranca API y UI locales con una base nueva y lanza los flujos de ui/e2e/flows.
 * Uso: bun run e2e:flows
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = path.resolve(uiRoot, "../api");
const bun = process.execPath;
const bunDir = path.dirname(bun);
const dbFile = path.join(apiRoot, ".data", "e2e.duckdb");
const stateFile = path.join(apiRoot, ".data", "e2e-state.json");

const apiPort = process.env.E2E_API_PORT ?? "3140";
const uiPort = process.env.E2E_UI_PORT ?? "5240";
const uiOrigin = `http://localhost:${uiPort}`;

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: `${bunDir}${path.delimiter}${process.env.PATH ?? ""}`,
};

const apiEnv: NodeJS.ProcessEnv = {
  ...baseEnv,
  NODE_ENV: "development",
  AUTH_MODE: "dev",
  DB_MODE: "local",
  DB_PATH: ".data/e2e.duckdb",
  PORT: apiPort,
  DEV_USER_EMAIL: "owner@winecore.test",
  WINECORE_DATA_KEY: Buffer.alloc(32, 7).toString("base64"),
  WEBAUTHN_RP_ID: "localhost",
  WEBAUTHN_ORIGIN: uiOrigin,
  APP_PUBLIC_URL: uiOrigin,
};

const uiEnv: NodeJS.ProcessEnv = {
  ...baseEnv,
  VITE_API_PROXY_TARGET: `http://localhost:${apiPort}`,
  VITE_APP_PORT: uiPort,
  VITE_AUTH_ENABLED: "false",
  E2E_BASE_URL: uiOrigin,
  E2E_STATE_FILE: stateFile,
};

const children: ChildProcess[] = [];

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} salió con código ${code ?? "desconocido"}`));
    });
  });
}

function start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, logPath: string): ChildProcess {
  const log = createWriteStream(logPath);
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  children.push(child);
  return child;
}

function stopAll(): void {
  for (const child of children) {
    if (child.pid == null || child.exitCode != null) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

async function waitFor(url: string, logPath: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* sigue arrancando */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  let log = "";
  try {
    log = await readFile(logPath, "utf8");
  } catch {
    log = "";
  }
  throw new Error(`No responde ${url}\n${log.slice(-4000)}`);
}

async function assertFree(port: string): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
  } catch {
    return;
  }
  throw new Error(`El puerto ${port} ya está ocupado. Para la suite hace falta el ${apiPort} (API) y el ${uiPort} (UI) libres.`);
}

async function resetDb(): Promise<void> {
  await mkdir(path.dirname(dbFile), { recursive: true });
  await rm(dbFile, { force: true });
  await rm(`${dbFile}.wal`, { force: true });
  await rm(stateFile, { force: true });
  await writeFile(stateFile, "{}\n");
}

async function main(): Promise<void> {
  await assertFree(apiPort);
  await assertFree(uiPort);
  await resetDb();
  await run(bun, ["run", "migrate"], apiRoot, apiEnv);
  await run(bun, ["run", "seed"], apiRoot, apiEnv);
  await run(bun, ["run", "seed:demo"], apiRoot, apiEnv);

  const apiLog = "/tmp/winecore-e2e-api.log";
  const uiLog = "/tmp/winecore-e2e-ui.log";
  const api = start(bun, ["run", "src/index.ts"], apiRoot, apiEnv, apiLog);
  await waitFor(`http://127.0.0.1:${apiPort}/health`, apiLog);
  if (api.exitCode != null) throw new Error(`La API se detuvo\n${await readFile(apiLog, "utf8")}`);
  const ui = start(bun, ["run", "dev", "--", "--host", "127.0.0.1", "--port", uiPort, "--strictPort"], uiRoot, uiEnv, uiLog);
  await waitFor(`http://127.0.0.1:${uiPort}/`, uiLog);
  if (ui.exitCode != null) throw new Error(`La UI se detuvo\n${await readFile(uiLog, "utf8")}`);

  const playwright = path.join(uiRoot, "node_modules", ".bin", "playwright");
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(playwright, ["test", "--config", "e2e/flows/playwright.config.ts"], {
      cwd: uiRoot,
      env: uiEnv,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) process.exitCode = code;
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopAll();
  process.exit(143);
});

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    stopAll();
  });

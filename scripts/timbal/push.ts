/// <reference path="./ambient.d.ts" />

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_BRANCH,
  ALLOWED_ENV_ID,
  ALLOWED_ORG_ID,
  ALLOWED_PROJECT_ID,
  type DeployIds,
  assertBranch,
  assertCommitSha,
  assertEnvId,
  assertGithubRef,
  assertOrgId,
  assertProjectId,
  idsFromEnv,
  redactSecrets,
  requireApiKey,
  resolveGitRemote,
} from "./config";

export class PushRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushRefusedError";
  }
}

export type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string> },
) => CommandResult;

export type PushOptions = {
  sha: string;
  cwd?: string;
  remoteUrl?: string;
  orgId?: string;
  projectId?: string;
  envId?: string;
  branch?: string;
  githubRef?: string;
  apiKey?: string;
  runner?: CommandRunner;
};

export type PushResult = {
  pushed: boolean;
  remoteBefore: string | null;
  sha: string;
};

const GIT_PREFIX = ["-c", "safe.directory=*", "-c", "credential.helper="] as const;

const BLOCKED_ENV = /^(GIT_CONFIG_COUNT|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+|GIT_CONFIG_PARAMETERS|GIT_TRACE.*|GIT_CURL_VERBOSE|GIT_DEBUG)$/;

/**
 * Git pregunta usuario y contraseña por argv. La clave solo se lee de TIMBAL_API_KEY
 * en el entorno del proceso hijo; este fichero no la contiene.
 */
export const GIT_ASKPASS_SCRIPT = `#!/bin/sh
case "$1" in
  Username*)
    printf '%s\\n' 'timbal'
    ;;
  *)
    if [ -z "\${TIMBAL_API_KEY:-}" ]; then
      echo "Falta TIMBAL_API_KEY" >&2
      exit 1
    fi
    printf '%s\\n' "$TIMBAL_API_KEY"
    ;;
esac
`;

export function defaultCommandRunner(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string> },
): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    return { status: 1, stdout: "", stderr: result.error.message };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function gitChildEnv(apiKey: string | undefined, askpassPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || BLOCKED_ENV.test(key)) continue;
    env[key] = value;
  }
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = askpassPath;
  if (apiKey !== undefined && apiKey.length > 0) env.TIMBAL_API_KEY = apiKey;
  else delete env.TIMBAL_API_KEY;
  return env;
}

function assertIds(options: PushOptions): DeployIds {
  const orgId = options.orgId ?? ALLOWED_ORG_ID;
  const projectId = options.projectId ?? ALLOWED_PROJECT_ID;
  const envId = options.envId ?? ALLOWED_ENV_ID;
  const branch = options.branch ?? ALLOWED_BRANCH;
  assertOrgId(orgId);
  assertProjectId(projectId);
  assertEnvId(envId);
  assertBranch(branch);
  assertGithubRef(options.githubRef);
  return { orgId, projectId, envId, branch };
}

function assertNoSecretInArgs(args: readonly string[], secrets: readonly string[]): void {
  const blob = args.join("\n");
  for (const secret of secrets) {
    if (secret.length >= 8 && blob.includes(secret)) {
      throw new PushRefusedError("Rechazado: la clave no puede ir en la línea de comandos");
    }
  }
  if (args.some((arg) => arg === "--force" || arg.startsWith("--force=") || arg === "--force-with-lease" || arg.startsWith("--force-with-lease"))) {
    throw new PushRefusedError("Rechazado: el push a Timbal no usa --force");
  }
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

/**
 * Empuja la SHA exacta a `refs/heads/main` del git interno de Timbal.
 * Si el remoto ya apunta a un commit que no es ancestro de esa SHA, se rechaza.
 * Nunca `--force`.
 */
export function pushExactSha(options: PushOptions): PushResult {
  const ids = assertIds(options);
  const sha = assertCommitSha(options.sha);
  const remote = resolveGitRemote(options.remoteUrl);
  const needsAuth = remote.startsWith("https://");
  const apiKey = options.apiKey ?? (needsAuth ? requireApiKey(process.env.TIMBAL_API_KEY) : process.env.TIMBAL_API_KEY);
  if (needsAuth) requireApiKey(apiKey);
  const secrets = apiKey && apiKey.length >= 8 ? [apiKey] : [];
  const cwd = options.cwd ?? process.cwd();
  const runner = options.runner ?? defaultCommandRunner;
  const ref = `refs/heads/${ids.branch}`;
  const askpassDir = mkdtempSync(join(tmpdir(), "timbal-askpass-"));

  const run = (args: readonly string[], env: Record<string, string>): CommandResult => {
    const full = [...GIT_PREFIX, ...args];
    assertNoSecretInArgs(full, secrets);
    const result = runner("git", full, { cwd, env });
    return {
      status: result.status,
      stdout: redactSecrets(result.stdout, secrets),
      stderr: redactSecrets(result.stderr, secrets),
    };
  };

  try {
    const askpassPath = join(askpassDir, "askpass.sh");
    writeFileSync(askpassPath, GIT_ASKPASS_SCRIPT, { mode: 0o700 });
    chmodSync(askpassPath, 0o700);
    const env = gitChildEnv(apiKey, askpassPath);

    const head = run(["rev-parse", "--verify", "HEAD"], env);
    if (head.status !== 0) {
      throw new PushRefusedError(`No se pudo leer HEAD${head.stderr ? `: ${clip(head.stderr)}` : ""}`);
    }
    if (head.stdout.trim().toLowerCase() !== sha) {
      throw new PushRefusedError("La SHA no es HEAD; no se empuja otro commit");
    }

    const listed = run(["ls-remote", remote, ref], env);
    if (listed.status !== 0) {
      throw new PushRefusedError(`No se pudo leer el remoto de Timbal: ${clip(listed.stderr || listed.stdout)}`);
    }
    const remoteBefore = parseRemoteSha(listed.stdout, ref);
    if (remoteBefore === sha) {
      return { pushed: false, remoteBefore, sha };
    }
    if (remoteBefore !== null) {
      const present = run(["cat-file", "-e", `${remoteBefore}^{commit}`], env);
      if (present.status !== 0) {
        throw new PushRefusedError(
          `Rechazado: Timbal ${ids.branch} está en ${remoteBefore}, que no está en nuestro historial. No se fuerza el push.`,
        );
      }
      const ancestor = run(["merge-base", "--is-ancestor", remoteBefore, sha], env);
      if (ancestor.status === 1) {
        throw new PushRefusedError(
          `Rechazado: Timbal ${ids.branch} está en ${remoteBefore}, que no es ancestro de ${sha}. No se fuerza el push.`,
        );
      }
      if (ancestor.status !== 0) {
        throw new PushRefusedError(`No se pudo comprobar el historial: ${clip(ancestor.stderr)}`);
      }
    }

    const pushed = run(["push", "--quiet", remote, `${sha}:${ref}`], env);
    if (pushed.status !== 0) {
      throw new PushRefusedError(`El push a Timbal falló: ${clip(pushed.stderr || pushed.stdout)}`);
    }
    return { pushed: true, remoteBefore, sha };
  } finally {
    rmSync(askpassDir, { recursive: true, force: true });
  }
}

function parseRemoteSha(stdout: string, ref: string): string | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith(ref));
  if (lines.length === 0) return null;
  if (lines.length > 1) {
    throw new PushRefusedError("ls-remote devolvió más de una ref");
  }
  const sha = (lines[0] ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new PushRefusedError("SHA remota ilegible");
  }
  return sha;
}

function main(): void {
  try {
    const ids = idsFromEnv();
    const sha = assertCommitSha(process.env.GITHUB_SHA ?? "");
    assertGithubRef(process.env.GITHUB_REF);
    const result = pushExactSha({
      sha,
      orgId: ids.orgId,
      projectId: ids.projectId,
      envId: ids.envId,
      branch: ids.branch,
      githubRef: process.env.GITHUB_REF,
      apiKey: requireApiKey(process.env.TIMBAL_API_KEY),
    });
    const verb = result.pushed ? "Empujada" : "Ya estaba";
    console.log(`${verb} ${result.sha} en Timbal ${ids.branch}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "push fallido";
    console.error(redactSecrets(message, [process.env.TIMBAL_API_KEY ?? ""]));
    process.exit(1);
  }
}

if (import.meta.main) main();

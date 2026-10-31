/// <reference path="./ambient.d.ts" />

import { TimbalApiError, TimbalClient, type FetchLike } from "./client";
import {
  ALLOWED_BRANCH,
  ALLOWED_ENV_ID,
  ALLOWED_ORG_ID,
  ALLOWED_PROJECT_ID,
  assertBranch,
  assertCommitSha,
  assertEnvId,
  assertGithubRef,
  assertOrgId,
  assertProjectId,
  csvList,
  idsFromEnv,
  positiveInt,
  redactSecrets,
  requireApiKey,
} from "./config";

export class DeployFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployFailedError";
  }
}

export class DeployTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployTimeoutError";
  }
}

/**
 * `DeploymentDetail.status` es un string sin enum en el OpenAPI de
 * List Environment Deployments (docs.timbal.ai, v2.0.0). Estos conjuntos
 * no están verificados. Se sustituyen con `successStatuses` / `failureStatuses`
 * (en CI: TIMBAL_DEPLOY_SUCCESS_STATUSES y TIMBAL_DEPLOY_FAILURE_STATUSES).
 * Un estado desconocido se trata como pendiente hasta el tiempo de espera.
 */
export const UNVERIFIED_SUCCESS_STATUSES = ["succeeded", "success"];
export const UNVERIFIED_FAILURE_STATUSES = ["failed", "error", "canceled", "cancelled"];

/**
 * Query verificada: el parámetro `trigger` acepta `latest`
 * (docs.timbal.ai/api-reference/projects/environments/deployments/list).
 * ADR 001 V7 lee `target.commit` de esa respuesta.
 */
export const DEPLOYMENTS_QUERY = "trigger=latest";

export const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;
export const DEPLOY_POLL_MS = 10_000;

export type DeploymentOutcome = "success" | "failure" | "pending";

export function classifyDeploymentStatus(
  status: string,
  sets: { success: readonly string[]; failure: readonly string[] },
): DeploymentOutcome {
  const normalized = status.trim().toLowerCase();
  if (sets.success.some((item) => item.toLowerCase() === normalized)) return "success";
  if (sets.failure.some((item) => item.toLowerCase() === normalized)) return "failure";
  return "pending";
}

/**
 * `DeploymentTarget.commit` está tipado como esquema vacío (`{}`) en ese OpenAPI.
 * ADR 001/007 lo tratan como la SHA git. Si no es una SHA de 40 hex, no coincide.
 */
export function readDeploymentCommit(commit: unknown): string | null {
  if (typeof commit !== "string") return null;
  const value = commit.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(value)) return null;
  return value;
}

type DeploymentRow = {
  status?: unknown;
  target?: { commit?: unknown } | null;
};

export function judgeDeployments(
  rows: readonly DeploymentRow[],
  sha: string,
  sets: { success: readonly string[]; failure: readonly string[] },
): DeploymentOutcome {
  // Filas de otra SHA son un lote anterior: no cuentan (si no, un fallo viejo
  // abortaría el sondeo antes de que aparezca el despliegue nuevo).
  const relevant = rows.filter((row) => {
    const commit = readDeploymentCommit(row.target?.commit);
    return commit === null || commit === sha;
  });
  if (relevant.length === 0) return "pending";
  let sawFailure = false;
  let sawMatch = false;
  let sawIncomplete = false;
  for (const row of relevant) {
    const commit = readDeploymentCommit(row.target?.commit);
    const kind = classifyDeploymentStatus(typeof row.status === "string" ? row.status : "", sets);
    if (kind === "failure") sawFailure = true;
    if (commit === sha && kind === "success") sawMatch = true;
    if (commit !== sha || kind !== "success") sawIncomplete = true;
  }
  if (sawFailure) return "failure";
  if (sawIncomplete || !sawMatch) return "pending";
  return "success";
}

function parseRows(body: unknown): DeploymentRow[] {
  if (typeof body !== "object" || body === null || !("deployments" in body)) {
    throw new DeployFailedError("Respuesta de despliegues ilegible");
  }
  const deployments = (body as { deployments: unknown }).deployments;
  if (!Array.isArray(deployments)) throw new DeployFailedError("Respuesta de despliegues ilegible");
  return deployments as DeploymentRow[];
}

export type DeployOptions = {
  sha: string;
  token: string;
  orgId?: string;
  projectId?: string;
  envId?: string;
  branch?: string;
  githubRef?: string;
  /** Sustituye el campo `rev` del POST. Por defecto es la SHA. */
  rev?: string;
  /** Sustituye la query verificada `trigger=latest`. */
  deploymentsQuery?: string;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: FetchLike;
  successStatuses?: readonly string[];
  failureStatuses?: readonly string[];
  client?: TimbalClient;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function paths(orgId: string, projectId: string, envId: string, query: string): { deploy: string; list: string } {
  assertOrgId(orgId);
  assertProjectId(projectId);
  assertEnvId(envId);
  const root = `/orgs/${orgId}/projects/${projectId}/envs/${envId}`;
  return {
    deploy: `${root}/deploy`,
    list: `${root}/deployments?${query}`,
  };
}

/**
 * POST `…/envs/{env}/deploy` con `{ rev }` (docs.timbal.ai, respuesta documentada 202).
 * El OpenAPI no dice si `rev` acepta una SHA o solo un nombre de rama (ADR 007):
 * por defecto se envía la SHA; `rev` permite cambiarlo.
 * Después se sondea el listado hasta éxito, fallo o tiempo de espera.
 */
export async function deployAndWait(options: DeployOptions): Promise<void> {
  const orgId = options.orgId ?? ALLOWED_ORG_ID;
  const projectId = options.projectId ?? ALLOWED_PROJECT_ID;
  const envId = options.envId ?? ALLOWED_ENV_ID;
  const branch = options.branch ?? ALLOWED_BRANCH;
  assertBranch(branch);
  assertGithubRef(options.githubRef);
  const sha = assertCommitSha(options.sha);
  const rev = options.rev?.trim() || sha;
  const query = options.deploymentsQuery?.replace(/^\?/, "") || DEPLOYMENTS_QUERY;
  const { deploy, list } = paths(orgId, projectId, envId, query);
  const sets = {
    success: options.successStatuses ?? UNVERIFIED_SUCCESS_STATUSES,
    failure: options.failureStatuses ?? UNVERIFIED_FAILURE_STATUSES,
  };
  const client =
    options.client ??
    new TimbalClient({
      token: options.token,
      fetchImpl: options.fetchImpl,
    });
  const timeoutMs = options.timeoutMs ?? DEPLOY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEPLOY_POLL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  let accepted: { status: number; body: unknown };
  try {
    accepted = await client.request("POST", deploy, { rev });
  } catch (error) {
    if (error instanceof TimbalApiError) {
      throw new DeployFailedError(`Timbal rechazó el despliegue (${error.status}): ${error.message}`);
    }
    throw error;
  }
  if (accepted.status !== 202) {
    throw new DeployFailedError(`Timbal respondió ${accepted.status} al desplegar; la documentación indica 202`);
  }

  const started = now();
  for (;;) {
    const listed = await client.request("GET", list);
    const outcome = judgeDeployments(parseRows(listed.body), sha, sets);
    if (outcome === "success") return;
    if (outcome === "failure") {
      throw new DeployFailedError(`Despliegue de ${sha} fallido en el entorno ${envId}`);
    }
    if (now() - started >= timeoutMs) {
      throw new DeployTimeoutError(`Tiempo de espera agotado esperando el despliegue de ${sha}`);
    }
    await sleep(pollMs);
  }
}

async function main(): Promise<void> {
  const ids = idsFromEnv();
  const sha = assertCommitSha(process.env.GITHUB_SHA ?? "");
  assertGithubRef(process.env.GITHUB_REF);
  const token = requireApiKey(process.env.TIMBAL_API_KEY);
  const rev = process.env.TIMBAL_DEPLOY_REV?.trim() || sha;
  await deployAndWait({
    sha,
    token,
    orgId: ids.orgId,
    projectId: ids.projectId,
    envId: ids.envId,
    branch: ids.branch,
    githubRef: process.env.GITHUB_REF,
    rev,
    deploymentsQuery: process.env.TIMBAL_DEPLOYMENTS_QUERY?.trim() || DEPLOYMENTS_QUERY,
    timeoutMs: positiveInt(process.env.TIMBAL_DEPLOY_TIMEOUT_MS, DEPLOY_TIMEOUT_MS),
    pollMs: positiveInt(process.env.TIMBAL_DEPLOY_POLL_MS, DEPLOY_POLL_MS),
    successStatuses: csvList(process.env.TIMBAL_DEPLOY_SUCCESS_STATUSES, UNVERIFIED_SUCCESS_STATUSES),
    failureStatuses: csvList(process.env.TIMBAL_DEPLOY_FAILURE_STATUSES, UNVERIFIED_FAILURE_STATUSES),
  });
  console.log(`Despliegue de ${sha} listo en el entorno ${ids.envId}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "despliegue fallido";
    console.error(redactSecrets(message, [process.env.TIMBAL_API_KEY ?? ""]));
    process.exit(1);
  });
}

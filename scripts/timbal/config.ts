/// <reference path="./ambient.d.ts" />

// Único destino permitido del despliegue: org 122, proyecto 3942, entorno Main 4165, rama main.
// Cualquier otro id se rechaza antes de tocar git o la red.

export class TargetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetRefusedError";
  }
}

export const ALLOWED_ORG_ID = "122";
export const ALLOWED_PROJECT_ID = "3942";
export const ALLOWED_ENV_ID = "4165";
export const ALLOWED_ENV_NAME = "Main";
export const ALLOWED_BRANCH = "main";

/** SDK `DEFAULT_CONFIG.baseUrl` y servidor Production del OpenAPI (`https://api.timbal.ai`). */
export const TIMBAL_API_BASE_URL = "https://api.timbal.ai";

/** Usuario git documentado (ADR 001, H4). La contraseña es la API key y no forma parte de la URL. */
export const GIT_HTTP_USERNAME = "timbal";

const SHA40 = /^[0-9a-f]{40}$/;

export function assertOrgId(orgId: string): void {
  if (orgId.trim() !== ALLOWED_ORG_ID) {
    throw new TargetRefusedError(`Rechazada la org de Timbal «${orgId.trim() || "vacía"}»: solo se admite ${ALLOWED_ORG_ID}`);
  }
}

export function assertProjectId(projectId: string): void {
  if (projectId.trim() !== ALLOWED_PROJECT_ID) {
    throw new TargetRefusedError(
      `Rechazado el proyecto de Timbal «${projectId.trim() || "vacío"}»: solo se admite ${ALLOWED_PROJECT_ID}`,
    );
  }
}

export function assertEnvId(envId: string): void {
  if (envId.trim() !== ALLOWED_ENV_ID) {
    throw new TargetRefusedError(
      `Rechazado el entorno de Timbal «${envId.trim() || "vacío"}»: solo se admite Main ${ALLOWED_ENV_ID}`,
    );
  }
}

export function assertBranch(branch: string): void {
  if (branch.trim() !== ALLOWED_BRANCH) {
    throw new TargetRefusedError(`Rechazada la rama «${branch.trim() || "vacía"}»: solo se admite ${ALLOWED_BRANCH}`);
  }
}

export function assertCommitSha(sha: string): string {
  const normalized = sha.trim().toLowerCase();
  if (!SHA40.test(normalized)) {
    throw new TargetRefusedError("La SHA tiene que ser 40 hexadecimales");
  }
  return normalized;
}

export function assertGithubRef(ref: string | undefined): void {
  if (ref !== undefined && ref !== "" && ref !== `refs/heads/${ALLOWED_BRANCH}`) {
    throw new TargetRefusedError(`Rechazada la ref «${ref}»: solo se despliega refs/heads/${ALLOWED_BRANCH}`);
  }
}

export type DeployIds = {
  orgId: string;
  projectId: string;
  envId: string;
  branch: string;
};

export function idsFromEnv(env: Record<string, string | undefined> = process.env): DeployIds {
  const orgId = env.TIMBAL_ORG_ID?.trim() || ALLOWED_ORG_ID;
  const projectId = env.TIMBAL_PROJECT_ID?.trim() || ALLOWED_PROJECT_ID;
  const envId = env.TIMBAL_ENV_ID?.trim() || ALLOWED_ENV_ID;
  const branch = env.TIMBAL_GIT_BRANCH?.trim() || ALLOWED_BRANCH;
  assertOrgId(orgId);
  assertProjectId(projectId);
  assertEnvId(envId);
  assertBranch(branch);
  return { orgId, projectId, envId, branch };
}

export function requireApiKey(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error("Falta TIMBAL_API_KEY");
  }
  return value;
}

/** Ruta bajo la org y el proyecto permitidos. Si lleva `/envs/`, el id tiene que ser Main. */
export function assertAllowedApiPath(path: string): void {
  if (!path.startsWith("/") || path.includes("://") || path.includes("@")) {
    throw new TargetRefusedError("Ruta de Timbal rechazada");
  }
  const pathname = path.split("?")[0] ?? path;
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length < 4 || parts[0] !== "orgs" || parts[2] !== "projects") {
    throw new TargetRefusedError("Ruta de Timbal fuera de org y proyecto");
  }
  assertOrgId(parts[1] ?? "");
  assertProjectId(parts[3] ?? "");
  const envIndex = parts.indexOf("envs");
  if (envIndex !== -1) {
    assertEnvId(parts[envIndex + 1] ?? "");
  }
}

export function assertTimbalBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized !== TIMBAL_API_BASE_URL) {
    throw new TargetRefusedError("Rechazada la URL base de Timbal");
  }
  return normalized;
}

export function canonicalGitRemote(): string {
  return `https://${GIT_HTTP_USERNAME}@api.timbal.ai/orgs/${ALLOWED_ORG_ID}/projects/${ALLOWED_PROJECT_ID}/git`;
}

/**
 * Remoto git del proyecto. Una URL https que no sea exactamente ese proyecto se rechaza.
 * Un path absoluto local solo sirve para las pruebas (repositorio desnudo, sin red).
 */
export function resolveGitRemote(remoteUrl?: string): string {
  if (remoteUrl === undefined || remoteUrl === "") {
    return canonicalGitRemote();
  }
  if (remoteUrl.includes("\n") || remoteUrl.includes("\0") || remoteUrl.includes(" ")) {
    throw new TargetRefusedError("Remoto git rechazado");
  }
  if (remoteUrl.startsWith("https://") || remoteUrl.startsWith("http://")) {
    return normalizeTimbalGitUrl(remoteUrl);
  }
  if (remoteUrl.startsWith("/") && !remoteUrl.startsWith("//")) {
    return remoteUrl;
  }
  throw new TargetRefusedError("Remoto git rechazado");
}

function normalizeTimbalGitUrl(remoteUrl: string): string {
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch {
    throw new TargetRefusedError("Remoto git rechazado");
  }
  if (url.protocol !== "https:") {
    throw new TargetRefusedError("El remoto git de Timbal tiene que ser https");
  }
  if (url.password) {
    throw new TargetRefusedError("La API key no puede ir en la URL de git");
  }
  if (url.username !== "" && url.username !== GIT_HTTP_USERNAME) {
    throw new TargetRefusedError("Usuario git rechazado");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (url.hostname !== "api.timbal.ai" || path !== `/orgs/${ALLOWED_ORG_ID}/projects/${ALLOWED_PROJECT_ID}/git`) {
    throw new TargetRefusedError("Remoto git que no es el proyecto WineCore");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new TargetRefusedError("Remoto git rechazado");
  }
  return canonicalGitRemote();
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  const sorted = [...secrets].filter((secret) => secret.length >= 8).sort((a, b) => b.length - a.length);
  for (const secret of sorted) {
    if (out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

export function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Valor numérico no válido`);
  }
  return value;
}

export function csvList(raw: string | undefined, fallback: readonly string[]): string[] {
  if (raw === undefined || raw.trim() === "") return [...fallback];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/// <reference path="./ambient.d.ts" />

import { describe, expect, it } from "bun:test";
import {
  ALLOWED_ENV_ID,
  ALLOWED_ORG_ID,
  ALLOWED_PROJECT_ID,
  TargetRefusedError,
  assertBranch,
  assertEnvId,
  assertOrgId,
  assertProjectId,
  canonicalGitRemote,
  idsFromEnv,
  redactSecrets,
  resolveGitRemote,
} from "./config";

const SECRET = "timbal-test-key-should-not-appear";

describe("assertOrgId", () => {
  it("122 → se admite", () => {
    assertOrgId(ALLOWED_ORG_ID);
  });

  it("otra org → se rechaza", () => {
    expect(() => assertOrgId("999")).toThrow(TargetRefusedError);
    expect(() => assertOrgId("1220")).toThrow(TargetRefusedError);
    expect(() => assertOrgId("")).toThrow(TargetRefusedError);
  });
});

describe("assertProjectId", () => {
  it("3942 → se admite", () => {
    assertProjectId(ALLOWED_PROJECT_ID);
  });

  it("otro proyecto → se rechaza", () => {
    expect(() => assertProjectId("8888")).toThrow(TargetRefusedError);
    expect(() => assertProjectId("39420")).toThrow(TargetRefusedError);
  });
});

describe("assertEnvId / assertBranch", () => {
  it("Main 4165 y main → se admiten", () => {
    assertEnvId(ALLOWED_ENV_ID);
    assertBranch("main");
  });

  it("otro entorno o rama → se rechaza", () => {
    expect(() => assertEnvId("7777")).toThrow(TargetRefusedError);
    expect(() => assertBranch("staging")).toThrow(TargetRefusedError);
  });
});

describe("idsFromEnv", () => {
  it("sin variables → org 122 y proyecto 3942", () => {
    expect(idsFromEnv({})).toEqual({
      orgId: "122",
      projectId: "3942",
      envId: "4165",
      branch: "main",
    });
  });

  it("TIMBAL_ORG_ID distinto → se rechaza", () => {
    expect(() => idsFromEnv({ TIMBAL_ORG_ID: "999" })).toThrow(TargetRefusedError);
  });

  it("TIMBAL_PROJECT_ID distinto → se rechaza", () => {
    expect(() => idsFromEnv({ TIMBAL_PROJECT_ID: "8888" })).toThrow(TargetRefusedError);
  });
});

describe("resolveGitRemote", () => {
  it("sin argumento → remoto canónico del proyecto 3942", () => {
    expect(resolveGitRemote()).toBe(canonicalGitRemote());
    expect(canonicalGitRemote()).toBe("https://timbal@api.timbal.ai/orgs/122/projects/3942/git");
  });

  it("https de otro proyecto u otro host → se rechaza", () => {
    expect(() => resolveGitRemote("https://api.timbal.ai/orgs/122/projects/8888/git")).toThrow(TargetRefusedError);
    expect(() => resolveGitRemote("https://api.timbal.ai/orgs/999/projects/3942/git")).toThrow(TargetRefusedError);
    expect(() => resolveGitRemote("https://example.test/orgs/122/projects/3942/git")).toThrow(TargetRefusedError);
    expect(() => resolveGitRemote("http://api.timbal.ai/orgs/122/projects/3942/git")).toThrow(TargetRefusedError);
  });

  it("contraseña en la URL → se rechaza", () => {
    expect(() => resolveGitRemote("https://timbal:not-a-key@api.timbal.ai/orgs/122/projects/3942/git")).toThrow(
      TargetRefusedError,
    );
  });

  it("path absoluto local → se admite; relativo no", () => {
    expect(resolveGitRemote("/tmp/winecore-remote.git")).toBe("/tmp/winecore-remote.git");
    expect(() => resolveGitRemote("relative.git")).toThrow(TargetRefusedError);
  });
});

describe("redactSecrets", () => {
  it("quita la clave y el bearer", () => {
    const text = `Authorization: Bearer ${SECRET} cuerpo ${SECRET}`;
    const redacted = redactSecrets(text, [SECRET]);
    if (redacted.includes(SECRET)) throw new Error("el texto redactado conserva el secreto");
    expect(redacted).toContain("[redacted]");
    expect(redacted).toContain("Bearer [redacted]");
  });
});

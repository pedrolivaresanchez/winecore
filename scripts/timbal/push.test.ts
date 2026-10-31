/// <reference path="./ambient.d.ts" />

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { TargetRefusedError } from "./config";
import {
  GIT_ASKPASS_SCRIPT,
  PushRefusedError,
  defaultCommandRunner,
  pushExactSha,
  type CommandRunner,
} from "./push";

const SECRET = "timbal-test-key-should-not-appear";

function assertAbsent(haystack: string, label: string): void {
  if (haystack.includes(SECRET)) throw new Error(`${label} contiene el secreto`);
}

function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (
      key === "GIT_CONFIG_COUNT" ||
      key.startsWith("GIT_CONFIG_KEY_") ||
      key.startsWith("GIT_CONFIG_VALUE_") ||
      key === "GIT_CONFIG_PARAMETERS" ||
      key.startsWith("GIT_TRACE")
    ) {
      continue;
    }
    env[key] = value;
  }
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_AUTHOR_NAME = "WineCore Test";
  env.GIT_AUTHOR_EMAIL = "test@example.com";
  env.GIT_COMMITTER_NAME = "WineCore Test";
  env.GIT_COMMITTER_EMAIL = "test@example.com";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

function git(args: string[], cwd?: string): string {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "safe.directory=*", ...args], {
    cwd,
    env: gitEnv(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args[0] ?? ""} falló`);
  }
  return result.stdout;
}

function remoteHead(bare: string): string | null {
  const output = git(["ls-remote", bare, "refs/heads/main"]).trim();
  if (output === "") return null;
  return output.split(/\s+/)[0] ?? null;
}

function recordingRunner(): { runner: CommandRunner; sawPush: () => boolean; sawForce: () => boolean } {
  let pushed = false;
  let forced = false;
  const runner: CommandRunner = (command, args, options) => {
    assertAbsent(args.join("\n"), "argv");
    const script = options.env.GIT_ASKPASS;
    if (script !== undefined) assertAbsent(readFileSync(script, "utf8"), "askpass");
    if (args.includes("push")) pushed = true;
    if (args.some((arg) => arg === "--force" || arg.startsWith("--force"))) forced = true;
    const result = defaultCommandRunner(command, args, options);
    assertAbsent(result.stdout, "stdout");
    assertAbsent(result.stderr, "stderr");
    return result;
  };
  return {
    runner,
    sawPush: () => pushed,
    sawForce: () => forced,
  };
}

describe("pushExactSha", () => {
  it("org distinta → no ejecuta git", () => {
    let called = false;
    const runner: CommandRunner = () => {
      called = true;
      return { status: 0, stdout: "", stderr: "" };
    };
    expect(() =>
      pushExactSha({
        sha: "a".repeat(40),
        orgId: "999",
        runner,
      }),
    ).toThrow(TargetRefusedError);
    expect(called).toBe(false);
  });

  it("fast-forward → actualiza el remoto desnudo y no usa --force", () => {
    const root = mkdtempSync(join(tmpdir(), "winecore-push-"));
    try {
      const bare = join(root, "remote.git");
      const local = join(root, "local");
      git(["init", "--bare", "-b", "main", bare]);
      git(["init", "-b", "main", local]);
      git(["commit", "--allow-empty", "-m", "base"], local);
      git(["push", bare, "HEAD:refs/heads/main"], local);
      git(["commit", "--allow-empty", "-m", "siguiente"], local);
      const sha = git(["rev-parse", "HEAD"], local).trim();
      const recorded = recordingRunner();
      const logs: string[] = [];
      const previous = { log: console.log, error: console.error };
      console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      try {
        const result = pushExactSha({
          cwd: local,
          sha,
          remoteUrl: bare,
          apiKey: SECRET,
          runner: recorded.runner,
        });
        expect(result.pushed).toBe(true);
        expect(result.sha).toBe(sha);
      } finally {
        console.log = previous.log;
        console.error = previous.error;
      }
      expect(remoteHead(bare)).toBe(sha);
      expect(recorded.sawPush()).toBe(true);
      expect(recorded.sawForce()).toBe(false);
      assertAbsent(logs.join("\n"), "log");
      assertAbsent(GIT_ASKPASS_SCRIPT, "script");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("commit remoto que no es ancestro → se rechaza y el remoto no cambia", () => {
    const root = mkdtempSync(join(tmpdir(), "winecore-push-"));
    try {
      const bare = join(root, "remote.git");
      const local = join(root, "local");
      git(["init", "--bare", "-b", "main", bare]);
      git(["init", "-b", "main", local]);
      git(["commit", "--allow-empty", "-m", "base"], local);
      git(["commit", "--allow-empty", "-m", "lado"], local);
      const side = git(["rev-parse", "HEAD"], local).trim();
      git(["reset", "--hard", "HEAD~1"], local);
      git(["commit", "--allow-empty", "-m", "nuestro"], local);
      const ours = git(["rev-parse", "HEAD"], local).trim();
      git(["push", bare, `${side}:refs/heads/main`], local);
      const recorded = recordingRunner();
      expect(() =>
        pushExactSha({
          cwd: local,
          sha: ours,
          remoteUrl: bare,
          apiKey: SECRET,
          runner: recorded.runner,
        }),
      ).toThrow(PushRefusedError);
      expect(remoteHead(bare)).toBe(side);
      expect(recorded.sawPush()).toBe(false);
      expect(recorded.sawForce()).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("commit remoto ausente del historial → se rechaza", () => {
    const root = mkdtempSync(join(tmpdir(), "winecore-push-"));
    try {
      const bare = join(root, "remote.git");
      const other = join(root, "other");
      const local = join(root, "local");
      git(["init", "--bare", "-b", "main", bare]);
      git(["init", "-b", "main", other]);
      git(["commit", "--allow-empty", "-m", "ajeno"], other);
      const foreign = git(["rev-parse", "HEAD"], other).trim();
      git(["push", bare, "HEAD:refs/heads/main"], other);
      git(["init", "-b", "main", local]);
      git(["commit", "--allow-empty", "-m", "nuestro"], local);
      const ours = git(["rev-parse", "HEAD"], local).trim();
      const recorded = recordingRunner();
      expect(() =>
        pushExactSha({
          cwd: local,
          sha: ours,
          remoteUrl: bare,
          apiKey: SECRET,
          runner: recorded.runner,
        }),
      ).toThrow(PushRefusedError);
      expect(remoteHead(bare)).toBe(foreign);
      expect(recorded.sawPush()).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("la misma SHA → no empuja", () => {
    const root = mkdtempSync(join(tmpdir(), "winecore-push-"));
    try {
      const bare = join(root, "remote.git");
      const local = join(root, "local");
      git(["init", "--bare", "-b", "main", bare]);
      git(["init", "-b", "main", local]);
      git(["commit", "--allow-empty", "-m", "unico"], local);
      git(["push", bare, "HEAD:refs/heads/main"], local);
      const sha = git(["rev-parse", "HEAD"], local).trim();
      const recorded = recordingRunner();
      const result = pushExactSha({
        cwd: local,
        sha,
        remoteUrl: bare,
        apiKey: SECRET,
        runner: recorded.runner,
      });
      expect(result.pushed).toBe(false);
      expect(recorded.sawPush()).toBe(false);
      expect(remoteHead(bare)).toBe(sha);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

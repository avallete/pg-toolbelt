/**
 * CLI golden-path E2E test. Runs in Node, Bun, or Deno.
 * Spawns pgdelta and verifies --help and catalog-export work.
 */

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL env var is required for cli-golden-path");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const isDeno = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";
const cwd = process.cwd();
const cliPath = `${cwd}/node_modules/@supabase/pg-delta/dist/cli/bin/cli.js`;

async function runPgdelta(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const env = { ...process.env, DATABASE_URL: dbUrl };

  if (isDeno) {
    const { Deno } = globalThis as {
      Deno: {
        Command: new (
          cmd: string,
          opts?: { args: string[]; env?: Record<string, string>; cwd?: string },
        ) => {
          output: () => Promise<{
            code: number;
            stdout: Uint8Array;
            stderr: Uint8Array;
          }>;
        };
      };
    };
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-env",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--node-modules-dir=manual",
        cliPath,
        ...args,
      ],
      env,
      cwd,
    });
    const { code, stdout, stderr } = await cmd.output();
    return {
      exitCode: code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    };
  }

  const { spawnSync } = await import("node:child_process");
  const runtime = typeof Bun !== "undefined" ? "bun" : "node";
  const result = spawnSync(runtime, [cliPath, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const helpResult = await runPgdelta(["--help"]);
assert(
  helpResult.exitCode === 0,
  `pgdelta --help should exit 0, got ${helpResult.exitCode}\n${helpResult.stderr}`,
);

const planHelpResult = await runPgdelta(["plan", "--help"]);
assert(
  planHelpResult.exitCode === 0,
  `pgdelta plan --help should exit 0, got ${planHelpResult.exitCode}\n${planHelpResult.stderr}`,
);

const outputPath = `${cwd}/catalog-output.json`;
const catalogResult = await runPgdelta([
  "catalog-export",
  "--target",
  dbUrl,
  "--output",
  outputPath,
]);
assert(
  catalogResult.exitCode === 0,
  `pgdelta catalog-export should exit 0, got ${catalogResult.exitCode}\n${catalogResult.stderr}`,
);

let content: string;
if (isDeno) {
  const { Deno } = globalThis as {
    Deno: {
      readFileSync: (path: string) => Uint8Array;
      stat: (path: string) => Promise<{ isFile: boolean }>;
    };
  };
  const stat = await Deno.stat(outputPath);
  assert(stat.isFile, `catalog-export output file should exist: ${outputPath}`);
  content = new TextDecoder().decode(Deno.readFileSync(outputPath));
} else {
  const { readFileSync, existsSync } = await import("node:fs");
  assert(
    existsSync(outputPath),
    `catalog-export output file should exist: ${outputPath}`,
  );
  content = readFileSync(outputPath, "utf8");
}
const parsed = JSON.parse(content);
assert(
  typeof parsed === "object",
  "catalog export should produce valid JSON object",
);

console.log("cli-golden-path e2e passed.");

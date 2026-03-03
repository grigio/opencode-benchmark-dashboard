import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve, join } from "path";
import type { RunSummary } from "./types.ts";

export const SOLUTIONS_DIR = resolve("./solutions");
export const RESULTS_DIR = resolve("./results");

export function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export function sanitizeModelName(model: string): string {
  return model
    .replace(/[^a-zA-Z0-9]/g, (match) => {
      if (match === "/" || match === ":" || match === "-") return "-";
      if (match === ".") return "-";
      return "_";
    })
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generateRunId(): string {
  return `run_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

export function loadExistingResults(model: string): RunSummary | null {
  const sanitized = sanitizeModelName(model);
  const resultPath = join(RESULTS_DIR, `${sanitized}.json`);
  
  if (!existsSync(resultPath)) {
    return null;
  }

  const content = readFileSync(resultPath, "utf-8");
  return JSON.parse(content);
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runOpencode(
  prompt: string,
  model: string,
  timeout: number
): Promise<{ output: string; error?: string }> {
  try {
    const proc = Bun.spawn(["opencode", "run", "--model", model, prompt], {
      env: { ...process.env, OPENCODE_MODEL: model },
      stdout: "pipe",
      stderr: "pipe"
    });

    let killed = false;
    const timeoutPromise = new Promise<{ output: string; error: string }>((_, reject) => {
      setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.exited) proc.kill("SIGKILL");
        }, 5000);
        reject({ output: "", error: "Timeout" });
      }, timeout);
    });

    const outputPromise = (async (): Promise<{ output: string; error?: string }> => {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      
      if (killed) {
        return { output: "", error: "Timeout" };
      }
      
      const hasError = stderr.includes("Error:") || stderr.includes("error:") || exitCode !== 0;
      if (!hasError) {
        return { output: stdout, error: undefined };
      } else {
        return { output: stdout, error: stderr || `Exit code: ${exitCode}` };
      }
    })();

    return await Promise.race([outputPromise, timeoutPromise]);
  } catch (e: any) {
    return { output: "", error: e.message || String(e) };
  }
}

export interface ArgsResult {
  model?: string;
  testCase?: string;
  timeout?: number;
}

export function parseArgs(args: string[]): ArgsResult {
  const result: ArgsResult = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-m" || args[i] === "--model") {
      result.model = args[i + 1];
      i++;
    } else if (args[i] === "-t" || args[i] === "--test") {
      result.testCase = args[i + 1];
      i++;
    } else if (args[i] === "-o" || args[i] === "--timeout") {
      result.timeout = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return result;
}

export async function checkOpencodeCli(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "opencode"], { stdout: "pipe" });
    const output = await new Response(proc.stdout).text();
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

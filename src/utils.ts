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
  try {
    const parsed = JSON.parse(content);
    if (isRunSummary(parsed)) {
      return parsed;
    } else {
      console.error(`❌ Invalid result format in ${resultPath}`);
      return null;
    }
  } catch (e) {
    console.error(`❌ Failed to parse ${resultPath}:`, e);
    return null;
  }
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
  // Validate model name to prevent command injection
  if (!validateModelName(model)) {
    return { output: "", error: `Invalid model name: ${model}` };
  }

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

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Normalize code string for fuzzy comparison
 */
export function normalizeCode(code: string): string {
  return code
    .replace(/\s+/g, " ")
    .replace(/\s*([(){}:,])\s*/g, "$1")
    .trim()
    .toLowerCase();
}

/**
 * Validate model name to prevent command injection
 */
export function validateModelName(model: string): boolean {
  // Allow alphanumeric, slashes, colons, hyphens, underscores, dots
  // This is a basic validation - adjust pattern based on your model naming conventions
  const pattern = /^[a-zA-Z0-9_\-\.\/:]+$/;
  return pattern.test(model) && model.length > 0 && model.length <= 100;
}

/**
 * Type guard for BenchmarkResult
 */
export function isBenchmarkResult(obj: any): obj is import("./types.ts").BenchmarkResult {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.testCase === "string" &&
    typeof obj.model === "string" &&
    typeof obj.latencyMs === "number" &&
    typeof obj.correct === "boolean" &&
    typeof obj.score === "number" &&
    typeof obj.output === "string" &&
    typeof obj.expected === "string" &&
    (obj.error === undefined || typeof obj.error === "string")
  );
}

/**
 * Type guard for RunSummary
 */
export function isRunSummary(obj: any): obj is import("./types.ts").RunSummary {
  if (!obj || typeof obj !== "object") return false;
  return (
    typeof obj.runId === "string" &&
    typeof obj.timestamp === "string" &&
    typeof obj.totalTests === "number" &&
    typeof obj.passed === "number" &&
    typeof obj.failed === "number" &&
    Array.isArray(obj.results) &&
    obj.results.every(isBenchmarkResult) &&
    Array.isArray(obj.modelStats)
  );
}

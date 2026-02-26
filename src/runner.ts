import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import type { BenchmarkConfig, BenchmarkResult, RunSummary, ModelStats } from "./types.ts";

const SOLUTIONS_DIR = resolve("./solutions");
const RESULTS_DIR = resolve("./results");

function ensureDir(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function sanitizeModelName(model: string): string {
  return model
    .replace(/[^a-zA-Z0-9]/g, (match) => {
      if (match === "/" || match === ":" || match === "-") return "-";
      if (match === ".") return "-";
      return "_";
    })
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function generateRunId(): string {
  return `run_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

async function runOpencode(prompt: string, model: string, timeout: number): Promise<{ output: string; error?: string }> {
  try {
    const env: Record<string, string> = {};
    for (const key in process.env) {
      const val = process.env[key];
      if (val !== undefined) env[key] = val;
    }
    if (model) {
      env.OPENCODE_MODEL = model;
    }

    const proc = Bun.spawn(["opencode", "run", "--model", model, prompt], {
      env,
      stdout: "pipe",
      stderr: "pipe"
    });

    const timeoutPromise = new Promise<{ output: string; error: string }>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject({ output: "", error: "Timeout" });
      }, timeout);
    });

    const outputPromise = (async () => {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      if (exitCode === 0) {
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

export async function runBenchmark(config: BenchmarkConfig, singleModel?: string): Promise<RunSummary> {
  const runId = singleModel ? sanitizeModelName(singleModel) : generateRunId();
  const timestamp = new Date().toISOString();
  const results: BenchmarkResult[] = [];
  const modelResults: Map<string, BenchmarkResult[]> = new Map();

  ensureDir(SOLUTIONS_DIR);
  ensureDir(RESULTS_DIR);

  const modelsToRun = singleModel ? [singleModel] : [];

  console.log(`\n🚀 Starting benchmark run: ${runId}`);
  console.log(`📋 Models: ${modelsToRun.length}`);
  console.log(`🧪 Test cases: ${config.testCases.length}`);
  console.log(`⏱️  Timeout: ${config.timeout}ms\n`);

  for (const model of modelsToRun) {
    console.log(`\n🤖 Testing model: ${model}`);
    
    for (const testCase of config.testCases) {
      const startTime = Date.now();
      let output = "";
      let error: string | undefined;

      try {
        const result = await runOpencode(testCase.prompt, model, config.timeout);
        output = result.output;
        error = result.error;
      } catch (e: any) {
        error = e.message || String(e);
      }

      const latencyMs = Date.now() - startTime;

      const resultEntry: BenchmarkResult = {
        timestamp,
        model,
        testCase: testCase.id,
        latencyMs,
        correct: false,
        score: 0,
        output: output.slice(0, 5000),
        expected: testCase.expected,
        error,
      };

      results.push(resultEntry);

      if (!modelResults.has(model)) {
        modelResults.set(model, []);
      }
      modelResults.get(model)!.push(resultEntry);

      console.log(`  ⚡ ${testCase.id}: ${latencyMs}ms`);

      const solutionPath = join(SOLUTIONS_DIR, sanitizeModelName(model));
      ensureDir(solutionPath);
      const solutionFile = join(solutionPath, `${testCase.id}.txt`);
      writeFileSync(solutionFile, output);
    }
  }

  const modelStats: ModelStats[] = [];
  let passed = 0;
  let failed = 0;

  for (const [model, modelRes] of modelResults) {
    const total = modelRes.length;
    const passedCount = modelRes.filter(r => r.correct).length;
    const avgLatency = modelRes.reduce((sum, r) => sum + r.latencyMs, 0) / total;
    
    passed += passedCount;
    failed += total - passedCount;

    modelStats.push({
      model,
      totalTests: total,
      passed: passedCount,
      failed: total - passedCount,
      avgLatencyMs: Math.round(avgLatency),
      accuracy: Math.round((passedCount / total) * 100)
    });
  }

  const summary: RunSummary = {
    runId,
    timestamp,
    totalTests: results.length,
    passed,
    failed,
    results,
    modelStats
  };

  const resultsFile = join(RESULTS_DIR, `${runId}.json`);
  writeFileSync(resultsFile, JSON.stringify(summary, null, 2));

  console.log(`\n📊 Results saved to: ${resultsFile}`);
  console.log(`\n📈 Summary:`);
  console.log(`   Total: ${results.length}`);
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`\n💡 Run verification separately: bun run src/verify.ts`);

  return summary;
}

import { writeFileSync, readFileSync } from "fs";
import { resolve, join } from "path";
import type { BenchmarkConfig, BenchmarkResult, RunSummary, ModelStats } from "./types.ts";
import { ensureDir, sanitizeModelName, generateRunId, loadExistingResults, runOpencode, SOLUTIONS_DIR, RESULTS_DIR } from "./utils.ts";

export { sanitizeModelName, loadExistingResults };

export function mergeResults(existing: RunSummary, newResults: BenchmarkResult[]): RunSummary {
  const resultsMap = new Map<string, BenchmarkResult>();
  
  for (const r of existing.results) {
    resultsMap.set(r.testCase, r);
  }
  
  for (const r of newResults) {
    resultsMap.set(r.testCase, r);
  }
  
  const mergedResults = Array.from(resultsMap.values());
  
  const passed = mergedResults.filter(r => r.correct).length;
  const failed = mergedResults.length - passed;
  
  const avgLatency = mergedResults.reduce((sum, r) => sum + r.latencyMs, 0) / mergedResults.length;
  
  const modelStats: ModelStats[] = [{
    model: existing.modelStats[0]?.model || newResults[0]?.model || "",
    totalTests: mergedResults.length,
    passed,
    failed,
    avgLatencyMs: Math.round(avgLatency),
    accuracy: Math.round((passed / mergedResults.length) * 100)
  }];

  return {
    ...existing,
    totalTests: mergedResults.length,
    passed,
    failed,
    results: mergedResults,
    modelStats
  };
}

export async function runBenchmark(
  config: BenchmarkConfig,
  singleModel?: string,
  singleTestCase?: string,
  existingResults?: RunSummary | null
): Promise<RunSummary> {
  const sanitizedModel = singleModel ? sanitizeModelName(singleModel) : generateRunId();
  const timestamp = new Date().toISOString();
  const results: BenchmarkResult[] = existingResults ? [...existingResults.results] : [];
  const modelResults: Map<string, BenchmarkResult[]> = new Map();
  
  let testCasesToRun = config.testCases;
  if (singleTestCase) {
    testCasesToRun = config.testCases.filter(tc => tc.id === singleTestCase);
    if (testCasesToRun.length === 0) {
      console.error(`❌ Test case not found: ${singleTestCase}`);
      console.log(`📋 Available test cases: ${config.testCases.map(tc => tc.id).join(", ")}`);
      process.exit(1);
    }
  }

  ensureDir(SOLUTIONS_DIR);
  ensureDir(RESULTS_DIR);

  const modelsToRun = singleModel ? [singleModel] : [];

  console.log(`\n🚀 Starting benchmark run: ${sanitizedModel}`);
  console.log(`📋 Models: ${modelsToRun.length}`);
  console.log(`🧪 Test cases: ${testCasesToRun.length}${singleTestCase ? ` (filtered: ${singleTestCase})` : ""}`);
  console.log(`⏱️  Timeout: ${config.timeout}ms\n`);

  for (const model of modelsToRun) {
    console.log(`\n🤖 Testing model: ${model}`);
    
    for (const testCase of testCasesToRun) {
      const existingIndex = results.findIndex(r => r.testCase === testCase.id && r.model === model);
      if (existingIndex !== -1) {
        results.splice(existingIndex, 1);
      }
      
      const startTime = Date.now();
      let output = "";
      let error: string | undefined;

      try {
        const result = await runOpencode(testCase.prompt, model, config.timeout);
        output = result.output;
        error = result.error;
        
        if (error && (error.includes("Model not found") || error.includes("ModelNotFoundError") || error.includes("ProviderModelNotFoundError"))) {
          console.error(`\n❌ Error: Invalid model '${model}' - ${error.split('\n')[0]}`);
          process.exit(1);
        }
      } catch (e: any) {
        error = e.stack || e.message || String(e);
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
    runId: sanitizedModel,
    timestamp,
    totalTests: results.length,
    passed,
    failed,
    results,
    modelStats
  };

  const resultsFile = join(RESULTS_DIR, `${sanitizedModel}.json`);
  writeFileSync(resultsFile, JSON.stringify(summary, null, 2));

  console.log(`\n📊 Results saved to: ${resultsFile}`);
  console.log(`\n📈 Summary:`);
  console.log(`   Total: ${results.length}`);
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`\n💡 Run verification separately: bun run src/verify.ts`);

  return summary;
}

import { parseArgs, checkOpencodeCli, runOpencode, ensureDir, sanitizeModelName, loadExistingResults, mergeResults, SOLUTIONS_DIR, RESULTS_DIR } from "./utils.ts";
import { loadConfig } from "./config.ts";
import { join } from "path";
import { existsSync, writeFileSync } from "fs";
import type { BenchmarkResult, RunSummary } from "./types.ts";

async function main() {
  console.log("=".repeat(50));
  console.log("🎯 Opencode Answer Runner");
  console.log("=".repeat(50));

  const args = parseArgs(process.argv.slice(2));
  
  if (!args.model) {
    console.error("\n❌ Error: Model is required. Use -m flag:");
    console.error("   bun run answer -m \"opencode/minimax-m2.5-free\"");
    console.error("   bun run answer -m \"opencode/minimax-m2.5-free\" -t EXTRACT-FAST-kuleba");
    process.exit(1);
  }

  const hasOpencode = await checkOpencodeCli();
  if (!hasOpencode) {
    console.error("\n❌ Error: opencode CLI not found in PATH");
    console.error("   Please install opencode first: https://opencode.ai");
    process.exit(1);
  }

  const config = loadConfig();
  let testCaseId = args.testCase;

  let testCases = config.testCases;

  if (testCaseId) {
    const testCase = config.testCases.find(tc => tc.id === testCaseId);
    if (!testCase) {
      console.error(`\n❌ Error: Test case not found: ${testCaseId}`);
      console.log(`📋 Available test cases: ${config.testCases.map(tc => tc.id).join(", ")}`);
      process.exit(1);
    }
    testCases = [testCase];
  } else {
    console.log(`\n📋 Running all ${testCases.length} test cases`);
  }

  console.log(`\n🎯 Running model: ${args.model}`);
  console.log("-".repeat(50));

  const timeout = args.timeout || config.timeout || 300000;

  for (const testCase of testCases) {
    const testCaseId = testCase.id;
    const promptPath = `./prompts/${testCaseId}.txt`;
    let prompt: string;
    try {
      prompt = await Bun.file(promptPath).text();
    } catch {
      prompt = testCase.prompt || "";
    }

    if (!prompt) {
      console.error(`\n❌ Error: No prompt found for test case: ${testCaseId}`);
      continue;
    }

    console.log(`\n📝 Test case: ${testCaseId}`);
    console.log("-".repeat(50));

    const result = await runOpencode(prompt, args.model, timeout);

    if (result.error) {
      console.error("\n❌ Error running model:");
      console.error(result.error);
      continue;
    }

    // Save to solutions folder
    const sanitizedModel = sanitizeModelName(args.model);
    const solutionDir = join(SOLUTIONS_DIR, sanitizedModel);
    const solutionPath = join(solutionDir, `${testCaseId}.txt`);
    
    ensureDir(solutionDir);
    writeFileSync(solutionPath, result.output);

    // Write result JSON with timestamp
    const timestamp = new Date().toISOString();
    const newResult: BenchmarkResult = {
      timestamp,
      model: args.model,
      testCase: testCaseId,
      latencyMs: result.latencyMs || 0,
      correct: false,
      score: 0,
      output: result.output,
      expected: testCase.expected,
      error: result.error,
    };

    const existingResults = loadExistingResults(args.model);
    let summary: RunSummary;

    if (existingResults) {
      summary = mergeResults(existingResults, [newResult]);
    } else {
      const avgLatency = newResult.latencyMs;
      summary = {
        runId: sanitizedModel,
        timestamp,
        totalTests: 1,
        passed: 0,
        failed: 1,
        results: [newResult],
        modelStats: [{
          model: args.model,
          totalTests: 1,
          passed: 0,
          failed: 1,
          avgLatencyMs: Math.round(avgLatency),
          accuracy: 0
        }]
      };
    }

    ensureDir(RESULTS_DIR);
    const resultPath = join(RESULTS_DIR, `${sanitizedModel}.json`);
    writeFileSync(resultPath, JSON.stringify(summary, null, 2));
    
    console.log(`\n💾 Saved solution to: ${solutionPath} (${result.latencyMs}ms)`);
    console.log(`📊 Results saved to: ${resultPath}`);

    console.log("\n✅ Answer:");
    console.log("-".repeat(50));
    console.log(result.output);
    console.log("\n" + "=".repeat(50));
  }

  process.exit(0);
}

main().catch(console.error);

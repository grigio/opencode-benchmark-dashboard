import { loadConfig } from "./config.ts";
import { runBenchmark, loadExistingResults } from "./runner.ts";
import { parseArgs, checkOpencodeCli } from "./utils.ts";

async function main() {
  console.log("=".repeat(50));
  console.log("🧪 Opencode Benchmark Runner");
  console.log("=".repeat(50));

  const args = parseArgs(process.argv.slice(2));
  
  if (!args.model) {
    console.error("\n❌ Error: Model is required. Use -m flag:");
    console.error("   bun run src/index.ts -m \"opencode/minimax-m2.5-free\"");
    console.error("   bun run src/index.ts -m \"opencode/minimax-m2.5-free\" -t EXTRACT-FAST-kuleba");
    process.exit(1);
  }

  const hasOpencode = await checkOpencodeCli();
  if (!hasOpencode) {
    console.error("\n❌ Error: opencode CLI not found in PATH");
    console.error("   Please install opencode first: https://opencode.ai");
    process.exit(1);
  }

  const config = loadConfig();

  if (args.testCase) {
    const found = config.testCases.find(tc => tc.id === args.testCase);
    if (!found) {
      console.error(`\n❌ Error: Test case not found: ${args.testCase}`);
      console.log(`📋 Available test cases: ${config.testCases.map(tc => tc.id).join(", ")}`);
      process.exit(1);
    }
  }

  console.log(`\n🎯 Running model: ${args.model}${args.testCase ? ` (single test: ${args.testCase})` : ""}`);
  
  const existingResults = loadExistingResults(args.model);
  if (existingResults) {
    console.log(`📂 Found existing results with ${existingResults.totalTests} test cases`);
  }
  
  await runBenchmark(config, args.model, args.testCase, existingResults);

  console.log("\n✨ Benchmark complete!");
  console.log("💻 To start dashboard: bun run src/dashboard.ts");
  
  process.exit(0);
}

main().catch(console.error);

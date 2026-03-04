import { parseArgs, checkOpencodeCli, loadExistingResults } from "./utils.ts";

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

  const existingResults = loadExistingResults(args.model);
  if (existingResults) {
    console.log(`📂 Found existing results with ${existingResults.totalTests} test cases`);
  }

  const child = Bun.spawn(["bun", "run", "src/answer.ts", "-m", args.model, ...(args.testCase ? ["-t", args.testCase] : [])], {
    stdio: ["inherit", "inherit", "inherit"]
  });

  await child.exited;

  console.log("\n✨ Benchmark complete!");
  console.log("💻 To verify results: bun run src/evaluate.ts -m \"" + args.model + "\"");
  console.log("💻 To start dashboard: bun run src/dashboard.ts");
  
  process.exit(0);
}

main().catch(console.error);

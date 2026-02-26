import { loadConfig } from "./config.ts";
import { runBenchmark } from "./runner.ts";

function parseArgs(): { model?: string } {
  const args = process.argv.slice(2);
  const result: { model?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-m" || args[i] === "--model") {
      result.model = args[i + 1];
      break;
    }
  }

  return result;
}

async function main() {
  console.log("=".repeat(50));
  console.log("🧪 Opencode Benchmark Runner");
  console.log("=".repeat(50));

  const args = parseArgs();
  
  if (!args.model) {
    console.error("\n❌ Error: Model is required. Use -m flag:");
    console.error("   bun run src/index.ts -m \"opencode/minimax-m2.5-free\"");
    process.exit(1);
  }

  const config = loadConfig();

  console.log(`\n🎯 Running single model: ${args.model}`);
  await runBenchmark(config, args.model);

  console.log("\n✨ Benchmark complete!");
  console.log("💻 To start dashboard: bun run src/dashboard.ts");
  
  process.exit(0);
}

main().catch(console.error);

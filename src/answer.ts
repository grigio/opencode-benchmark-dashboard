import { parseArgs, checkOpencodeCli, runOpencode } from "./utils.ts";
import { loadConfig } from "./config.ts";

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

  if (!testCaseId) {
    console.error("\n❌ Error: Test case is required. Use -t flag:");
    console.error("   bun run answer -m \"opencode/minimax-m2.5-free\" -t EXTRACT-FAST-kuleba");
    console.log(`\n📋 Available test cases: ${config.testCases.map(tc => tc.id).join(", ")}`);
    process.exit(1);
  }

  const testCase = config.testCases.find(tc => tc.id === testCaseId);
  if (!testCase) {
    console.error(`\n❌ Error: Test case not found: ${testCaseId}`);
    console.log(`📋 Available test cases: ${config.testCases.map(tc => tc.id).join(", ")}`);
    process.exit(1);
  }

  const promptPath = `./prompts/${testCaseId}.txt`;
  let prompt: string;
  try {
    prompt = await Bun.file(promptPath).text();
  } catch {
    prompt = testCase.prompt || "";
  }

  if (!prompt) {
    console.error(`\n❌ Error: No prompt found for test case: ${testCaseId}`);
    process.exit(1);
  }

  console.log(`\n🎯 Running model: ${args.model}`);
  console.log(`📝 Test case: ${testCaseId}`);
  console.log("-".repeat(50));

  const timeout = args.timeout || config.timeout || 300000;
  
  const result = await runOpencode(prompt, args.model, timeout);

  if (result.error) {
    console.error("\n❌ Error running model:");
    console.error(result.error);
    process.exit(1);
  }

  console.log("\n✅ Answer:");
  console.log("-".repeat(50));
  console.log(result.output);
  
  process.exit(0);
}

main().catch(console.error);

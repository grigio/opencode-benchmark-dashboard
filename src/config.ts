import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, join, basename } from "path";
import type { BenchmarkConfig, TestCase } from "./types.ts";

const PROMPTS_DIR = resolve("./prompts");
const ANSWERS_DIR = resolve("./prompts-answers");

interface RawBenchmarkConfig {
  timeout?: number;
  evaluatorModel?: string;
  verification?: {
    caseSensitive?: boolean;
  };
}

function loadTestCasesFromFiles(): TestCase[] {
  if (!existsSync(PROMPTS_DIR)) {
    console.warn(`Prompts directory not found: ${PROMPTS_DIR}`);
    return [];
  }

  const promptFiles = readdirSync(PROMPTS_DIR).filter(f => f.endsWith(".txt"));
  const testCases: TestCase[] = [];

  for (const file of promptFiles) {
    const id = basename(file, ".txt");
    const promptPath = join(PROMPTS_DIR, file);
    const answerPath = join(ANSWERS_DIR, file);

    const prompt = readFileSync(promptPath, "utf-8").trim();
    const expected = existsSync(answerPath) 
      ? readFileSync(answerPath, "utf-8").trim() 
      : "";

    testCases.push({
      id,
      prompt,
      expected,
      language: "python"
    });
  }

  return testCases;
}

export function loadConfig(configPath?: string): BenchmarkConfig {
  const path = configPath || resolve("./config/benchmark.json");
  
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }

  let jsonConfig: RawBenchmarkConfig;
  try {
    const content = readFileSync(path, "utf-8");
    jsonConfig = JSON.parse(content);
  } catch (e: any) {
    throw new Error(`Failed to parse config file ${path}: ${e.message}`);
  }

  if (!jsonConfig.timeout || typeof jsonConfig.timeout !== "number") {
    jsonConfig.timeout = 300000;
    console.warn("⚠️  Config missing timeout, using default: 300000ms");
  }

  const testCases = loadTestCasesFromFiles();

  return {
    timeout: jsonConfig.timeout!,
    evaluatorModel: jsonConfig.evaluatorModel,
    verification: jsonConfig.verification ?? { caseSensitive: false },
    testCases
  };
}

import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, join, basename } from "path";
import type { BenchmarkConfig, TestCase } from "./types.ts";

const PROMPTS_DIR = resolve("./prompts");
const ANSWERS_DIR = resolve("./prompts-answers");

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
  const content = readFileSync(path, "utf-8");
  const jsonConfig = JSON.parse(content);

  const testCases = loadTestCasesFromFiles();

  return {
    ...jsonConfig,
    testCases
  };
}

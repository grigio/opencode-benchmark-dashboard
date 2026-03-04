import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { resolve, join } from "path";
import type { BenchmarkConfig, BenchmarkResult, RunSummary } from "./types.ts";
import { loadConfig } from "./config.ts";
import { sanitizeModelName, ensureDir, parseArgs, checkOpencodeCli, RESULTS_DIR, SOLUTIONS_DIR, levenshteinDistance, normalizeCode, isRunSummary } from "./utils.ts";

export interface EvaluationResult {
  correct: boolean;
  score: number;
  method: string;
  details: string;
}

export function evaluate(
  output: string,
  expected: string,
  method: "exact" | "contains" | "fuzzy" = "contains",
  caseSensitive: boolean = false
): EvaluationResult {
  const normalizedOutput = caseSensitive ? output : output.toLowerCase();
  const normalizedExpected = caseSensitive ? expected : expected.toLowerCase();

  switch (method) {
    case "exact":
      const exactMatch = normalizedOutput.trim() === normalizedExpected.trim();
      return {
        correct: exactMatch,
        score: exactMatch ? 1.0 : 0.0,
        method: "exact",
        details: exactMatch ? "Exact match" : "No exact match"
      };

    case "contains":
      const containsExpected = normalizedOutput.includes(normalizedExpected);
      return {
        correct: containsExpected,
        score: containsExpected ? 1.0 : 0.0,
        method: "contains",
        details: containsExpected ? "Output contains expected" : "Expected not found in output"
      };

    case "fuzzy":
      const normOut = normalizeCode(output);
      const normExp = normalizeCode(expected);
      const distance = levenshteinDistance(normOut, normExp);
      const maxLen = Math.max(normOut.length, normExp.length);
      const similarity = maxLen > 0 ? 1 - distance / maxLen : 1.0;
      const threshold = 0.7;
      return {
        correct: similarity >= threshold,
        score: similarity,
        method: "fuzzy",
        details: `Similarity: ${(similarity * 100).toFixed(1)}% (threshold: ${threshold * 100}%)`
      };

    default:
      return {
        correct: false,
        score: 0.0,
        method: "unknown",
        details: "Unknown evaluation method"
      };
  }
}

export const verify = evaluate;
export { getDefaultEvaluation as getDefaultVerification };

export function getDefaultEvaluation(config: BenchmarkConfig) {
  return {
    caseSensitive: config.verification?.caseSensitive ?? false
  };
}

function getLatestResultFile(): string | null {
  const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) return null;
  
  const sorted = files.sort((a, b) => {
    const statA = statSync(join(RESULTS_DIR, a));
    const statB = statSync(join(RESULTS_DIR, b));
    return statB.mtimeMs - statA.mtimeMs;
  });
  
  return sorted[0]?.replace('.json', '') || null;
}

function parseArgsWithEvaluator(): { model: string; testCase?: string; evaluator?: string } {
  const args = process.argv.slice(2);
  let model: string | undefined;
  let testCase: string | undefined;
  let evaluator: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-m" || args[i] === "--model") {
      model = args[i + 1];
      i++;
    } else if (args[i] === "-t" || args[i] === "--test") {
      testCase = args[i + 1];
      i++;
    } else if (args[i] === "-e" || args[i] === "--evaluator") {
      evaluator = args[i + 1];
      i++;
    }
  }

  const config = loadConfig();

  if (!model) {
    model = getLatestResultFile() || undefined;
    if (!model) {
      console.error("\n❌ Error: No results found. Run benchmark first or specify -m flag:");
      console.error("   bun run src/evaluate.ts -m \"opencode-minimax-m2-5-free\"");
      console.error("   bun run src/evaluate.ts -m \"opencode-minimax-m2-5-free\" -t EXTRACT-FAST-kuleba");
      process.exit(1);
    }
    console.log(`📂 Auto-detected latest result: ${model}`);
  }

  if (testCase) {
    console.log(`🎯 Evaluating single test case: ${testCase}`);
  }

  return { model, testCase, evaluator };
}

function loadResult(model: string): RunSummary | null {
  const sanitized = sanitizeModelName(model);
  const resultPath = join(RESULTS_DIR, `${sanitized}.json`);
  
  if (!existsSync(resultPath)) {
    console.log(`📂 Results file not found, trying solutions folder...`);
    return loadResultFromSolutions(model, sanitized);
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

function loadResultFromSolutions(model: string, sanitized: string): RunSummary | null {
  const solutionDir = join(SOLUTIONS_DIR, sanitized);
  
  if (!existsSync(solutionDir)) {
    console.error(`❌ Solutions folder not found: ${solutionDir}`);
    return null;
  }

  const files = readdirSync(solutionDir).filter(f => f.endsWith('.txt'));
  if (files.length === 0) {
    console.error(`❌ No solution files found in ${solutionDir}`);
    return null;
  }

  const config = loadConfig();
  const results: BenchmarkResult[] = [];

  for (const file of files) {
    const testCase = file.replace('.txt', '');
    const testCaseConfig = config.testCases.find(tc => tc.id === testCase);
    const expected = testCaseConfig?.expected || "";
    const output = readFileSync(join(solutionDir, file), "utf-8").trim();
    
    results.push({
      timestamp: new Date().toISOString(),
      model,
      testCase,
      latencyMs: 0,
      correct: false,
      score: 0,
      output,
      expected
    });
  }

  console.log(`📋 Loaded ${results.length} solutions from ${solutionDir}`);

  return {
    runId: sanitized,
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passed: 0,
    failed: results.length,
    results,
    modelStats: []
  };
}

function saveResult(result: RunSummary, model: string) {
  const sanitized = sanitizeModelName(model);
  const resultPath = join(RESULTS_DIR, `${sanitized}.json`);
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(`💾 Saved results to: ${resultPath}`);
}

function loadPrompt(testCase: string): string | null {
  const promptPath = join(PROMPTS_DIR, `${testCase}.txt`);
  
  if (!existsSync(promptPath)) {
    console.warn(`⚠️  Prompt not found: ${promptPath}`);
    return null;
  }

  return readFileSync(promptPath, "utf-8").trim();
}

function parseFallbackJson(jsonStr: string): {
  correct: boolean;
  score: number;
  reasoning: string;
} | null {
  const correctMatch = jsonStr.match(/"correct"\s*:\s*(true|false)/i);
  const scoreMatch = jsonStr.match(/"score"\s*:\s*([0-9.]+)/);
  const reasoningMatch = jsonStr.match(/"reasoning"\s*:\s*(.+?)(?:,\s*\}|\s*\})/);

  if (correctMatch && scoreMatch) {
    return {
      correct: correctMatch[1].toLowerCase() === "true",
      score: Math.min(1, Math.max(0, parseFloat(scoreMatch[1]) || 0)),
      reasoning: reasoningMatch ? reasoningMatch[1].replace(/["']/g, "").trim() : "",
    };
  }
  return null;
}

function buildVerificationPrompt(
  testCase: string,
  prompt: string,
  expected: string,
  output: string
): string {
  return `You are a correctness judge. Evaluate if the model output correctly answers the task.

## Task Prompt:
${prompt}

## Expected Output:
${expected}

## Actual Model Output:
${output}

## Your Task:
Analyze if the actual output satisfies the task requirements. Consider:
- Semantic correctness (does it answer what was asked?)
- Partial matches (did they get the key information right even if format differs?)
- Edge cases (is the answer technically correct even if phrased differently?)

Respond with a JSON object in this exact format:
{
  "correct": true or false,
  "score": a number between 0 and 1 (1 = perfectly correct, 0.5 = partially correct, 0 = incorrect),
  "reasoning": "2-3 sentence explanation of why this is correct or incorrect"
}

Respond ONLY with the JSON, no other text.`;
}

const PROMPTS_DIR = resolve("./prompts");

async function callLLM(prompt: string, model: string, timeout: number = 120000): Promise<{
  correct: boolean;
  score: number;
  reasoning: string;
} | null> {
  try {
    const proc = Bun.spawn(["opencode", "run", "--model", model, prompt], {
      env: { ...process.env, OPENCODE_MODEL: model },
      stdout: "pipe",
      stderr: "pipe",
    });

    let killed = false;
    const timeoutPromise = new Promise<null>((_, reject) => {
      setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.exited) proc.kill("SIGKILL");
        }, 5000);
        reject(new Error("Timeout"));
      }, timeout);
    });

    const outputPromise = (async () => {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      
      if (killed) {
        throw new Error("Timeout");
      }
      
      const hasError = stderr.includes("Error:") || stderr.includes("error:") || exitCode !== 0;
      if (!hasError) {
        return stdout;
      } else {
        throw new Error(stderr || `Exit code: ${exitCode}`);
      }
    })();

    const output = await Promise.race([outputPromise, timeoutPromise]);
    
    if (!output) {
      console.error("❌ No output received from LLM");
      return null;
    }
    
    const textToParse = output.trim();
    
    const jsonMatch = textToParse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          correct: Boolean(parsed.correct),
          score: Math.min(1, Math.max(0, Number(parsed.score) || 0)),
          reasoning: String(parsed.reasoning || ""),
        };
      } catch {
        const fallback = parseFallbackJson(jsonMatch[0]);
        if (fallback) return fallback;
        console.error("❌ JSON parse error:", jsonMatch[0].slice(0, 200));
      }
    }
    
    const lines = textToParse.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          return {
            correct: Boolean(parsed.correct),
            score: Math.min(1, Math.max(0, Number(parsed.score) || 0)),
            reasoning: String(parsed.reasoning || ""),
          };
        } catch {
          const fallback = parseFallbackJson(trimmed);
          if (fallback) return fallback;
          continue;
        }
      }
    }
    
    const lowerResponse = textToParse.toLowerCase();
    const trimmedResponse = textToParse.trim();
    
    const isPositive = lowerResponse.includes("correct") && !lowerResponse.includes("incorrect");
    const hasGoodScore = lowerResponse.includes("1") || lowerResponse.includes("100%") || lowerResponse.includes("perfect") || lowerResponse.includes("giusto") || lowerResponse.includes("corretto");
    
    if (isPositive || hasGoodScore) {
      return {
        correct: true,
        score: 0.8,
        reasoning: textToParse.slice(0, 200)
      };
    }
    
    const hasBadScore = lowerResponse.includes("0") || lowerResponse.includes("incorrect") || lowerResponse.includes("wrong") || lowerResponse.includes("sbagliato") || lowerResponse.includes("errato");
    if (hasBadScore) {
      return {
        correct: false,
        score: 0.2,
        reasoning: textToParse.slice(0, 200)
      };
    }
    
    console.error("❌ Could not parse LLM response as JSON");
    console.error("Response:", textToParse.slice(0, 500));
    return null;
  } catch (e: any) {
    console.error("❌ LLM call failed:", e.stack || e.message || String(e));
    return null;
  }
}

async function evaluateResults(
  result: RunSummary,
  modelToVerify: string,
  evaluatorModel: string,
  singleTestCase?: string
): Promise<RunSummary> {
  let resultsToVerify = result.results;
  
  if (singleTestCase) {
    const found = result.results.find(r => r.testCase === singleTestCase);
    if (!found) {
      console.error(`❌ Test case not found in results: ${singleTestCase}`);
      console.log(`📋 Available test cases: ${result.results.map(r => r.testCase).join(", ")}`);
      process.exit(1);
    }
    resultsToVerify = [found];
    console.log(`🔍 Verifying single test case: ${singleTestCase}`);
  } else {
    console.log(`\n🔍 Verifying ${result.results.length} test cases using ${evaluatorModel}`);
  }
  console.log("=".repeat(50));

  for (let i = 0; i < resultsToVerify.length; i++) {
    const r = resultsToVerify[i];
    console.log(`\n📋 ${i + 1}/${resultsToVerify.length}: ${r.testCase}`);

    const prompt = loadPrompt(r.testCase);
    if (!prompt) {
      console.warn(`⚠️  Skipping ${r.testCase} - no prompt found`);
      r.llmVerification = {
        verifiedBy: evaluatorModel,
        timestamp: new Date().toISOString(),
        correct: false,
        score: 0,
        reasoning: "Failed: prompt not found",
      };
      continue;
    }

    const verificationPrompt = buildVerificationPrompt(
      r.testCase,
      prompt,
      r.expected,
      r.output
    );

    console.log("⏳ Calling LLM for verification...");
    const verification = await callLLM(verificationPrompt, evaluatorModel, 120000);

    if (verification) {
      r.llmVerification = {
        verifiedBy: evaluatorModel,
        timestamp: new Date().toISOString(),
        correct: verification.correct,
        score: verification.score,
        reasoning: verification.reasoning,
      };

      const status = verification.correct ? "✅" : "❌";
      console.log(`  ${status} Score: ${verification.score}`);
      console.log(`  📝 ${verification.reasoning.slice(0, 100)}...`);
    } else {
      r.llmVerification = {
        verifiedBy: evaluatorModel,
        timestamp: new Date().toISOString(),
        correct: false,
        score: 0,
        reasoning: "Failed: LLM verification call failed",
      };
      console.error(`  ❌ Verification failed`);
    }
  }

  const llmPassed = result.results.filter(
    (r) => r.llmVerification?.correct
  ).length;
  const llmTotal = result.results.filter((r) => r.llmVerification).length;

  console.log("\n" + "=".repeat(50));
  console.log(`📊 LLM Verification Summary: ${llmPassed}/${llmTotal} correct`);

  return result;
}

async function main() {
  console.log("=".repeat(50));
  console.log("🔍 LLM-Based Evaluation Runner");
  console.log("=".repeat(50));

  const { model, testCase, evaluator } = parseArgsWithEvaluator();
  const config = loadConfig();
  const evaluatorModel = evaluator || config.evaluatorModel || "opencode/minimax-m2.5-free";

  const hasOpencode = await checkOpencodeCli();
  if (!hasOpencode) {
    console.error("\n❌ Error: opencode CLI not found in PATH");
    console.error("   Please install opencode first: https://opencode.ai");
    process.exit(1);
  }

  console.log(`\n📂 Loading results for model: ${model}`);
  console.log(`🤖 Using evaluator model: ${evaluatorModel}`);

  const result = loadResult(model);
  if (!result) {
    process.exit(1);
  }

  console.log(`\n📋 Found ${result.results.length} test cases`);
  
  const evaluatedResult = await evaluateResults(result, model, evaluatorModel, testCase);
  saveResult(evaluatedResult, model);

  console.log("\n✨ Evaluation complete!");
  process.exit(0);
}

main().catch(console.error);

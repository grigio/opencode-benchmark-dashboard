import { describe, test, expect } from "bun:test";
import { verify } from "./evaluate";
import { loadConfig } from "./config";
import { mergeResults, loadExistingResults, sanitizeModelName } from "./runner";
import { parseArgs, ensureDir, generateRunId, checkOpencodeCli } from "./utils";
import { existsSync } from "fs";
import { resolve } from "path";
import { rmSync } from "fs";

describe("verify", () => {
  describe("exact method", () => {
    test("returns correct=true for exact match (case insensitive by default)", () => {
      const result = verify("hello world", "HELLO WORLD", "exact");
      expect(result.correct).toBe(true);
      expect(result.score).toBe(1.0);
    });

    test("returns correct=false for no exact match", () => {
      const result = verify("hello world", "hello", "exact");
      expect(result.correct).toBe(false);
      expect(result.score).toBe(0.0);
    });

    test("handles case sensitive option", () => {
      const result = verify("hello world", "HELLO WORLD", "exact", true);
      expect(result.correct).toBe(false);
    });
  });

  describe("contains method", () => {
    test("returns correct=true when expected is contained in output", () => {
      const result = verify("here is my answer: 42", "42", "contains");
      expect(result.correct).toBe(true);
      expect(result.score).toBe(1.0);
    });

    test("returns correct=false when expected not found", () => {
      const result = verify("hello world", "goodbye", "contains");
      expect(result.correct).toBe(false);
      expect(result.score).toBe(0.0);
    });

    test("is case insensitive by default", () => {
      const result = verify("ANSWER IS YES", "answer", "contains");
      expect(result.correct).toBe(true);
    });
  });

  describe("fuzzy method", () => {
    test("returns correct=true for high similarity (>70%)", () => {
      const result = verify("function add(a, b) { return a + b; }", "function add(a,b){return a+b;}", "fuzzy");
      expect(result.correct).toBe(true);
      expect(result.score).toBeGreaterThan(0.7);
    });

    test("returns correct=false for low similarity (<70%)", () => {
      const result = verify("hello world", "xyz123", "fuzzy");
      expect(result.correct).toBe(false);
      expect(result.score).toBeLessThan(0.7);
    });
  });
});

describe("loadConfig", () => {
  test("loads config from benchmark.json", () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config.timeout).toBe(600000);
    expect(config.verification).toBeDefined();
  });

  test("includes testCases from prompts directory", () => {
    const config = loadConfig();
    expect(config.testCases).toBeDefined();
    expect(Array.isArray(config.testCases)).toBe(true);
  });
});

describe("sanitizeModelName", () => {
  test("replaces slashes with hyphens", () => {
    expect(sanitizeModelName("opencode/model")).toBe("opencode-model");
  });

  test("replaces colons with hyphens", () => {
    expect(sanitizeModelName("model:name")).toBe("model-name");
  });

  test("replaces dots with hyphens", () => {
    expect(sanitizeModelName("model.name")).toBe("model-name");
  });

  test("replaces underscores with underscores", () => {
    expect(sanitizeModelName("model_name")).toBe("model_name");
  });

  test("removes leading/trailing hyphens", () => {
    expect(sanitizeModelName("-model-")).toBe("model");
  });

  test("collapses multiple hyphens into one", () => {
    expect(sanitizeModelName("model--name")).toBe("model-name");
  });

  test("handles complex model names", () => {
    expect(sanitizeModelName("opencode/minimax-m2.5-free")).toBe("opencode-minimax-m2-5-free");
  });
});

describe("mergeResults", () => {
  const existingResults = {
    runId: "test-model",
    timestamp: "2024-01-01T00:00:00Z",
    totalTests: 2,
    passed: 1,
    failed: 1,
    results: [
      { testCase: "test1", correct: true, latencyMs: 100, model: "test-model", timestamp: "", score: 0, output: "", expected: "" },
      { testCase: "test2", correct: false, latencyMs: 200, model: "test-model", timestamp: "", score: 0, output: "", expected: "" },
    ],
    modelStats: [{ model: "test-model", totalTests: 2, passed: 1, failed: 1, avgLatencyMs: 150, accuracy: 50 }],
  };

  const newResults = [
    { testCase: "test2", correct: true, latencyMs: 180, model: "test-model", timestamp: "", score: 0, output: "", expected: "" },
    { testCase: "test3", correct: true, latencyMs: 300, model: "test-model", timestamp: "", score: 0, output: "", expected: "" },
  ];

  test("merges results, updating existing test cases", () => {
    const merged = mergeResults(existingResults, newResults);
    expect(merged.results).toHaveLength(3);
    const test2 = merged.results.find(r => r.testCase === "test2");
    expect(test2?.correct).toBe(true);
  });

  test("calculates correct totals after merge", () => {
    const merged = mergeResults(existingResults, newResults);
    expect(merged.totalTests).toBe(3);
    expect(merged.passed).toBe(3);
    expect(merged.failed).toBe(0);
  });

  test("calculates average latency correctly", () => {
    const merged = mergeResults(existingResults, newResults);
    const avgLatency = merged.modelStats[0].avgLatencyMs;
    expect(avgLatency).toBe(Math.round((100 + 180 + 300) / 3));
  });
});

describe("loadExistingResults", () => {
  test("returns null for non-existent file", () => {
    const result = loadExistingResults("non-existent-model-xyz123");
    expect(result).toBeNull();
  });
});

describe("parseArgs", () => {
  test("parses -m/--model flag", () => {
    const result = parseArgs(["-m", "test-model"]);
    expect(result.model).toBe("test-model");
  });

  test("parses --model flag with equals", () => {
    const result = parseArgs(["--model", "test-model"]);
    expect(result.model).toBe("test-model");
  });

  test("parses -t/--test flag", () => {
    const result = parseArgs(["-t", "test-case"]);
    expect(result.testCase).toBe("test-case");
  });

  test("parses -o/--timeout flag", () => {
    const result = parseArgs(["-o", "60000"]);
    expect(result.timeout).toBe(60000);
  });

  test("returns empty object for empty args", () => {
    const result = parseArgs([]);
    expect(result.model).toBeUndefined();
    expect(result.testCase).toBeUndefined();
    expect(result.timeout).toBeUndefined();
  });
});

describe("generateRunId", () => {
  test("generates run ID with expected prefix", () => {
    const id = generateRunId();
    expect(id.startsWith("run_")).toBe(true);
  });

  test("generates IDs with correct format", () => {
    const id = generateRunId();
    expect(id).toMatch(/^run_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
});

describe("ensureDir", () => {
  test("creates directory if it doesn't exist", () => {
    const testDir = resolve("./test-ensure-dir-check");
    ensureDir(testDir);
    expect(existsSync(testDir)).toBe(true);
    try { require("fs").rmSync(testDir, { force: true, recursive: true }); } catch {}
  });

  test("does not throw if directory already exists", () => {
    const testDir = resolve("./test-ensure-dir-check2");
    ensureDir(testDir);
    expect(() => ensureDir(testDir)).not.toThrow();
    try { require("fs").rmSync(testDir, { force: true, recursive: true }); } catch {}
  });
});

describe("checkOpencodeCli", () => {
  test("returns a boolean (async)", async () => {
    const result = await checkOpencodeCli();
    expect(typeof result).toBe("boolean");
  });
});

import type { BenchmarkConfig } from "./types.ts";

const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

const normalizeCode = (code: string): string => {
  return code
    .replace(/\s+/g, " ")
    .replace(/\s*([(){}:,])\s*/g, "$1")
    .trim()
    .toLowerCase();
};

export interface VerificationResult {
  correct: boolean;
  score: number;
  method: string;
  details: string;
}

export function verify(
  output: string,
  expected: string,
  method: "exact" | "contains" | "fuzzy" = "contains",
  caseSensitive: boolean = false
): VerificationResult {
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
        details: "Unknown verification method"
      };
  }
}

export function getDefaultVerification(config: BenchmarkConfig) {
  return {
    caseSensitive: config.verification?.caseSensitive ?? false
  };
}

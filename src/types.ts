export interface TestCase {
  id: string;
  prompt: string;
  expected: string;
  language?: string;
}

export interface BenchmarkConfig {
  testCases: TestCase[];
  timeout: number;
  evaluatorModel?: string;
  verification?: {
    caseSensitive?: boolean;
  };
}

export interface LLMVerification {
  verifiedBy: string;
  timestamp: string;
  correct: boolean;
  score: number;
  reasoning: string;
}

export interface BenchmarkResult {
  timestamp: string;
  model: string;
  testCase: string;
  latencyMs: number;
  correct: boolean;
  score: number;
  output: string;
  expected: string;
  error?: string;
  llmVerification?: LLMVerification;
}

export interface RunSummary {
  runId: string;
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  results: BenchmarkResult[];
  modelStats: ModelStats[];
}

export interface ModelStats {
  model: string;
  totalTests: number;
  passed: number;
  failed: number;
  avgLatencyMs: number;
  accuracy: number;
}

export interface DashboardData {
  runs: RunSummary[];
  models: string[];
  testCases: string[];
}

export interface ModelResult {
  testCase: string;
  latencyMs: number;
  correct: boolean;
  score: number;
  timestamp: string;
}

# Harness Test

Benchmark system for testing opencode with various LLM models, measuring speed (latency) and correctness (accuracy).

## Quick Start

```bash
# Install dependencies
bun install

# Run benchmark with a specific model
bun run src/index.ts -m "opencode/minimax-m2.5-free"

# Start dashboard (in another terminal)
bun run src/dashboard.ts
```

## Project Structure

```
harness-test/
├── src/
│   ├── index.ts      # Main entry point - runs benchmark
│   ├── dashboard.ts  # Web dashboard server
│   ├── runner.ts     # Benchmark execution logic
│   ├── verifier.ts   # Output verification (correctness)
│   ├── verify.ts     # LLM-based verification runner
│   ├── config.ts     # Config file loader
│   ├── utils.ts      # Shared utilities
│   ├── types.ts      # TypeScript interfaces
│   └── runner.test.ts # Tests
├── config/
│   └── benchmark.json    # Timeout & verification config
├── prompts/               # Test case prompts (one file per test)
├── prompts-answers/       # Expected answers (optional)
├── solutions/             # Full model outputs
├── results/               # JSON results per model
└── dashboard/             # Static assets (optional)
```

## Usage

### Running Benchmarks

```bash
bun run src/index.ts -m "opencode/minimax-m2.5-free"
```

Flags:
- `-m, --model`: Model to test (required)
- `-t, --test`: Run single test case (optional)
- `-o, --timeout`: Override timeout in ms (optional)

### Verification

```bash
bun run src/verify.ts -m "opencode-minimax-m2-5-free"
```

Flags:
- `-m, --model`: Model to verify (auto-detects latest if omitted)
- `-t, --test`: Verify single test case (optional)
- `-v, --verifier`: Override verifier model (optional)

Verifies results using an LLM-based verifier (model configured in `config/benchmark.json`).

### Dashboard

```bash
bun run src/dashboard.ts
```

Starts a web dashboard on port 3000 to visualize benchmark results.

## Adding Test Cases

Add prompt files to `prompts/` folder:
- Filename (without .txt) = test ID
- File content = prompt sent to model

Optional: add expected answer in `prompts-answers/{test_id}.txt`

## Configuration

Edit `config/benchmark.json`:
- `timeout`: Max time per test (ms, default: 300000)
- `verification.method`: "llm", "contains", "exact", or "fuzzy"
- `verification.verifierModel`: Model used for LLM verification

## Requirements

- [Bun](https://bun.sh/) runtime
- [opencode](https://opencode.ai) CLI installed and in PATH
- Models pre-configured in `~/.config/opencode/opencode.json`

## Testing

```bash
bun test src/runner.test.ts
```

Tests cover: verifier logic, config loading, model name sanitization, result merging, and utility functions.

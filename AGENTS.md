# Harness Test - Opencode Benchmark

## Overview

Benchmark system for testing opencode with various LLM models, measuring speed (latency) and correctness (accuracy).
Remember to update this document with non-trivial minimal dev info.

## Project Structure

```
harness-test/
├── src/
│   ├── index.ts      # Main entry point - runs benchmark
│   ├── dashboard.ts  # Web dashboard server
│   ├── runner.ts     # Benchmark execution logic
│   ├── verifier.ts   # Output verification (correctness)
│   ├── config.ts     # Config file loader
│   └── types.ts      # TypeScript interfaces
├── config/
│   └── benchmark.json    # Timeout & verification config
├── prompts/               # Test case prompts (one file per test)
│   └── {test_id}.txt
├── prompts-answers/       # Expected answers (optional)
│   └── {test_id}.txt
├── solutions/             # Full model outputs
│   └── {sanitized-model}/{test_id}.txt
├── results/               # JSON results per model
│   └── {sanitized-model}.json
└── dashboard/             # Static assets (optional)
```

## Design Choices

### 1. Verification Method: "Contains"

The default verification uses "contains" matching:
- Checks if the expected code snippet exists within the model output
- Case-insensitive by default
- More robust than exact match (handles formatting variations)

Alternative methods available:
- `exact`: Full string equality
- `fuzzy`: Levenshtein distance (70% threshold)

### 2. Timeout Handling

- Default timeout: 5 minutes (configurable in `benchmark.json`)
- Uses Bun's `spawn()` with Promise.race for timeout
- On timeout: kills process, marks as failed with error

### 3. Output Handling

- Full outputs saved to `solutions/{sanitized-model}/{test_id}.txt`
- Results JSON contains truncated output (first 5000 chars)
- Handles both stdout and stderr

### 4. Model Configuration

Models are passed via command-line argument:
```bash
bun run src/index.ts -m "opencode/minimax-m2.5-free"
```

The runner uses `OPENCODE_MODEL` environment variable to set the model.

### 5. Results Format

Results saved as `{sanitized-model}.json` in `results/`:
- Per-test results (latency, correct, score)
- Per-model stats (avg latency, accuracy)
- Timestamps for reproducibility

### 6. Dashboard

- Single-page HTML with Chart.js
- Auto-loads all results from `results/` folder
- Groups by model name
- Filter by model

## Usage

```bash
# Install dependencies
bun install

# Run benchmark with a specific model
bun run src/index.ts -m "opencode/minimax-m2.5-free"

# Verify results (model to verify via -m, verifier from benchmark.json)
bun run src/verify.ts -m "opencode-minimax-m2-5-free"

# Start dashboard (in another terminal)
bun run src/dashboard.ts
```

## Verification

- `-m` flag specifies the model to verify (results file)
- Verifier model is read from `config/benchmark.json` → `verification.verifierModel`
- The verifier model evaluates if the model output is correct using LLM-based judgment

## Adding Test Cases

Add prompt files to `prompts/` folder:
- Filename (without .txt) = test ID
- File content = prompt sent to model

Optional: add expected answer in `prompts-answers/{test_id}.txt`

## Notes

- Requires `opencode` CLI to be installed and in PATH
- Models must be pre-configured in `~/.config/opencode/opencode.json`
- Dashboard runs on port 3000 by default
- Results are append-only (no auto-cleanup)

import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import type { RunSummary, DashboardData, ModelResult, LLMVerification } from "./types.ts";

const RESULTS_DIR = resolve("./results");
const PORT = 3000;

interface ModelData {
  model: string;
  runs: RunSummary[];
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  avgLatency: number;
  accuracy: number;
  allResults: (ModelResult & { output: string; expected: string; verification?: LLMVerification })[];
}

function sanitizeModelName(model: string): string {
  return model
    .replace(/[^a-zA-Z0-9]/g, (match) => {
      if (match === "/" || match === ":" || match === "-") return "-";
      if (match === ".") return "-";
      return "_";
    })
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function loadAllRuns(): DashboardData {
  const runs: RunSummary[] = [];
  const models = new Set<string>();
  const testCases = new Set<string>();

  if (!existsSync(RESULTS_DIR)) {
    return { runs: [], models: [], testCases: [] };
  }

  const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith(".json"));
  
  for (const file of files) {
    try {
      const content = readFileSync(join(RESULTS_DIR, file), "utf-8");
      const run: RunSummary = JSON.parse(content);
      runs.push(run);
      
      for (const stat of run.modelStats) {
        models.add(stat.model);
      }
      
      for (const result of run.results) {
        testCases.add(result.testCase);
      }
    } catch (e) {
      console.error(`Error loading ${file}:`, e);
    }
  }

  runs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    runs,
    models: Array.from(models).sort(),
    testCases: Array.from(testCases).sort()
  };
}

function loadModelData(): Map<string, ModelData> {
  const modelMap = new Map<string, ModelData>();

  if (!existsSync(RESULTS_DIR)) {
    return modelMap;
  }

  const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith(".json"));
  
  for (const file of files) {
    try {
      const content = readFileSync(join(RESULTS_DIR, file), "utf-8");
      const run: RunSummary = JSON.parse(content);
      
      for (const stat of run.modelStats) {
        if (!modelMap.has(stat.model)) {
          modelMap.set(stat.model, {
            model: stat.model,
            runs: [],
            totalTests: 0,
            totalPassed: 0,
            totalFailed: 0,
            avgLatency: 0,
            accuracy: 0,
            allResults: []
          });
        }
        
        const modelData = modelMap.get(stat.model)!;
        modelData.runs.push(run);
        modelData.totalTests += stat.totalTests;
        modelData.totalPassed += stat.passed;
        modelData.totalFailed += stat.failed;
        modelData.avgLatency += stat.avgLatencyMs * stat.totalTests;
        
        for (const result of run.results) {
          if (result.model === stat.model) {
            const isCorrect = result.llmVerification ? result.llmVerification.correct : result.correct;
            const finalScore = result.llmVerification ? result.llmVerification.score : result.score;
            modelData.allResults.push({
              testCase: result.testCase,
              latencyMs: result.latencyMs,
              correct: isCorrect,
              score: finalScore,
              timestamp: result.timestamp,
              output: result.output,
              expected: result.expected,
              verification: result.llmVerification
            });
          }
        }
      }
    } catch (e) {
      console.error(`Error loading ${file}:`, e);
    }
  }

  for (const [model, data] of modelMap) {
    if (data.runs.length > 0) {
      data.avgLatency = Math.round(data.avgLatency / data.totalTests);
      const llmPassed = data.allResults.filter(r => r.correct).length;
      data.totalPassed = llmPassed;
      data.totalFailed = data.allResults.length - llmPassed;
      data.accuracy = Math.round((llmPassed / data.allResults.length) * 100);
    }
  }

  return modelMap;
}

const html = (data: DashboardData, modelData: Map<string, ModelData>) => {
  const models = Array.from(modelData.keys()).sort();
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Opencode Benchmark Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4ecd8; color: #5c4b37; padding: 20px; }
    h1 { color: #3d2e1f; margin-bottom: 20px; }
    h2 { color: #3d2e1f; margin: 30px 0 15px; }
    .container { max-width: 1400px; margin: 0 auto; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
    .stat-card { background: #faf6eb; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(92, 75, 55, 0.1); }
    .stat-card h3 { font-size: 14px; color: #7a6a56; margin-bottom: 5px; }
    .stat-card .value { font-size: 32px; font-weight: bold; color: #3d2e1f; }
    .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .chart-container { background: #faf6eb; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(92, 75, 55, 0.1); }
    .heatmap-table { width: 100%; background: #faf6eb; border-radius: 8px; box-shadow: 0 2px 4px rgba(92, 75, 55, 0.1); overflow-x: auto; }
    .heatmap-table th, .heatmap-table td { padding: 10px 12px; text-align: center; border: 1px solid #e0d5c4; }
    .heatmap-table th { background: #8b7355; color: #faf6eb; font-weight: 600; font-size: 12px; }
    .heatmap-table th.model-col { text-align: left; background: #6b5344; }
    .heatmap-table td.model-name { text-align: left; font-weight: 500; background: #faf6eb; }
    .heatmap-cell { cursor: pointer; transition: transform 0.1s; min-width: 60px; }
    .heatmap-cell:hover { transform: scale(1.05); }
    .heatmap-pass { background: #c8e6c9; color: #2e7d32; }
    .heatmap-pass-50 { background: #a5d6a7; color: #2e7d32; }
    .heatmap-pass-75 { background: #81c784; color: #1b5e20; }
    .heatmap-pass-100 { background: #4caf50; color: white; }
    .heatmap-fail { background: #ffcdd2; color: #c62828; }
    .heatmap-fail-50 { background: #ef9a9a; color: #c62828; }
    .heatmap-fail-75 { background: #e57373; color: #b71c1c; }
    .heatmap-fail-100 { background: #f44336; color: white; }
    .heatmap-empty { background: #e8e0d0; color: #9e9e9e; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-pass { background: #d4edda; color: #155724; }
    .badge-fail { background: #f8d7da; color: #721c24; }
    .filters { margin-bottom: 20px; }
    select, input { padding: 8px 12px; border: 1px solid #d4c4a8; border-radius: 4px; margin-right: 10px; background: #faf6eb; color: #5c4b37; }
    .run-info { background: #e7f3ff; padding: 10px 15px; border-radius: 4px; margin-bottom: 15px; border-left: 4px solid #4a90d9; }
    .model-card { background: #faf6eb; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(92, 75, 55, 0.1); margin-bottom: 15px; }
    .model-card h3 { color: #3d2e1f; margin-bottom: 10px; }
    .model-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
    .model-stat { text-align: center; padding: 10px; background: #f4ecd8; border-radius: 4px; }
    .model-stat-label { font-size: 12px; color: #7a6a56; }
    .model-stat-value { font-size: 20px; font-weight: bold; color: #3d2e1f; }
    .refresh-btn { padding: 8px 16px; background: #8b7355; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .refresh-btn:hover { background: #6b5344; }
    .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; }
    .modal-overlay.active { display: flex; align-items: center; justify-content: center; }
    .modal { background: white; border-radius: 8px; max-width: 700px; width: 90%; max-height: 80vh; overflow: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
    .modal-header { padding: 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
    .modal-header h3 { margin: 0; color: #333; }
    .modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #666; }
    .modal-body { padding: 20px; }
    .modal-section { margin-bottom: 20px; }
    .modal-section h4 { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 8px; }
    .modal-section pre { background: #f5f5f5; padding: 12px; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; font-size: 13px; max-height: 200px; overflow: auto; }
    .modal-section.match pre { border-left: 4px solid #28a745; }
    .modal-section.no-match pre { border-left: 4px solid #dc3545; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .badge:hover { opacity: 0.8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 Opencode Benchmark Dashboard</h1>
    
    <div class="stats">
      <div class="stat-card">
        <h3>Total Models</h3>
        <div class="value">${models.length}</div>
      </div>
      <div class="stat-card">
        <h3>Total Runs</h3>
        <div class="value">${data.runs.length}</div>
      </div>
      <div class="stat-card">
        <h3>Total Tests</h3>
        <div class="value">${data.runs.reduce((sum, r) => sum + r.totalTests, 0)}</div>
      </div>
      <div class="stat-card">
        <h3>Avg Accuracy</h3>
        <div class="value">${data.runs.length > 0 ? Math.round(data.runs.reduce((sum, r) => sum + (r.passed / r.totalTests) * 100, 0) / data.runs.length) : 0}%</div>
      </div>
    </div>

    <div class="charts">
      <div class="chart-container">
        <canvas id="latencyChart"></canvas>
      </div>
      <div class="chart-container">
        <canvas id="accuracyChart"></canvas>
      </div>
    </div>

    <h2 style="margin: 30px 0 15px;">📊 Results Heatmap</h2>
    <div class="filters">
      <select id="modelSelect">
        <option value="">All Models</option>
        ${models.map(m => `<option value="${m}">${m}</option>`).join("")}
      </select>
      <button class="refresh-btn" id="refreshBtn">Refresh</button>
    </div>
    <div class="heatmap-table">
      <table id="heatmapTable">
        <thead id="heatmapHead"></thead>
        <tbody id="heatmapBody"></tbody>
      </table>
    </div>
  </div>

  <div class="modal-overlay" id="modalOverlay">
    <div class="modal">
      <div class="modal-header">
        <h3 id="modalTitle">Result Details</h3>
        <button class="modal-close" id="modalClose">&times;</button>
      </div>
      <div class="modal-body" id="modalBody">
      </div>
    </div>
  </div>

  <script>
    const modelData = ${JSON.stringify(Object.fromEntries(modelData))};
    const models = ${JSON.stringify(models)};
    const testCases = ${JSON.stringify(data.testCases)};
    let heatmapResults = {};

    function getHeatmapClass(correct, score) {
      if (!correct) {
        if (score >= 0.75) return 'heatmap-fail-100';
        if (score >= 0.5) return 'heatmap-fail-75';
        if (score >= 0.25) return 'heatmap-fail-50';
        return 'heatmap-fail';
      } else {
        if (score >= 1) return 'heatmap-pass-100';
        if (score >= 0.75) return 'heatmap-pass-75';
        if (score >= 0.5) return 'heatmap-pass-50';
        return 'heatmap-pass';
      }
    }

    function renderHeatmap(selectedModel = null) {
      const thead = document.getElementById('heatmapHead');
      const tbody = document.getElementById('heatmapBody');
      const filteredModels = selectedModel ? [selectedModel] : models;
      
      heatmapResults = {};
      
      thead.innerHTML = '<tr><th class="model-col">Model</th>' + 
        testCases.map(tc => '<th>' + tc + '</th>').join('') + '</tr>';
      
      tbody.innerHTML = filteredModels.map(m => {
        const data = modelData[m];
        const resultsMap = {};
        data.allResults.forEach(r => {
          resultsMap[r.testCase] = r;
          heatmapResults[m + '|' + r.testCase] = r;
        });
        
        const cells = testCases.map(tc => {
          const result = resultsMap[tc];
          if (result) {
            const cls = getHeatmapClass(result.correct, result.score);
            const pct = Math.round(result.score * 100);
            return '<td class="heatmap-cell ' + cls + '" data-key="' + m + '|' + tc + '">' + pct + '%</td>';
          }
          return '<td class="heatmap-cell heatmap-empty" data-key="' + m + '|' + tc + '">-</td>';
        });
        
        return '<tr><td class="model-name">' + m + '</td>' + cells.join('') + '</tr>';
      }).join('');
    }

    function showModal(key) {
      const r = heatmapResults[key];
      if (!r) return;
      const [model, testCase] = key.split('|');
      document.getElementById('modalTitle').textContent = model + ' - ' + testCase;
      const matchClass = r.correct ? 'match' : 'no-match';
      const reasoning = r.verification ? r.verification.reasoning : '';
      document.getElementById('modalBody').innerHTML = \`
        <div class="modal-section \${matchClass}">
          <h4>Actual Output</h4>
          <pre>\${escapeHtml(r.output || '')}</pre>
        </div>
        <div class="modal-section">
          <h4>Expected Output</h4>
          <pre>\${escapeHtml(r.expected || '')}</pre>
        </div>
        \${reasoning ? \`
        <div class="modal-section">
          <h4>LLM Verification Reasoning</h4>
          <pre>\${escapeHtml(reasoning)}</pre>
        </div>
        \` : ''}
      \`;
      document.getElementById('modalOverlay').classList.add('active');
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    document.getElementById('modalClose').addEventListener('click', () => {
      document.getElementById('modalOverlay').classList.remove('active');
    });

    document.getElementById('modalOverlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('modalOverlay')) {
        document.getElementById('modalOverlay').classList.remove('active');
      }
    });

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (target.classList.contains('heatmap-cell') && target.dataset.key) {
        showModal(target.dataset.key);
      }
    });

    // Charts
    if (models.length > 0) {
      new Chart(document.getElementById('latencyChart'), {
        type: 'bar',
        data: {
          labels: models.map(m => m.split('/').pop() || m),
          datasets: [{
            label: 'Avg Latency (ms)',
            data: models.map(m => modelData[m].avgLatency),
            backgroundColor: 'rgba(139, 115, 85, 0.7)',
            borderColor: 'rgba(107, 83, 68, 1)',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          plugins: { title: { display: true, text: 'Average Latency by Model' } }
        }
      });

      new Chart(document.getElementById('accuracyChart'), {
        type: 'bar',
        data: {
          labels: models.map(m => m.split('/').pop() || m),
          datasets: [{
            label: 'Accuracy (%)',
            data: models.map(m => modelData[m].accuracy),
            backgroundColor: models.map(m => modelData[m].accuracy >= 80 ? 'rgba(76, 175, 80, 0.7)' : 'rgba(255, 193, 7, 0.7)'),
            borderColor: models.map(m => modelData[m].accuracy >= 80 ? 'rgba(76, 175, 80, 1)' : 'rgba(255, 193, 7, 1)'),
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          plugins: { title: { display: true, text: 'Accuracy by Model' } }
        }
      });
    }

    document.getElementById('modelSelect').addEventListener('change', (e) => {
      const selectedModel = e.target.value || null;
      renderHeatmap(selectedModel);
    });

    document.getElementById('refreshBtn').addEventListener('click', async () => {
      const btn = document.getElementById('refreshBtn');
      btn.textContent = 'Loading...';
      try {
        const res = await fetch('/api/refresh');
        const fresh = await res.json();
        modelData = fresh.models;
        models = Object.keys(fresh.models);
        
        const select = document.getElementById('modelSelect');
        let options = '<option value="">All Models</option>';
        for (const m of models) {
          options += '<option value="' + m + '">' + m + '</option>';
        }
        select.innerHTML = options;
        
        const selectedModel = select.value || null;
        
        document.getElementById('latencyChart').parentElement.innerHTML = '<canvas id="latencyChart"></canvas>';
        document.getElementById('accuracyChart').parentElement.innerHTML = '<canvas id="accuracyChart"></canvas>';
        
        renderHeatmap(selectedModel);
        
        if (models.length > 0) {
          new Chart(document.getElementById('latencyChart'), {
            type: 'bar',
            data: {
              labels: models.map(m => m.split('/').pop() || m),
              datasets: [{
                label: 'Avg Latency (ms)',
                data: models.map(m => modelData[m].avgLatency),
                backgroundColor: 'rgba(74, 144, 217, 0.7)',
                borderColor: 'rgba(74, 144, 217, 1)',
                borderWidth: 1
              }]
            },
            options: {
              responsive: true,
              plugins: { title: { display: true, text: 'Average Latency by Model' } }
            }
          });

          new Chart(document.getElementById('accuracyChart'), {
            type: 'bar',
            data: {
              labels: models.map(m => m.split('/').pop() || m),
              datasets: [{
                label: 'Accuracy (%)',
                data: models.map(m => modelData[m].accuracy),
                backgroundColor: models.map(m => modelData[m].accuracy >= 80 ? 'rgba(40, 167, 69, 0.7)' : 'rgba(255, 193, 7, 0.7)'),
                borderColor: models.map(m => modelData[m].accuracy >= 80 ? 'rgba(40, 167, 69, 1)' : 'rgba(255, 193, 7, 1)'),
                borderWidth: 1
              }]
            },
            options: {
              responsive: true,
              plugins: { title: { display: true, text: 'Accuracy by Model' } }
            }
          });
        }
      } catch (e) {
        console.error('Refresh failed:', e);
      }
      btn.textContent = 'Refresh';
    });

    renderHeatmap();
  </script>
</body>
</html>
`;
};

async function startDashboard() {
  const data = loadAllRuns();
  const modelData = loadModelData();
  
  const server = Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);
      
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(html(data, modelData), {
          headers: { "Content-Type": "text/html" }
        });
      }
      
      if (url.pathname === "/api/runs") {
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" }
        });
      }
      
      if (url.pathname === "/api/models") {
        return new Response(JSON.stringify(Object.fromEntries(modelData)), {
          headers: { "Content-Type": "application/json" }
        });
      }
      
      if (url.pathname === "/api/refresh") {
        const freshData = loadAllRuns();
        const freshModelData = loadModelData();
        return new Response(JSON.stringify({ runs: freshData, models: Object.fromEntries(freshModelData) }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      
      return new Response("Not Found", { status: 404 });
    }
  });

  console.log(`\n📊 Dashboard running at http://localhost:${PORT}/`);
  console.log("Press Ctrl+C to stop\n");
}

startDashboard();

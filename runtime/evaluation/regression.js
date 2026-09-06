import fs from "node:fs";
import path from "node:path";

export class RegressionTracker {
  constructor({ benchmarksDir = null } = {}) {
    const root = process.cwd();
    this.benchmarksDir = benchmarksDir || path.join(root, 'benchmarks');
    this.baselinesDir = path.join(this.benchmarksDir, 'baselines');
    this.runsDir = path.join(this.benchmarksDir, 'runs');

    this._ensureDirs();
  }

  _ensureDirs() {
    if (!fs.existsSync(this.baselinesDir)) {
      fs.mkdirSync(this.baselinesDir, { recursive: true });
    }
    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }
  }

  getBaseline(suiteName = 'baseline-v2') {
    const baselinePath = path.join(this.baselinesDir, `${suiteName}.json`);
    if (!fs.existsSync(baselinePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    } catch {
      return null;
    }
  }

  saveBaseline(suiteName, scorecardJson) {
    const baselinePath = path.join(this.baselinesDir, `${suiteName}.json`);
    fs.writeFileSync(baselinePath, JSON.stringify(scorecardJson, null, 2), 'utf8');
    return baselinePath;
  }

  saveRun(scorecardJson) {
    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const runPath = path.join(this.runsDir, filename);
    fs.writeFileSync(runPath, JSON.stringify(scorecardJson, null, 2), 'utf8');
    return runPath;
  }

  compare(currentResults, baseline) {
    if (!baseline || !Array.isArray(baseline.results)) {
      return {
        has_baseline: false,
        regressions: [],
        improvements: [],
        unchanged: currentResults.length
      };
    }

    const baselineMap = new Map();
    for (const res of baseline.results) {
      baselineMap.set(res.scenario_id, res.status);
    }

    const regressions = [];
    const improvements = [];
    let unchanged = 0;

    for (const res of currentResults) {
      const baseStatus = baselineMap.get(res.scenario_id);
      if (!baseStatus) continue;

      if (baseStatus === 'PASSED' && res.status !== 'PASSED') {
        regressions.push({
          scenario_id: res.scenario_id,
          baseline_status: baseStatus,
          current_status: res.status
        });
      } else if (baseStatus !== 'PASSED' && res.status === 'PASSED') {
        improvements.push({
          scenario_id: res.scenario_id,
          baseline_status: baseStatus,
          current_status: res.status
        });
      } else {
        unchanged++;
      }
    }

    return {
      has_baseline: true,
      baseline_run_id: baseline.run_id,
      regressions,
      improvements,
      unchanged
    };
  }
}

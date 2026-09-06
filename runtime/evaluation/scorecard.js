export class Scorecard {
  constructor({ runId, version = '1.0.0', results = [], baselineComparison = null } = {}) {
    this.runId = runId || `eval-run-${Date.now()}`;
    this.version = version;
    this.evaluatedAt = new Date().toISOString();
    this.results = results;
    this.baselineComparison = baselineComparison;
  }

  calculateMetrics() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.status === 'PASSED').length;
    const failed = this.results.filter(r => r.status === 'FAILED').length;
    const error = this.results.filter(r => r.status === 'ERROR').length;
    const passRate = total > 0 ? (passed / total) * 100 : 0;

    const categories = {};
    for (const res of this.results) {
      const cat = res.category || 'general';
      if (!categories[cat]) {
        categories[cat] = { total: 0, passed: 0, failed: 0 };
      }
      categories[cat].total++;
      if (res.status === 'PASSED') categories[cat].passed++;
      else categories[cat].failed++;
    }

    const durations = this.results.map(r => r.duration_ms || 0);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    return {
      total,
      passed,
      failed,
      error,
      pass_rate: Number(passRate.toFixed(2)),
      categories,
      avg_duration_ms: avgDuration
    };
  }

  toJSON() {
    return {
      run_id: this.runId,
      version: this.version,
      evaluated_at: this.evaluatedAt,
      metrics: this.calculateMetrics(),
      results: this.results,
      baseline_comparison: this.baselineComparison
    };
  }

  formatAscii() {
    const m = this.calculateMetrics();
    const lines = [];

    lines.push('\x1b[1m\x1b[36m=== Praetor Evaluation Scorecard ===\x1b[0m');
    lines.push(`Run ID:          ${this.runId}`);
    lines.push(`Runtime Version: ${this.version}`);
    lines.push(`Evaluated At:    ${this.evaluatedAt}`);
    lines.push('------------------------------------------------------------');

    for (const [cat, data] of Object.entries(m.categories)) {
      const rate = data.total > 0 ? ((data.passed / data.total) * 100).toFixed(1) : '0.0';
      const color = data.failed === 0 ? '\x1b[32m' : '\x1b[31m';
      lines.push(`  • ${cat.padEnd(16)}: ${color}${data.passed}/${data.total} passed (${rate}%)\x1b[0m`);
    }

    lines.push('------------------------------------------------------------');
    const summaryColor = m.failed === 0 ? '\x1b[1m\x1b[32m' : '\x1b[1m\x1b[31m';
    lines.push(`${summaryColor}TOTAL PASSED:     ${m.passed} / ${m.total} (${m.pass_rate}%)\x1b[0m`);
    lines.push(`Average Latency:  ${m.avg_duration_ms} ms`);

    if (this.baselineComparison) {
      lines.push('------------------------------------------------------------');
      const b = this.baselineComparison;
      if (b.regressions?.length > 0) {
        lines.push(`\x1b[1m\x1b[31mREGRESSIONS DETECTED: ${b.regressions.length}\x1b[0m`);
        for (const reg of b.regressions) {
          lines.push(`  - ${reg.scenario_id}: Expected ${reg.baseline_status}, got ${reg.current_status}`);
        }
      } else {
        lines.push(`\x1b[1m\x1b[32mZero Regressions against baseline (${b.unchanged} scenarios unchanged)\x1b[0m`);
      }
    }

    lines.push('============================================================');
    return lines.join('\n');
  }
}

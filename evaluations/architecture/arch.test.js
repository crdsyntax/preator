import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateArchitecture, loadArchitectureProfile, DEFAULT_ARCHITECTURE_PROFILE } from '../../runtime/core/architecture.js';
import { inferSpecialists } from '../../runtime/core/executor.js';

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  \u2714 [${name}] PASS`);
  } catch (err) {
    console.error(`  \u2718 [${name}] FAIL: ${err.message}`);
    throw err;
  }
}

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-arch-'));
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

console.log('=== Praetor Architecture Standards Suite (ARC-01 .. ARC-03) ===\n');

test('ARC-01: a well-layered feature passes', () => {
  const dir = makeDir();
  try {
    write(dir, 'src/catalog/domain/entities/product.ts', 'export interface Product { id: string }\n');
    write(dir, 'src/catalog/domain/repositories/product-repository.ts',
      "import { Product } from '../entities/product';\nexport interface ProductRepository { find(): Product }\n");
    write(dir, 'src/catalog/application/use-cases/get-product.ts',
      "import { ProductRepository } from '../../domain/repositories/product-repository';\nexport function getProduct(repo: ProductRepository): unknown { return repo.find(); }\n");
    write(dir, 'src/catalog/infrastructure/api/products-api.ts',
      "import { Product } from '../../domain/entities/product';\nexport const load = async (): Promise<Product> => ({ id: '1' });\n");

    const report = validateArchitecture(dir, DEFAULT_ARCHITECTURE_PROFILE);
    assert.strictEqual(report.valid, true, JSON.stringify(report.violations));
    assert.strictEqual(report.scanned, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ARC-02: domain importing infrastructure is a layer violation', () => {
  const dir = makeDir();
  try {
    write(dir, 'src/catalog/infrastructure/db/local.ts', 'export const db = { query: () => 1 };\n');
    write(dir, 'src/catalog/domain/entities/product.ts',
      "import { db } from '../../infrastructure/db/local';\nexport const leaked = db;\n");

    const report = validateArchitecture(dir, DEFAULT_ARCHITECTURE_PROFILE);
    const violation = report.violations.find(v => v.rule === 'layer_dependency');
    assert.ok(violation, JSON.stringify(report.violations));
    assert.match(violation.message, /domain.*infrastructure/i);
    assert.strictEqual(report.valid, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ARC-03: no_any, no_console and secrets are detected; tests are exempt', () => {
  const dir = makeDir();
  try {
    write(dir, 'src/catalog/domain/entities/bad.ts',
      "export const apiKey = 'sk-1234567890abcdef';\nconst value: any = 1;\nconsole.log(value);\n");
    write(dir, 'src/catalog/infrastructure/api/products-api.test.ts', 'console.log("debug in test");\n');

    const report = validateArchitecture(dir, DEFAULT_ARCHITECTURE_PROFILE);
    assert.ok(report.counts.no_any >= 1, JSON.stringify(report.counts));
    assert.ok(report.counts.no_console >= 1, JSON.stringify(report.counts));
    assert.ok(report.counts.secrets >= 1, JSON.stringify(report.counts));

    const consoleFiles = report.violations.filter(v => v.rule === 'no_console').map(v => v.file);
    assert.ok(!consoleFiles.some(f => f.includes('test')), 'test files must be exempt from no_console');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ARC-04: architecture goals route to the architect specialist', () => {
  const detected = inferSpecialists('design the architecture and pick a design pattern with an ADR');
  assert.ok(detected.includes('architect'), JSON.stringify(detected));
});

test('ARC-05: the strict profile enables no_comments and enforce_layers', () => {
  const profile = loadArchitectureProfile({ rootDir: process.cwd(), profile: 'strict' });
  assert.strictEqual(profile.rules.no_comments, true);
  assert.strictEqual(profile.structure.enforce_layers, true);

  const fallback = loadArchitectureProfile({ rootDir: process.cwd(), profile: 'does-not-exist' });
  assert.strictEqual(fallback.pattern, DEFAULT_ARCHITECTURE_PROFILE.pattern);
});

console.log(`\n============================================================`);
console.log(`Architecture Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);

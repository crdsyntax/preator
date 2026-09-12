import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AntigravityHostAdapter } from '../../runtime/hosts/antigravity.js';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-agconfig-'));
}

console.log('=== Praetor Antigravity Config Suite (AGT-01 .. AGT-03) ===\n');

test('AGT-01: setup writes the official hooks.json and mcp_config.json schema', () => {
  const dir = makeDir();
  try {
    const adapter = new AntigravityHostAdapter();
    const res = adapter.setup(dir);

    assert.ok(fs.existsSync(res.hookPath), 'Hook script must be installed');
    assert.ok(fs.existsSync(res.hooksJsonPath), 'hooks.json must exist');
    assert.ok(fs.existsSync(res.mcpConfigPath), 'mcp_config.json must exist');

    const hooks = JSON.parse(fs.readFileSync(res.hooksJsonPath, 'utf8'));
    const hook = hooks['praetor-governance'];
    assert.ok(hook, 'hooks.json must use the hook-name wrapper');
    assert.strictEqual(hook.enabled, true);
    assert.ok(Array.isArray(hook.PreToolUse), 'PreToolUse must be an array');
    const entry = hook.PreToolUse[0];
    assert.strictEqual(entry.matcher, '*');
    assert.ok(Array.isArray(entry.hooks), 'Handler must be nested under hooks[]');
    assert.strictEqual(entry.hooks[0].type, 'command');
    assert.ok(entry.hooks[0].command.includes('praetor'));
    assert.strictEqual(entry.hooks[0].timeout, 10);

    const mcp = JSON.parse(fs.readFileSync(res.mcpConfigPath, 'utf8'));
    const server = mcp.mcpServers?.praetor;
    assert.ok(server, 'mcp_config.json must declare mcpServers.praetor');
    assert.strictEqual(server.command, 'bun');
    assert.ok(Array.isArray(server.args) && server.args.includes('mcp'));
    assert.ok(typeof server.cwd === 'string' && server.cwd.length > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AGT-02: setup preserves unrelated hooks and MCP servers', () => {
  const dir = makeDir();
  try {
    fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents', 'hooks.json'), JSON.stringify({
      'other-hook': { PostToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: './lint.sh' }] }] }
    }, null, 2));
    fs.writeFileSync(path.join(dir, '.agents', 'mcp_config.json'), JSON.stringify({
      mcpServers: { other: { command: 'node', args: ['x.js'] } }
    }, null, 2));

    new AntigravityHostAdapter().setup(dir);

    const hooks = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'hooks.json'), 'utf8'));
    assert.ok(hooks['other-hook'], 'Unrelated hook must be preserved');
    assert.ok(hooks['praetor-governance'], 'Praetor hook must be added');

    const mcp = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'mcp_config.json'), 'utf8'));
    assert.ok(mcp.mcpServers.other, 'Unrelated MCP server must be preserved');
    assert.ok(mcp.mcpServers.praetor, 'Praetor MCP server must be added');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AGT-03: verify rejects a hooks.json without a Praetor PreToolUse handler', () => {
  const dir = makeDir();
  try {
    const adapter = new AntigravityHostAdapter();
    adapter.setup(dir);

    fs.writeFileSync(path.join(dir, '.agents', 'hooks.json'), JSON.stringify({
      'some-hook': { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: './other.sh' }] }] }
    }, null, 2));

    let threw = false;
    try {
      adapter.verify(dir);
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, true, 'verify must fail without a Praetor handler');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`Antigravity Config Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);

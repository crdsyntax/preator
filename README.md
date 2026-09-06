# Praetor

> **Praetor v0.1.1 — Universal, Stack-Agnostic Governed Agent Runtime Framework**  
> Formal 8-Phase Lifecycle FSM • Dual-Layer Security Policy • Anti-TOCTOU Argument Integrity • Cryptographic State Sealing • PowerShell De-obfuscation • Host Interceptors & MCP • 35-Scenario Benchmark Harness

[![Version](https://img.shields.io/badge/version-0.1.1-blue.svg)](package.json)
[![CI Standard](https://img.shields.io/badge/CI-Zero%20Regressions-brightgreen.svg)]()
[![Audit](https://img.shields.io/badge/Audit-30%2F30%20Passed-brightgreen.svg)]()
[![Hardening](https://img.shields.io/badge/Hardening-HRD--01..06%20Passed-brightgreen.svg)]()
[![Architecture](https://img.shields.io/badge/Conformance-ARCH--01..10%20Passed-success.svg)]()
[![Evaluations](https://img.shields.io/badge/Benchmarks-35%2F35%20Passed-blue.svg)]()
[![Multi-Stack](https://img.shields.io/badge/Ecosystem-Rust%20%7C%20Next.js%20%7C%20Python%20%7C%20Go%20%7C%20SQL-orange.svg)]()

---

## Overview: The Praetor Paradigm

In the Roman Republic, the **Praetor** was the magistrate entrusted with administering justice, interpreting legal bounds, and commanding state authority. 

In autonomous AI systems, **Praetor** serves the exact same role. Modern agent frameworks commonly suffer from a critical vulnerability: they grant models or host environments direct, unconstrained access to execution tools. LLMs hallucinate destructive bash commands, agents skip architectural planning to arbitrarily mutate code, and host hooks lack cryptographic verification.

**Praetor guarantees that models and external hosts never possess unilateral execution authority.** Every action, tool invocation, lifecycle transition, and subagent delegation must pass through deterministic, fail-closed governance gates.

---

## Architectural Trust Boundary

```text
External Host (UNTRUSTED / HOSTILE ENVIRONMENT)
   │  - Malicious PowerShell: g`it p`ush, powershell -enc, Out-File
   │  - TOCTOU Exploits: Authorize safe args -> Execute malicious payload
   │  - Disk State Tampering: Manually change state.json PLAN -> EXECUTE
   │
   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        PRAETOR TRUST BOUNDARY                          │
│                                                                        │
│  [ARCH-08] Canonical Normalization & Anti-TOCTOU                       │
│    • Invocations canonicalized into normalized schemas                 │
│    • Cryptographic SHA-256 argument binding (canonical_hash)          │
│    • ExecutionGateway rejects altered arguments (TOCTOU_MISMATCH)      │
│                                                                        │
│  [ARCH-09] State Integrity & Cryptographic Sealing                     │
│    • state.json sealed via SHA-256 state_hash                          │
│    • Verified against sequential transitions in append-only event log  │
│    • Out-of-band manipulation fails closed to REQUEST                  │
│                                                                        │
│  [ARCH-10] Host Isolation & Shell De-obfuscation                       │
│    • Backtick removal (g`it p`ush -> git push)                         │
│    • Base64 decoding (-EncodedCommand / -enc) prior to policy checks   │
│    • Disguised inline file writes blocked in non-write phases           │
│    • Host hook crash/timeout unconditionally denies (HOOK_FAIL_CLOSED)  │
│                                                                        │
│  [ARCH-01..07] Core Governance Kernel                                  │
│    • 8-Phase Lifecycle FSM (Write gate strictly in EXECUTE/DOCUMENT)   │
│    • Dual-Layer Policy Engine (Hard Invariants + Project Config)       │
│    • Delegation Tree Hierarchy (Root -> Specialists only, max depth 3) │
│    • Skill Capability Non-Elevation (Skills cannot grant tools)        │
│    • Context Governance (Workspace path traversal & secret guards)     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Core Governance Pillars

### 1. Formal 8-Phase Lifecycle State Machine (FSM)
Sessions transition strictly through an 8-phase directed graph. Skipping phases is mathematically rejected:

$$\text{REQUEST} \longrightarrow \text{ANALYZE} \longrightarrow \text{PLAN} \longrightarrow \text{REVIEW} \longrightarrow \text{EXECUTE} \longrightarrow \text{VERIFY} \longrightarrow \text{DOCUMENT} \longrightarrow \text{COMPLETE}$$

- **Write Gate Invariant:** State-modifying tools (`write`, `edit`, `patch`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`) are **strictly forbidden** during `REQUEST`, `ANALYZE`, `PLAN`, `REVIEW`, and `VERIFY`. They are only permitted in `EXECUTE` and `DOCUMENT`.
- **Completion Invariant:** A session can only be marked completed once it legally traverses to `COMPLETE`.

### 2. Dual-Layer Fail-Closed Security Policy
- **Layer 1: Immutable Hard Invariants (Never Relaxable):**
  - Path traversal escapes (`../../etc/passwd`) are blocked (`P2_PATH_TRAVERSAL_DENIED`).
  - Access to secrets (`.env`, `*.pem`, `*.key`, credentials) is blocked (`P3_CREDENTIAL_ACCESS_DENIED`).
  - Destructive commands (`rm -rf /`, `mkfs`, disk format) are blocked (`P1_DESTRUCTIVE_COMMAND_DENIED`).
  - Force-pushes (`git push --force`, `-f`) are permanently blocked (`P1_FORCE_PUSH_DENIED`).
  - Zombie sessions (executing after `completed` or `failed`) are blocked (`P5_ZOMBIE_PREVENTION`).
  - `git push` requires explicit prior human approval (`P1_PUSH_APPROVAL_REQUIRED`).
- **Layer 2: Project-Level Governance (`runtime.config.json`):**
  - Custom workspace boundaries, denied tool lists, and per-phase tool whitelists.
  - If configuration is corrupted or missing, the runtime **fails closed** on all execution actions (`CFG_FAIL_CLOSED_DENIED`).

### 3. Anti-TOCTOU Canonical Argument Integrity (`ARCH-08`)
To prevent Time-Of-Check to Time-Of-Use (TOCTOU) attacks where an adapter approves benign arguments but executes malicious ones:
- Host arguments are canonicalized into standard representations.
- An immutable SHA-256 hash (`canonical_hash`) is computed over the canonical tool and arguments.
- The `HostDecision` strictly binds to this hash.
- The `ExecutionGateway` recomputes the hash immediately prior to execution and rejects mismatches (`TOCTOU_MISMATCH_DENIED`).

### 4. Cryptographic State Sealing & Anti-Tampering (`ARCH-09`)
`state.json` is not trusted as an unverified authority. Every state write computes an HMAC/SHA-256 state seal (`state_hash`). On reload:
- The seal is verified.
- The event history in `events.jsonl` is replayed against the FSM transition graph via `validateTraceSequence()`.
- If manual disk manipulation is detected (e.g. modifying `current_phase` from `PLAN` to `EXECUTE`), the session fails closed, marks `tampered = true`, and resets to `REQUEST`.

### 5. Shell De-obfuscation & Fail-Closed Host Boundary (`ARCH-10`)
External hosts (IDEs, CI, shells) are treated as untrusted:
- **PowerShell Backtick Removal:** De-obfuscates evasion tricks like ``g`it p`ush`` $\to$ `git push`.
- **Base64 Decoding:** Decodes UTF-16LE and UTF-8 payloads passed to `-EncodedCommand` or `-enc` for inspection.
- **Inline Shell Write Interception:** Rejects disguised writes (`Set-Content`, `Out-File`, `>`, `>>`, `[IO.File]::WriteAllText`) during read-only phases.
- **Strict Hook Fail-Closed:** Hook syntax errors, timeouts, or empty inputs unconditionally output `{ "decision": "deny", "code": "HOOK_FAIL_CLOSED" }`.

---

## The 7 Gates of ExecutionGateway

Every tool call processed by Praetor must clear seven consecutive gates:

1. **Tool Contract Gate:** Validates request structure, unique `request_id`, valid phase, and declared risk level.
2. **Registry Lookup Gate:** Verifies tool exists in the active catalog.
3. **Argument Schema Gate:** Validates parameters against tool definitions.
4. **Anti-TOCTOU Gate (`ARCH-08`):** Compares canonical argument hash against authorization decision.
5. **Agent Capability Gate:** Verifies the active agent profile is permitted to invoke the tool.
6. **Lifecycle Write Gate:** Blocks write actions unless phase is `EXECUTE` or `DOCUMENT`.
7. **Policy Engine Gate:** Evaluates Layer 1 hard security invariants and Layer 2 project configuration rules.
8. **Human-in-the-Loop Approval Gate:** Suspends high-risk actions pending explicit human confirmation.

---

## Quickstart & Programmatic API

### Installation

Praetor runs natively on **[Bun](https://bun.sh)** or Node.js (v18+):

```bash
# Clone the repository
git clone https://github.com/crdsyntax/preator.git
cd preator

# Install dependencies (zero external runtime dependencies)
bun install
```

### Basic Usage

```javascript
import { createSession } from 'praetor';

// 1. Initialize a governed session
const session = createSession({
  agentId: 'backend-engineer',
  initialPhase: 'ANALYZE'
});

console.log(`Session initialized: ${session.sessionId} (Phase: ${session.getPhase()})`);

// 2. Attempting a write tool in ANALYZE phase is blocked by Hard Policy P6
try {
  await session.executeTool('write_to_file', {
    TargetFile: 'src/main.rs',
    CodeContent: 'fn main() {}'
  });
} catch (err) {
  console.log(`Blocked: ${err.code}`); // LIFECYCLE_DENIED
}

// 3. Legally advance through the 8-phase state machine
session.transition('PLAN');
session.transition('REVIEW');
session.transition('EXECUTE');

// 4. In EXECUTE phase, write tool is permitted
session.registerTool({
  name: 'write_to_file',
  isWrite: true,
  executor: async (args) => `Written to ${args.TargetFile}`
});

const output = await session.executeTool('write_to_file', {
  TargetFile: 'src/main.rs',
  CodeContent: 'fn main() { println!("Hello Praetor"); }'
});
console.log(output); // "Written to src/main.rs"
```

### Attaching Multi-Stack Skills

Skills provide standardized recipes and guidelines for specific technical stacks without violating the non-elevation invariant:

```javascript
import { loadSkillFromMarkdown } from 'praetor/core/skills.js';

// Load Rust Cargo skill
const rustSkill = loadSkillFromMarkdown('skills/rust-cargo/SKILL.md');

// Attaching validates that the agent already possesses required tools
session.attachSkill(rustSkill);
console.log(`Attached skill: ${rustSkill.name}`);
```

---

## Host & IDE Integrations

Praetor integrates seamlessly with external AI IDEs and host environments via standard protocols.

### 1. Google Antigravity & Claude Code (`PreToolUse` Hook)

Praetor acts as a synchronous IPC filter on stdin/stdout. Add to `.agents/hooks.json`:

```json
{
  "$schema": "https://json.schemastore.org/partial-agent-hooks.json",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "command": "bun run runtime/hosts/antigravity.js"
      }
    ]
  }
}
```

When the IDE proposes a tool call, Praetor intercepts it, applies argument canonicalization, evaluates policy, and returns:
```json
{
  "decision": "deny",
  "code": "P1_FORCE_PUSH_DENIED",
  "reason": "git push --force is strictly forbidden by immutable security policy (Hard Policy P1)."
}
```

### 2. Model Context Protocol (MCP)

Run Praetor as a standard MCP stdio server:

```bash
bun run runtime/hosts/mcp.js
```

Exposes standard MCP tools:
- `praetor_evaluate_action`: Pre-evaluates actions against the governance engine.
- `praetor_get_phase`: Returns the current session lifecycle phase.
- `praetor_transition_phase`: Advances the session lifecycle FSM.

---

## Architectural Invariants (`ARCH-01` .. `ARCH-10`)

Praetor's architecture is continuously verified against 10 formal invariants:

| Invariant | Title | Specification |
|---|---|---|
| **`ARCH-01`** | **Core Dependency Isolation** | `runtime/core/` depends ONLY on native language primitives. Zero imports from hosts, providers, evaluation, or external frameworks. |
| **`ARCH-02`** | **Host Adapter Normalization Only** | Host adapters normalize and transport inputs. They possess zero authorization authority. |
| **`ARCH-03`** | **Provider Suggestion Boundary** | Model providers generate suggestions. Only the runtime `Gateway` authorizes execution. |
| **`ARCH-04`** | **Fail-Closed Dual-Layer Policy** | Corrupted or missing configuration halts state-modifying operations immediately (`CFG_FAIL_CLOSED_DENIED`). |
| **`ARCH-05`** | **Skill Non-Elevation** | Skills encapsulate procedures; they can never expand tool capabilities beyond an agent's declared profile. |
| **`ARCH-06`** | **Context Boundary & Determinism** | Retrieval enforces workspace boundaries, denies secrets, and produces deterministic SHA-256 bundle hashes. |
| **`ARCH-07`** | **Delegation Tree Topology** | Root orchestrators delegate to specialists. Specialist-to-specialist delegations and cycles are forbidden (depth $\le 3$, concurrency $\le 4$). |
| **`ARCH-08`** | **Anti-TOCTOU Argument Binding** | Canonical argument schemas are hashed with SHA-256 and bound to `HostDecision`; execution parameters are strictly verified. |
| **`ARCH-09`** | **State Integrity Sealing** | `state.json` is cryptographically sealed and validated against `events.jsonl` replay. Tampering fails closed to `REQUEST`. |
| **`ARCH-10`** | **Fail-Closed Shell Hardening** | PowerShell backticks and Base64 commands are de-obfuscated; hook errors strictly default to `HOOK_FAIL_CLOSED`. |

---

## Included Catalogs

### Canonical Agent Profiles (`agents/`)
1. **Root Orchestrator** (`agents/orchestrator.md`): Session lead; owns lifecycle and delegations.
2. **Engineering Standards** (`agents/core/engineering.md`): Architectural conventions and quality gates.
3. **Core Security** (`agents/core/security.md`): Vulnerability prevention and security invariants.
4. **Backend Engineer** (`agents/backend/engineer.md`): Systems engineering and API implementations.
5. **Frontend Engineer** (`agents/frontend/engineer.md`): UI/UX, responsive components, accessibility.
6. **Database Engineer** (`agents/database/engineer.md`): Schema design, indexing, migrations, parameterized queries.
7. **QA Tester** (`agents/qa/tester.md`): Test suites, edge cases, regression verification.
8. **Code Reviewer** (`agents/reviews/review.md`): Pre-commit review, static analysis, policy conformance.
9. **Security DevOps** (`agents/security/devops.md`): CI/CD security, infrastructure hardening, secrets management.

### Multi-Stack Skills (`skills/`)
1. **Rust Cargo** (`skills/rust-cargo/SKILL.md`): Compilation, formatting, Clippy lints, and test execution.
2. **Next.js React** (`skills/nextjs-react/SKILL.md`): App Router, SSR, TypeScript typings, component testing.
3. **Database SQL** (`skills/database-sql/SKILL.md`): Parameterized SQL, index optimization, schema migrations.
4. **Git Workflow** (`skills/git-workflow/SKILL.md`): Branch conventions, commit standards, human approval rules.

---

## Evaluation Benchmark Harness (35 Scenarios)

Praetor includes an automated 35-scenario benchmark harness evaluated against historical baselines:

| Suite | Scenarios | Coverage |
|---|---|---|
| **Security Adversarial** | `SEC-01` .. `SEC-07` | Argument tampering, path traversal, secrets leakage, force-push denial. |
| **Security Hardening** | `HRD-01` .. `HRD-06` | Anti-TOCTOU, state anti-tampering, backtick evasion, Base64 evasion, inline writes, hook fail-closed. |
| **Behavioral** | `BEH-01` | Multi-turn database index optimization flow. |
| **Retrieval** | `RET-01` .. `RET-02` | Context determinism, SHA-256 hashing, token budget enforcement. |
| **Lifecycle** | `LIF-01` .. `LIF-02` | 8-phase sequential progression, write gates, skip rejection. |
| **Delegation** | `DEL-01` .. `DEL-02` | Max depth limit (3), cycle detection, unauthorized peer delegation. |
| **Model Providers** | `MOD-01` .. `MOD-05` | Model suggestion boundaries, turn recovery taxonomy. |
| **Host Interceptors** | `HST-01` .. `HST-05` | PreToolUse allow, deny, ask, force-ask, and MCP evaluation. |
| **Configuration** | `CFG-01` .. `CFG-06` | Schema validation, fail-closed fuzzing, workspace boundaries. |
| **Multi-Stack** | `STK-01` .. `STK-05` | Rust Cargo, Next.js React, Database SQL, Python, Go environments. |

---

## CLI Commands

```bash
# 1. Run Complete Test Suite (Audit + Hardening + Conformance + Benchmarks)
bun run test

# 2. Run Framework Audit (30 structural checks)
bun run agents:audit

# 3. Run Security Hardening Suite (HRD-01 to HRD-06)
bun run test:hardening

# 4. Run Architectural Conformance Gate (ARCH-01 to ARCH-10)
bun run agents:conformance

# 5. Run Benchmark Harness Evaluator (35 scenarios with regression tracking)
bun run agents:evaluate

# 6. Verify Real Host PreToolUse Hook Enforcement (stdin/stdout IPC)
bun run agents:enforce
```

---

## Configuration Reference (`runtime.config.json`)

```json
{
  "$schema": "./schemas/runtime.config.schema.json",
  "version": "1.0",
  "runtime": {
    "log_level": "info",
    "sessions_dir": ".agent/sessions",
    "max_delegation_depth": 3,
    "max_concurrency": 4
  },
  "workspace": {
    "boundaries": {
      "allowed": ["src", "app", "tests", "docs", "scripts"],
      "denied": ["node_modules", ".git", ".env"]
    }
  },
  "policy": {
    "denied_tools": ["raw_sql_exec"],
    "phase_rules": {
      "ANALYZE": { "allowed_tools": ["read", "view_file", "grep_search"] },
      "PLAN": { "allowed_tools": ["read", "view_file"] },
      "EXECUTE": { "allowed_tools": ["*"] }
    }
  }
}
```

---

## Repository Structure

```text
praetor/
├── runtime/                         # Agnostic Runtime Package
│   ├── index.js                     # Top-level exports (AgentSession, createSession, VERSION)
│   ├── core/                        # Agnostic Governance Kernel (Zero external imports)
│   │   ├── lifecycle.js             # 8-Phase FSM & trace validation
│   │   ├── state.js                 # Cryptographic state sealing & anti-tampering
│   │   ├── events.js                # Append-only structured event log
│   │   ├── approvals.js             # Human-in-the-loop approval manager
│   │   ├── registry.js              # Tool catalog & schema validator
│   │   ├── policy.js                # Dual-layer policy & shell de-obfuscation
│   │   ├── gateway.js               # 7-Gate central execution gateway (Anti-TOCTOU)
│   │   ├── delegation.js            # Task ownership contracts
│   │   ├── orchestration.js         # Tree delegation coordinator
│   │   ├── agents.js                # Agent profile loader & catalog
│   │   ├── skills.js                # Skill loader & non-elevation gate
│   │   └── context.js               # Deterministic retrieval & SHA-256 hashing
│   ├── providers/                   # Direct LLM / Inference Providers
│   │   ├── contracts.js             # ModelTurn schemas & recovery taxonomy
│   │   ├── driver.js                # Recovery metrics (RECOVERED, RETRIED, ABORTED)
│   │   └── pilot-adapter.js         # Deterministic scripted & adversarial adapter
│   ├── hosts/                       # External Host Interceptors
│   │   ├── contracts.js             # Canonical hash binding & decision schemas
│   │   ├── driver.js                # Canonical tool mapping & argument normalization
│   │   ├── antigravity.js           # Antigravity PreToolUse hook adapter (Fail-Closed)
│   │   └── mcp.js                   # Model Context Protocol (MCP) stdio adapter
│   └── evaluation/                  # Benchmark Infrastructure
│       ├── contracts.js             # Scenario & Scorecard schemas
│       ├── assertions.js            # Invariant assertion library
│       ├── scorecard.js             # Scorecard formatter & ASCII reporter
│       ├── regression.js            # Baseline tracker & comparator
│       └── runner.js                # Isolated session test runner
├── agents/                          # 9 Canonical Agent Profiles
├── skills/                          # 4 Multi-Stack Skill Packs
├── evaluations/                     # Evaluation Benchmark Suites
│   ├── security/                    # Adversarial & Hardening (HRD-01..06)
│   ├── behavioral/                  # Database optimization flow
│   ├── retrieval/                   # Context determinism
│   ├── lifecycle/                   # FSM state machine
│   ├── delegation/                  # Depth & cycle prevention
│   ├── providers/                   # Model suggestions
│   ├── hosts/                       # Host boundaries
│   ├── config/                      # Config fuzzing & boundaries
│   ├── stacks/                      # Rust, Next.js, SQL, Python, Go
│   └── architectural/               # ARCH-01..10 conformance gate
├── benchmarks/
│   ├── baselines/                   # Canonical baselines (baseline-v1, baseline-v2)
│   └── runs/                        # Historical timestamped audit runs
├── .agents/
│   └── hooks.json                   # Antigravity PreToolUse hook declaration
└── scripts/
    ├── audit-agent-runtime.js       # 30-point smoke & structural audit
    ├── evaluate-agent-runtime.js    # 35-scenario benchmark evaluator
    └── verify-host-enforcement.js   # Real host hook stdin/stdout IPC verification
```

---

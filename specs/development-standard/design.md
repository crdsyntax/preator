# Design: Development Standard

- **Spec:** `specs/development-standard/spec.md`
- **Status:** Approved

## Context

Praetor already governs *how tools execute* (FSM, policy, gateway, sealing). It does not yet express *how the code should be structured*. Projects carry that knowledge in prose documents. This design turns it into a declarative profile plus an executable validator, without hardcoding any project.

## Architecture & Layers

```
standards/<profile>.json  ──► runtime/core/architecture.js ──► bin/praetor.js
   (declared by the project)      (static validator)              arch check / standards check
                                          ▲
                                          │ consumed by
                        agents/architecture/architect.md
                        skills/development-standard/SKILL.md (+ references/architecture-patterns.md)
```

`architecture.js` is a dependency-free leaf (node `fs`/`path` only), consistent with the workspace agnosticism invariant.

## Contracts

- Profile: `{ pattern, feature_root, layers, dependency_rules, rules, ignore, commands }`.
- Report: `{ profile, feature_root, scanned, violations[], counts, valid }`.
- Violation rule ids: `layer_dependency`, `no_any`, `no_console`, `no_comments`, `secrets`.

## Data Flow

1. `loadArchitectureProfile` reads `standards/<name>.json`, deep-merging over defaults.
2. `validateArchitecture` walks `feature_root`, classifying each file's layer and scanning lines/imports.
3. CLI prints the report; `standards check` additionally runs `profile.commands`.

## Decisions

| Decision | Choice | Rationale | Alternative rejected |
|----------|--------|-----------|----------------------|
| Where rules live | Declarative profile | Per-project without code changes | Hardcoded rules |
| Analysis engine | Regex + path (v1) | Zero deps, fast, predictable | Full AST parser |
| Gate location | CLI + CI (not per-tool) | Architecture is a review concern | Runtime tool-call gate |
| Test exemption | Path-based | Avoid noise on legitimate test logs | Flag everything |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| False positives (regex) | Noise | Conservative defaults (`no_comments` off), test exemption, profile toggles |
| Scanning unrelated trees | Noise | `feature_root` required; no fallback to repo root |
| Drift from real code style | Stale rules | Profile is versioned; agent reviews |

## Rollout / Migration

Additive. Projects opt in by adding `standards/<profile>.json`. No behavior change unless `arch check`/`standards check` is invoked or wired into CI.

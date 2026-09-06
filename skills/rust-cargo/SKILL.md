---
name: rust-cargo
id: rust-cargo
description: Reusable workflows and standard procedures for Rust development using Cargo.
target_agents:
  - backend-engineer
  - qa-tester
  - security-devops
required_tools:
  - run_command
  - read
version: "1.0"
---

# Skill: Rust & Cargo Development

This skill guides agents when compiling, testing, linting, and formatting Rust codebases.

## Standard Commands

1. **Check Compilation:**
   ```bash
   cargo check --all-targets
   ```
2. **Linting & Warnings:**
   ```bash
   cargo clippy --all-targets -- -D warnings
   ```
3. **Automated Testing:**
   ```bash
   cargo test --lib
   ```
4. **Code Formatting:**
   ```bash
   cargo fmt --all -- --check
   ```
5. **Security Audit:**
   ```bash
   cargo audit
   ```

## Safety & Best Practices
- Never bypass compiler or clippy warnings using `#[allow(...)]` without explicit justification.
- Avoid `unwrap()` in production runtime code; prefer robust error propagation with `?` or `match`.
- Keep unsafe code strictly isolated and verified.

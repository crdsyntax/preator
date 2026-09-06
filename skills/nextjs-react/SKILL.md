---
name: nextjs-react
id: nextjs-react
description: Reusable procedures and best practices for Next.js and React frontend applications.
target_agents:
  - frontend-engineer
  - qa-tester
required_tools:
  - read
version: "1.0"
---

# Skill: Next.js & React Frontend Architecture

This skill provides guidelines for developing modern web frontends with React and Next.js.

## Core Workflows

1. **TypeScript Type Checking:**
   ```bash
   bunx tsc -b
   ```
2. **ESLint Validation:**
   ```bash
   bun run lint
   ```
3. **Frontend Test Suite:**
   ```bash
   bun run test
   ```

## Architecture Principles
- **Server Components:** Default to React Server Components (RSC) where possible in Next.js App Router; use `'use client'` only for interactive boundary components.
- **Strict Typing:** Never use `any`. Use TypeScript interfaces and union types.
- **Styling Standards:** Leverage Vanilla CSS or utility tokens consistently with design tokens.

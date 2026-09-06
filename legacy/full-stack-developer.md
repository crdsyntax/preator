# Full Stack Developer

## Role

Implement end-to-end features spanning both the Rust/Tauri backend and the React/TypeScript frontend layers of the database client.

This role is for tasks that require coordinated changes across the IPC boundary, where isolating work to a single layer would be artificial or inefficient.

---

## Core Responsibility

Deliver complete, atomic features that touch both layers:

* backend: Tauri commands, engine adapters, metadata extraction, query execution
* frontend: UI components, state management, IPC integration, rendering

The Full Stack Developer must maintain strict layer separation even when working both sides.

---

## Architecture Awareness

System flow:

Frontend (React)
→ Tauri IPC (`invoke`)
→ Rust Command Layer
→ Application Layer
→ Engine Adapters
→ Database Engines

No HTTP, no REST, no external API assumptions.

---

## Backend Rules (Rust/Tauri)

* commands must be thin and deterministic
* no UI logic inside commands
* no business-domain modeling
* engine-specific behavior must be preserved (no normalization)
* all IPC inputs/outputs must be strongly typed

---

## Frontend Rules (React/TypeScript)

* never infer database structure
* render exactly what backend returns
* no business logic in UI components
* strict TypeScript (no `any`, no `unknown`)
* lazy loading at every tree level

---

## Cross-Layer Discipline

When implementing full stack changes:

1. Define the IPC contract first (Rust structs + command signature)
2. Implement backend logic in isolation
3. Implement frontend integration as a consumer of the contract
4. Verify end-to-end without mixing concerns

Do NOT:

* write SQL in frontend code
* push rendering logic into backend commands
* bypass Tauri IPC with direct assumptions
* couple frontend state to backend implementation details

---

## Multi-Engine Support

Must support:

* PostgreSQL
* MariaDB / MySQL
* SQLite
* SQL Server
* MongoDB

Each engine is a separate bounded context. Do not unify behavior into a fake common model.

---

## Security Rules

* all inputs validated at IPC boundary
* parameterized queries where supported
* no secrets in logs or IPC responses
* frontend is never trusted for security enforcement

---

## Performance Rules

* pagination at backend level for large datasets
* virtualized rendering for large trees
* no unnecessary re-fetching on navigation
* minimize allocations in hot paths

---

## Anti-Patterns

Reject:

* mixing backend and frontend logic in a single module
* abstractions that hide engine-specific behavior
* UI-driven backend design decisions
* over-engineering generic layers "just in case"

---

## Golden Rule

Full stack does not mean merged concerns.

Backend and frontend remain strictly separated at the IPC boundary.
The Full Stack Developer bridges them without blurring them.

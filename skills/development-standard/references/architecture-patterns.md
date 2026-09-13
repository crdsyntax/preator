# Reference: Architecture Patterns

Catalog used by the `architect` agent and the `standards/<profile>.json`. Each pattern defines a dependency direction that `praetor arch check` can enforce via `dependency_rules`.

## Screaming / Clean (feature-first)

- **When:** apps whose top-level structure should announce their domain (features first, layers second).
- **Dependency direction:** `presentation → application → domain`; `infrastructure` implements ports and may depend inward; **`domain` must not import outward**.
- **Skeleton:**
  ```
  src/<feature>/
  ├── application/ (use-cases, queries)
  ├── domain/ (entities, repositories, value-objects)
  ├── infrastructure/ (api, database, repositories impl)
  └── presentation/ (screens, components, hooks)
  ```
- **Anti-patterns:** a `domain/` file importing `infrastructure/` or `application/`; generic `utils/` absorbing domain logic; layer folders at the repo root instead of inside each feature.

## Hexagonal / Ports & Adapters

- **When:** the domain must stay isolated from I/O (HTTP, DB, queues, UI).
- **Dependency direction:** domain defines **ports** (interfaces); adapters (infrastructure) implement them; nothing in the core imports an adapter.
- **Skeleton:** `core/` (domain + ports), `adapters/` (inbound/outbound), `composition/` (wiring).
- **Anti-patterns:** domain importing a driver/SDK; business rules living in adapters.

## Layered

- **When:** simple apps or when a strict feature split is overkill.
- **Dependency direction:** each layer depends only on the layer below: `presentation → application → domain`; `infrastructure` at the bottom.
- **Anti-patterns:** skipping layers; cross-imports between siblings.

## GoF patterns in common use

- **Repository:** domain port for persistence; implemented in `infrastructure/`.
- **Factory:** construct complex/aggregate objects; keep creation out of use-cases.
- **Strategy:** swap algorithms/policies behind one interface; select in `application`.

## Declaring in the profile

```json
{
  "pattern": "screaming-clean",
  "feature_root": "src",
  "layers": ["presentation", "application", "domain", "infrastructure"],
  "dependency_rules": [
    { "from": "domain", "disallow": ["application", "infrastructure", "presentation"] },
    { "from": "application", "disallow": ["infrastructure", "presentation"] }
  ]
}
```

`praetor arch check` reports `layer_dependency` violations when a source file imports a disallowed target layer via a relative path.

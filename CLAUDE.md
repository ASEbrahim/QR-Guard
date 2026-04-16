# QR-Guard — Claude Code Instructions

Read `docs/AGENTS.md` at the start of every session. It is the contract.

## Quick rules

1. **Plan first, code second.** Produce `increments/<NN>/PLAN.md` before writing any code.
2. **Wait for "Plan approved. Implement."** before touching source files.
3. **"address all notes, don't implement yet"** = iterate plan only, no code.
4. **FRS + UML diagrams are the spec.** If implementation diverges, implementation is wrong.
5. **Update docs after every implementation:** `docs/STATE.md`, `docs/CODEBASE_MAP.md`.

## Key files

| Need | Read |
|---|---|
| Rules | `docs/AGENTS.md` |
| Current state | `docs/STATE.md` |
| What files exist | `docs/CODEBASE_MAP.md` |
| Data model | `docs/SCHEMA.md` |
| Increment specs | `docs/INCREMENTS.md` |
| Terms & naming | `docs/GLOSSARY.md` |
| Workflow & prompts | `docs/PROMPT_TEMPLATES.md` |
| The spec | `docs/FRS.docx` |
| Scan pipeline order | `docs/uml/rendered/02-sequence-scan.svg` |
| Class diagram | `docs/uml/rendered/04-class-diagram.svg` |
| Architecture | `docs/uml/rendered/08-architecture.svg` |

## Stack (do not change)

Node.js + Express, PostgreSQL + PostGIS (Neon), Drizzle ORM, Socket.IO, Vanilla HTML/CSS/JS, Vitest, ESLint, Prettier.

## Code style

- One class per file, kebab-case filenames
- JSDoc on every exported function
- No magic numbers — use named constants
- Descriptive names: `verifyDeviceFingerprint(student, hash)` not `check(s, h)`
- Comments explain WHY, not WHAT
- Tests alongside source: `foo.js` -> `foo.test.js`

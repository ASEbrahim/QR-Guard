<!--
last_updated: 2026-04-16
audience: maintainer (when prompting Claude Code), Claude Code (when starting an increment)
role: canonical prompts and workflow templates for QR-Guard
-->

# PROMPT_TEMPLATES.md

> The canonical prompts and workflow templates. When the maintainer is prompting Claude Code, this is the playbook. When Claude Code starts an increment, this is the workflow it follows.

---

## The plan-first workflow

Every increment follows this exact flow. **No exceptions.**

### Step 1 — Maintainer kicks off an increment

The maintainer says, in this format:

```
Start Increment <N>.
```

Or for non-trivial deviations:

```
Start Increment <N>.
Special focus: <e.g., "use Drizzle's relations() syntax for the joins, not raw SQL">
Out of scope this round: <e.g., "skip the offline queue, we'll add it in Inc 5">
```

### Step 2 — Claude Code reads context, then proposes a plan

Claude Code reads:

1. `docs/AGENTS.md` (the rules, every session)
2. `docs/GLOSSARY.md` (the terminology, every session)
3. `docs/STATE.md` (current state, every session)
4. `docs/SCHEMA.md` (data model, every session)
5. `docs/INCREMENTS.md` § the relevant increment (the spec)
6. `docs/FRS.docx` § the relevant FR group(s) (the canonical requirement source)
7. `docs/uml/*` for the relevant diagrams (sequence + activity for Inc 3, etc.)
8. `docs/CODEBASE_MAP.md` (what exists already)

Then produces `increments/<NN>-<n>/PLAN.md` using the template in this file.

**Claude Code does not write code in step 2.**

### Step 3 — Maintainer reviews, may iterate with the guard phrase

The maintainer reviews the plan and either:

- **Approves:** "Plan approved. Implement." or "Looks good. Go ahead."
- **Asks for revisions:** uses the **guard phrase** — `address all notes, don't implement yet`

The guard phrase is a contract. When Claude Code sees it, it iterates on the plan only — no code, no migrations, no file changes outside `increments/<NN>-<n>/PLAN.md`.

Variants like "fix the plan" or "just iterate" do not reliably trigger the same behavior. **Use the exact phrase.**

### Step 4 — Implementation

After explicit approval, Claude Code implements the plan. Specifically:

- Writes code per the structure in `docs/AGENTS.md`
- Writes Vitest tests for every public function in the verification pipeline
- Runs `npm run lint` and `npm test` before reporting completion
- Updates `docs/STATE.md`, `docs/CODEBASE_MAP.md`, and `docs/SCHEMA.md` if applicable
- Commits with a conventional commits message including the increment number

### Step 5 — Maintainer review

Maintainer reviews the implementation. If issues are found, either:

- Asks for fixes inline
- Requests a new round of planning if the issues are structural

When complete, marks the increment as ✅ in `docs/STATE.md`.

---

## PLAN.md template

Every `increments/<NN>-<n>/PLAN.md` follows this structure.

```markdown
# Increment <N> — <name>

**Spec source:** docs/INCREMENTS.md § Increment <N>
**FRS sections:** FR<X>.<Y> through FR<X>.<Z>
**Dependencies:** <list of completed increments this requires>

## Scope confirmation

<One-paragraph restatement of what this increment delivers, in your own words. Confirms you understand the requirement.>

## Out of scope

<Bullet list of things that might seem related but are explicitly deferred to a later increment.>

## Architecture decisions

<Specific technical choices made for this increment. Examples:>
- Table partitioning strategy
- Whether to use a transaction or eventual consistency
- WebSocket message format
- Error response shape

## Data model changes

<Every column added, every new table, every constraint, every index. Reference SCHEMA.md.>

## API surface

<Every endpoint added or changed, with method, path, request body, response body, status codes.>

Example:
- `POST /api/auth/register` — body: `{email, password, name, universityId}` → 201 `{userId}` | 400 (validation) | 409 (email taken)

## File-level plan

<Every file you'll create or modify, with a one-line description.>

```
src/backend/db/user.schema.js          (new) Drizzle schema for users + students + instructors
src/backend/routes/auth-routes.js      (new) Express routes for register/login/verify/reset
src/backend/controllers/auth-controller.js (new) Business logic
src/backend/services/email-service.js  (new) Resend integration with Nodemailer fallback
tests/unit/auth-controller.test.js     (new) Unit tests
tests/integration/auth-routes.test.js  (new) Integration tests
docs/STATE.md                          (modify) Mark Inc 1 status
docs/CODEBASE_MAP.md                   (modify) Add new files
```

## Test plan

<Specific tests to write, mapped to acceptance criteria from INCREMENTS.md.>

For each acceptance criterion in INCREMENTS.md § Inc <N>, list the test(s) that verify it.

## Open questions

<Anything you need the maintainer to resolve before implementation can start. Empty if none.>

## Risks

<What could go wrong, ranked by likelihood × impact. Includes mitigation.>

## Acceptance criteria check

<Restate the acceptance criteria from INCREMENTS.md and confirm your plan addresses each one. Empty checkboxes for the maintainer to tick during review.>

- [ ] AC 1: ...
- [ ] AC 2: ...
- ...
```

---

## Canonical prompt templates

### Template — start an increment

Copy-paste, fill in `<N>`:

```
Start Increment <N>.

Read these documents in order:
- @docs/AGENTS.md
- @docs/GLOSSARY.md
- @docs/STATE.md
- @docs/SCHEMA.md
- @docs/INCREMENTS.md
- @docs/CODEBASE_MAP.md
- @docs/FRS.docx
- @docs/uml/04-class-diagram.svg

Then produce a plan in @increments/<NN>-<n>/PLAN.md following the PLAN.md template in @docs/PROMPT_TEMPLATES.md.

Do not write code. Wait for plan approval before implementation.
```

### Template — iterate on a plan

```
address all notes, don't implement yet

<inline notes, OR reference to comments left in PLAN.md>
```

### Template — approve and implement

```
Plan approved. Implement.

After implementation:
- Run `npm run lint` and `npm test`
- Update @docs/STATE.md and @docs/CODEBASE_MAP.md
- Commit with `feat(inc-<N>): <one-line description>`
- Report what was built and what wasn't
```

### Template — bug fix

```
The bug: <precise description, including steps to reproduce, expected behavior, actual behavior>

Read these documents:
- @docs/AGENTS.md
- @docs/STATE.md
- @increments/<NN>-<n>/PLAN.md (the relevant increment plan)

Then:
1. Reproduce the bug (write a failing test if possible)
2. Identify the root cause (don't just patch symptoms)
3. Propose a fix in plan form
4. Wait for my approval before implementing

The guard phrase rule applies: I will use "address all notes, don't implement yet" if I want plan iteration only.
```

### Template — investigation (no code)

```
The question: <precise question>

Read whatever documents and code are needed to answer. Do not modify any files.

Report:
1. Direct answer
2. Evidence (which files, which docs)
3. Confidence level
4. What you couldn't determine and why
5. Next steps if any
```

### Template — refactor with explicit goal

```
The goal: <what should be true after the refactor that isn't true now>

Constraints:
- No behavior changes (tests pass before and after)
- <any other constraints>

Read:
- @docs/AGENTS.md
- @docs/CODEBASE_MAP.md (to know what files exist)
- The files being refactored

Propose a refactor plan in @increments/refactor-<n>/PLAN.md. List every file that will change, what changes, and why. Include a verification plan.

Do not implement yet.
```

---

## Anti-patterns

Don't use these phrasings:

- ❌ **"Just build me X."** — vague, produces generic implementation
- ❌ **"Make it look modern."** — no anchor; produces convergent AI design
- ❌ **"Use best practices."** — no definition; cargo-cults patterns from random sources
- ❌ **"Add some tests."** — no spec; tests the implementation, not the requirement
- ❌ **"Fix the bug"** without reproduction steps
- ❌ Skipping the guard phrase when iterating
- ❌ Letting one Claude Code session run through multiple unrelated increments
- ❌ Approving a plan without reading it end-to-end
- ❌ Trusting "I've handled all edge cases" without verifying

---

## Context management

- **`/clear` between increments.** Each increment is a fresh session.
- **State persistence is via `docs/STATE.md`**, not session memory. Anything Claude Code learns that should survive a `/clear` goes in a doc.
- **Use file references over pasting:** `@docs/SCHEMA.md` not `[paste of SCHEMA.md]`. Saves context, lets Claude Code load once instead of holding in prompt forever.
- **Specificity beats verbosity.** "Add `phone_verified_at timestamp` to `users`, default NULL" beats a paragraph about "adding phone verification tracking somehow."

---

## Review checklist

When Claude Code reports an increment is complete, the maintainer's review:

1. **Did it follow the workflow?** Plan first, approval, then implementation?
2. **Are all acceptance criteria from `INCREMENTS.md § Inc <N>` met?** Check each one explicitly.
3. **Are tests written and passing?** Run `npm test` locally.
4. **Is the linter clean?** Run `npm run lint`.
5. **Are docs updated?** Check `docs/STATE.md`, `docs/CODEBASE_MAP.md`, `last_updated` lines.
6. **Is the commit message accurate?** `feat(inc-<N>): ...` format.
7. **Does the implementation match the plan?** Not "close to" — actually match.
8. **Edge cases addressed?** Empty inputs, concurrent requests, error paths, off-by-one boundaries.
9. **Security still intact?** Especially for Inc 1 (auth), Inc 3 (scan pipeline), Inc 5 (override).
10. **Would a senior engineer approve this code?** If no, request changes.

If any answer is unclear, ask: "Show me the test for X" or "Walk me through what happens if Y fails."

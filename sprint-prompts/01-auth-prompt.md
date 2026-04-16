# Sprint 1 — Authentication & Accounts

## When to use this prompt

At the very start of the QR-Guard build. This is the foundation increment — auth + dashboards + device binding. Inc 2 onwards depends on this.

## Pre-flight checklist

Before pasting:
- [ ] `docs/` folder is in the repo with all the docs (AGENTS.md, GLOSSARY.md, etc.)
- [ ] `docs/uml/` has the rendered diagrams
- [ ] `docs/FRS.docx` is in `docs/`
- [ ] `package.json` exists (or you're OK with Claude Code initializing it)
- [ ] You've started a fresh Claude Code session (`/clear` if needed)

## The prompt

```
Start Increment 1 — Authentication & Accounts.

Read these documents in order:
- @docs/AGENTS.md
- @docs/GLOSSARY.md
- @docs/STATE.md
- @docs/SCHEMA.md
- @docs/INCREMENTS.md
- @docs/CODEBASE_MAP.md
- @docs/FRS.docx (focus on FR1.1 through FR1.8)
- @docs/uml/04-class-diagram.svg (the User, Student, Instructor classes)

Context:
This is the first increment of QR-Guard. The repo is empty (or close to it). You will need to:
- Initialize the project: package.json, ESLint, Prettier, Vitest, Drizzle, Express
- Set up the development database (local PostgreSQL with PostGIS)
- Create the schema for users, students, instructors, email_verification_tokens (per @docs/SCHEMA.md)
- Build the auth flow end-to-end (register → email verify → login → dashboard)
- Implement device binding via FingerprintJS

Per @docs/AGENTS.md Rule 1, do not write code yet. Produce a plan in @increments/01-auth/PLAN.md following the PLAN.md template in @docs/PROMPT_TEMPLATES.md.

The plan must explicitly address:
1. Project initialization (which packages, what config files, what scripts in package.json)
2. Local DB setup instructions for the team (Postgres + PostGIS install + connection string in .env.example)
3. Drizzle schema for users + students + instructors + email_verification_tokens
4. Email service abstraction — Resend in production, SMTP fallback, console.log mock for local dev (so the team can develop without sending real emails)
5. Frontend pages: register, login, verify-email, reset-password, student dashboard, instructor dashboard (vanilla HTML/CSS/JS per FRS)
6. FingerprintJS integration — where the visitor ID is captured (registration vs first login), how it's stored, how device-mismatch is detected
7. Session management — JWT or server-side session (your call, defend it in the plan)
8. The 13 acceptance criteria from @docs/INCREMENTS.md § Increment 1, with the test that verifies each one

Open questions you should flag in the plan rather than guessing:
- Should the device-rebind email be sent automatically on first device-mismatch, or only when the student requests it manually? FRS FR1.7 says "once/semester via verified email" but doesn't specify the trigger.
- Should account lockout (FR1.6) lock the account permanently until email recovery, or auto-unlock after a cooldown (e.g., 30 min)?
- For local development without Resend, should email tokens be auto-printed to the console with the verification URL pre-built (for one-click testing), or just logged?

Wait for plan approval. The guard phrase if I want iteration without code is: "address all notes, don't implement yet"
```

## What to expect

Claude Code will produce `increments/01-auth/PLAN.md`. Review it carefully:

- **Scope confirmation** — does it match what FR1 actually asks for?
- **Data model changes** — does the schema match `docs/SCHEMA.md`?
- **API surface** — every endpoint listed with method, path, body, response?
- **File-level plan** — does it match the structure in AGENTS.md?
- **Open questions** — are the three I flagged above answered, or did Claude Code add more?
- **Test plan** — every acceptance criterion has at least one test?

If anything is wrong: `address all notes, don't implement yet` plus your inline notes.

When ready: `Plan approved. Implement.`

## Estimated time

- Plan generation: 2-3 minutes
- Plan iteration: 5-15 minutes (one to three rounds)
- Implementation: 20-40 minutes
- Review and sign-off: 10 minutes

**Total: ~30-60 minutes** for Inc 1.

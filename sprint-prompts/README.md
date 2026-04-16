# QR-Guard Sprint Prompts

Five copy-paste-ready prompts to drive Claude Code through the QR-Guard build, increment by increment.

## Order

Run these in order. Each one depends on the previous being ✅ complete.

| # | File | Increment | Estimated time |
|---|---|---|---|
| 1 | `01-auth-prompt.md` | Authentication & accounts | 30-60 min |
| 2 | `02-courses-prompt.md` | Course management | 45-75 min |
| 3 | `03-scan-pipeline-prompt.md` | Dynamic QR & scan pipeline | 2-3 hours |
| 4 | `04-reports-prompt.md` | Reports & analytics | 50-90 min |
| 5 | `05-notifications-prompt.md` | Notifications, override, audit, hardening | 2-2.5 hours |

**Total estimated build time: 6-9 hours** spread across 5 sessions.

## How to use a sprint prompt

Each file has the same structure:

1. **When to use this prompt** — preconditions
2. **Pre-flight checklist** — confirm you're ready
3. **The prompt** — copy the contents of the code block, paste into Claude Code
4. **What to expect** — review checklist for the plan Claude Code produces
5. **Estimated time** — for budgeting

## Workflow per sprint

```
Pre-flight check ✓
  ↓
Paste the prompt
  ↓
Claude Code reads docs, produces increments/<NN>/PLAN.md
  ↓
You review the plan
  ↓
Iterate? → "address all notes, don't implement yet" + your notes → loop back to review
  ↓
Approve → "Plan approved. Implement."
  ↓
Claude Code writes code + tests + docs updates + commit
  ↓
You review the code, run npm test + npm run lint
  ↓
✅ Mark increment complete in docs/STATE.md
  ↓
/clear, move to next sprint
```

## The two phrases that matter

These two phrases are contracts. Use them exactly:

| Phrase | What it does |
|---|---|
| `address all notes, don't implement yet` | Iterate the plan only; no code changes |
| `Plan approved. Implement.` | Authorize implementation |

Variants ("just iterate", "looks fine I guess") don't reliably trigger the same behavior. **Use the exact phrases.**

## Critical: between sprints

Always `/clear` between sprints. Each one is a fresh Claude Code session that:

1. Reads `docs/AGENTS.md` (rules)
2. Reads `docs/STATE.md` (where we are)
3. Reads `docs/CODEBASE_MAP.md` (what exists)

This works because `docs/STATE.md` and `docs/CODEBASE_MAP.md` are updated at the end of each implementation. Don't skip those updates — they're how Claude Code remembers across sessions.

## When something goes wrong

**Plan looks bad:** Use the guard phrase. Iterate as many rounds as needed. Don't approve a bad plan to "move on" — it'll cost more time later.

**Implementation breaks tests:** Don't ship it. Tell Claude Code to fix it before claiming completion. "The X test fails. Fix it before declaring this increment complete."

**Increment is too big:** Sprint 3 has built-in instructions for splitting into 3a (backend) and 3b (frontend). Other sprints can be split similarly if needed — just say "this increment is too large; propose a split into two sprints."

**Claude Code starts deviating from the FRS:** Cite the FRS by section number. "FR4.3 says +15m margin. Your plan has +20m. Why the deviation?" Don't let drift go unchallenged.

**Context degradation:** If Claude Code starts producing confused output mid-sprint, save the plan, `/clear`, and resume with a prompt that re-reads docs. Don't push through degraded sessions.

## After all 5 sprints

System is feature-complete. Next steps:

1. Write Progress Report 2 with real implementation status
2. Build the presentation slides
3. Deploy or set up local demo
4. Optionally: expand the FRS with Final Report wrapper sections

Good luck.

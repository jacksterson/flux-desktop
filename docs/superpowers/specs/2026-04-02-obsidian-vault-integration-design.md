---
title: Obsidian Vault Integration Design
date: 2026-04-02
tags:
  - flux
  - design
  - memory
  - obsidian
status: approved
---

# Obsidian Vault Integration

Wires the Obsidian vault at `/home/jack/obsidian-vault` into Claude's workflow as the persistent intent/history layer for the Flux project. Claude reads the vault before any architectural work and writes session notes after any significant session.

---

## Architecture

Two layers of project memory work in tandem:

| Layer | Tool | What It Stores |
|---|---|---|
| Intent Memory | Obsidian Vault | Why decisions were made, project goals, kickoff docs, release plans, session notes |
| Code Memory | jCodemunch | What the code does — symbols, functions, AST structure, module relationships |

**Retrieval order** (enforced in CLAUDE.md / AGENTS.md):
1. Read Obsidian vault → understand project intent and history
2. Query jCodemunch → understand current code state
3. Read raw files only if both sources are insufficient

---

## Vault Structure

```
/home/jack/obsidian-vault/
└── Projects/
    ├── kickoff-flux.md                         ← exists; primary project reference
    ├── release-flux.md                         ← created at launch time
    └── session-YYYY-MM-DD-<topic>.md           ← written after each major session
```

No structural changes to the vault are needed. New session notes follow the naming convention above and are written into `Projects/`.

---

## Read Protocol

**When to read:**
- Before any architectural decision or multi-step plan
- Before starting a new phase of the roadmap
- When the user references past decisions or context

**How to read:**
- Use `Read` tool directly on vault files (vault is plain markdown on disk)
- Use `Grep` to search across vault files for relevant context
- Always check `kickoff-flux.md` first; then scan for recent session notes by date

Obsidian does not need to be running for reads.

---

## Write-Back Protocol

**When to write:**
- End of any session where code was committed
- After a design was finalized
- After a phase milestone was reached

**Session note format:**

```markdown
---
tags: [flux, session]
date: YYYY-MM-DD
phase: <e.g. Phase 4b>
---

## What was built
<1-3 sentences>

## Key decisions
- <decision and reason>

## What changed from the plan
<if anything>

## Next
<where the work left off>
```

**Write mechanic:**
1. Attempt `obsidian status` — if Obsidian is running, use `obsidian create` or `obsidian append` via the obsidian-cli skill
2. If Obsidian is not running, use the `Write` tool directly to the vault path

---

## CLAUDE.md / AGENTS.md Changes

### CLAUDE.md additions
- Vault path: `/home/jack/obsidian-vault`
- Explicit read rule: check `Projects/kickoff-<project>.md` and recent session notes before starting any task
- Explicit write-back rule: after any session with a commit or finalized design, write a session note to `Projects/session-YYYY-MM-DD-<topic>.md`

### AGENTS.md additions
- Vault path added explicitly
- Session note path pattern documented
- No other changes — existing Obsidian rules are correct

---

## Out of Scope

- obsidian-http-mcp / Local REST API plugin (deferred; can be added later for richer querying)
- Obsidian CLI enable step (not required for Approach A)
- Automated hooks to trigger write-back (Claude handles this, no shell automation needed)

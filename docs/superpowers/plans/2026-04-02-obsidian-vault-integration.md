# Obsidian Vault Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Obsidian vault at `/home/jack/obsidian-vault` into Claude's workflow so it is actively read before architectural work and written to after significant sessions.

**Architecture:** CLAUDE.md and AGENTS.md are updated with concrete vault path, read triggers, and write-back rules. Claude reads vault files directly via Read/Grep tools (no Obsidian running required). Claude writes session notes via obsidian-cli skill when Obsidian is open, or Write tool when it is not.

**Tech Stack:** Plain markdown files, obsidian-cli skill, Read/Write/Grep tools, CLAUDE.md / AGENTS.md config files.

---

### Task 1: Update CLAUDE.md with concrete vault rules

**Files:**
- Modify: `/home/jack/bridgegap/CLAUDE.md`

Current line 8-10 reads:
```
- Memory management: Obsidian vault = long-term project memory (intent, decisions, history)
  jCodemunch = short-term precise code memory (symbols, functions, structure)
  Always consult both before making architectural suggestions or code changes
```

Replace with the block below.

- [ ] **Step 1: Edit CLAUDE.md**

Replace the memory management block (lines 8–10) with:

```
- Memory management:
  VAULT_PATH = /home/jack/obsidian-vault
  Obsidian vault = long-term project memory (intent, decisions, history)
  jCodemunch = short-term precise code memory (symbols, functions, structure)

  READ RULE: Before any architectural suggestion, multi-step plan, or new phase work:
    1. Read VAULT_PATH/Projects/kickoff-<project>.md
    2. Grep VAULT_PATH/Projects/ for session notes matching the current topic
    3. Query jCodemunch for current code state
    Only then read raw files if both are insufficient.

  WRITE-BACK RULE: After any session that produces a git commit or finalizes a design:
    - Write a session note to VAULT_PATH/Projects/session-YYYY-MM-DD-<topic>.md
    - Format: frontmatter (tags: [<project>, session], date, phase) + sections:
        ## What was built, ## Key decisions, ## What changed from the plan, ## Next
    - If Obsidian is running: use obsidian-cli skill (obsidian create or obsidian append)
    - If Obsidian is not running: use Write tool directly to VAULT_PATH/Projects/
```

- [ ] **Step 2: Verify the file looks correct**

Run: `cat /home/jack/bridgegap/CLAUDE.md`
Expected: vault path, read rule, and write-back rule are all present and readable.

- [ ] **Step 3: Commit**

```bash
cd /home/jack/bridgegap
git add CLAUDE.md
git commit -m "config: add concrete Obsidian vault read/write rules to CLAUDE.md"
```

---

### Task 2: Update AGENTS.md with vault path and session note pattern

**Files:**
- Modify: `/home/jack/bridgegap/AGENTS.md`

Current lines 14–22 describe Obsidian usage but lack the vault path and session note format.

- [ ] **Step 1: Edit AGENTS.md**

Replace lines 14–22:
```
- Obsidian vault is the persistent memory layer for all projects:
    - Stores kickoff docs, release plans, design decisions, and session notes
    - Works IN CONJUNCTION with jCodemunch: jCodemunch indexes code structure,
      Obsidian indexes human-readable context (why decisions were made, not just what)
    - Before starting any task, check BOTH jCodemunch (for code state) AND
      Obsidian vault (for project intent, history, and notes)
    - After completing any significant task, write a summary note to the Obsidian vault
    - Memory retrieval order: Obsidian (intent/context) → jCodemunch (code/symbols) → files
- Reference docs/obsidian-sync.md for vault path and MCP setup
```

With:
```
- Obsidian vault is the persistent memory layer for all projects:
    VAULT_PATH = /home/jack/obsidian-vault
    - Stores kickoff docs, release plans, design decisions, and session notes
    - Works IN CONJUNCTION with jCodemunch: jCodemunch indexes code structure,
      Obsidian indexes human-readable context (why decisions were made, not just what)
    - Memory retrieval order: Obsidian (intent/context) → jCodemunch (code/symbols) → files

  READ RULE: Before starting any task:
    1. Read VAULT_PATH/Projects/kickoff-<project>.md for project intent
    2. Grep VAULT_PATH/Projects/ for recent session notes on the current topic
    3. Query jCodemunch for current code state

  WRITE-BACK RULE: After any session with a commit or finalized design:
    Write VAULT_PATH/Projects/session-YYYY-MM-DD-<topic>.md with:
      ---
      tags: [<project>, session]
      date: YYYY-MM-DD
      phase: <current phase>
      ---
      ## What was built
      ## Key decisions
      ## What changed from the plan
      ## Next
    Use obsidian-cli skill if Obsidian is open; Write tool otherwise.

  Kickoff docs:    VAULT_PATH/Projects/kickoff-<project>.md
  Release plans:   VAULT_PATH/Projects/release-<project>.md
  Session notes:   VAULT_PATH/Projects/session-YYYY-MM-DD-<topic>.md
```

- [ ] **Step 2: Verify the file looks correct**

Run: `cat /home/jack/bridgegap/AGENTS.md`
Expected: vault path, read rule, write-back rule, and file path patterns are all present.

- [ ] **Step 3: Commit**

```bash
cd /home/jack/bridgegap
git add AGENTS.md
git commit -m "config: add vault path, read rule, and write-back rule to AGENTS.md"
```

---

### Task 3: Smoke-test the read workflow

No code changes. Verify the workflow works end-to-end by simulating a pre-task vault read.

- [ ] **Step 1: Read the kickoff doc**

Run: Read `/home/jack/obsidian-vault/Projects/kickoff-flux.md`
Expected: Flux project goals, phases, and architecture are visible.

- [ ] **Step 2: Search for recent session notes**

Run: Grep pattern `session` in `/home/jack/obsidian-vault/Projects/` (files_with_matches mode)
Expected: Any existing session note files are listed (e.g. `session-2026-03-28-flux-widget-editor-p4b.md`).

- [ ] **Step 3: Read a session note**

Run: Read the most recent session note found in Step 2.
Expected: Session note is readable with proper frontmatter and sections.

- [ ] **Step 4: Commit smoke-test result as a new session note**

Write a session note confirming the integration is working:

File: `/home/jack/obsidian-vault/Projects/session-2026-04-02-obsidian-vault-integration.md`

```markdown
---
tags: [flux, session]
date: 2026-04-02
phase: Infrastructure
---

## What was built
Wired Obsidian vault into Claude's workflow. CLAUDE.md and AGENTS.md updated with
concrete vault path, read triggers, and write-back rules using file I/O + obsidian-cli skill.

## Key decisions
- Approach A chosen: direct file reads (Read/Grep) + obsidian-cli for writes
- No MCP server needed — vault is plain markdown, readable without Obsidian running
- obsidian-http-mcp deferred for later if richer querying is needed

## What changed from the plan
Nothing — implemented exactly as designed.

## Next
Use this workflow on every subsequent session: read kickoff + recent session notes
before starting, write session note after any commit or design decision.
```

Use `Write` tool to create the file, then:

```bash
cd /home/jack/bridgegap
git add docs/superpowers/plans/2026-04-02-obsidian-vault-integration.md
git commit -m "docs: add Obsidian vault integration implementation plan"
```

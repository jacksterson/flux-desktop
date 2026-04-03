- # Source of truth: AGENTS.md
- Imports all rules from AGENTS.md
- Claude-specific: use .claude/agents/ subagents for all project reviews
- Always run project-kickoff agent before starting a new project
- Always run release-checklist agent before any launch or publish action
- Default tone: direct, no fluff, treat owner as a senior peer
- Warn loudly if the owner is about to give something away for free without an income plan
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
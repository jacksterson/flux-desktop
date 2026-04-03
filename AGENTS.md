- Project owner is a solo indie developer in Alamosa, Colorado
- Currently unemployed — income generation is the highest priority
- Primary stack: Godot Engine, Python, GDScript, Bash, CachyOS Linux
- Active projects: a survival/exploration game, a music release, and new app ideas
- Open source philosophy is valued BUT must be balanced with monetization
- Preferred monetization models: Sponsor-Ware, Open Core, Dual Licensing, Ko-fi donations
- RULE: Before any project is published or open sourced, run the 3-Question Gate:
    1. Can this realistically make money in 90 days?
    2. Does this have a community/audience angle worth Sponsor-Ware?
    3. Is this purely a learning prototype? (only then is free release acceptable)
- Both Claude and Gemini must follow all rules in this file
- Context sync: always check AGENTS.md before starting any new task
- jCodemunch MCP is active — use symbol-level retrieval, not full file scans
- Obsidian vault is the persistent memory layer for all projects:
    VAULT_PATH = /home/jack/obsidian-vault
    - Stores kickoff docs, release plans, design decisions, and session notes
    - Works IN CONJUNCTION with jCodemunch: jCodemunch indexes code structure,
      Obsidian indexes human-readable context (why decisions were made, not just what)
    - Memory retrieval order: Obsidian (intent/context) → jCodemunch (code/symbols) → files

  READ RULE: Before any architectural suggestion, multi-step plan, new phase work, or non-trivial code change:
    1. Read VAULT_PATH/Projects/kickoff-<project>.md for project intent
    2. Grep VAULT_PATH/Projects/ for recent session notes on the current topic
    3. Query jCodemunch for current code state
    Only read raw files if both sources are insufficient.

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
    - If Obsidian is running: use obsidian-cli skill (obsidian create or obsidian append)
    - If Obsidian is not running: use Write tool directly to VAULT_PATH/Projects/
    Skip write-back if the session produced no commits and no finalized design decisions.

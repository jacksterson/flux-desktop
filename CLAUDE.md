- # Source of truth: AGENTS.md
- Imports all rules from AGENTS.md
- Claude-specific: use .claude/agents/ subagents for all project reviews
- Always run project-kickoff agent before starting a new project
- Always run release-checklist agent before any launch or publish action
- Default tone: direct, no fluff, treat owner as a senior peer
- Warn loudly if the owner is about to give something away for free without an income plan
- Memory management: Obsidian vault = long-term project memory (intent, decisions, history)
  jCodemunch = short-term precise code memory (symbols, functions, structure)
  Always consult both before making architectural suggestions or code changes
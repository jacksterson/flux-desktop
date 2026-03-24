- # Source of truth: AGENTS.md
- Imports all rules from AGENTS.md
- Gemini-specific: use 1M context window for large codebase reviews and design docs
- Preferred for: architecture reviews, long-form planning, brainstorming monetization angles
- Cross-check CLAUDE.md on first run — flag any drift between the two files
- When asked to build something new, ask "Have you run the project-kickoff checklist?" first
- Memory management: query Obsidian vault for project history and intent BEFORE
  querying jCodemunch for code symbols — vault context informs code-level decisions
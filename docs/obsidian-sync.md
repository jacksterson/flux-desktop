## Obsidian Vault + jCodemunch: Unified Memory System

These two tools serve complementary memory roles and should always be used together:

| Layer | Tool | What It Stores |
|---|---|---|
| Intent Memory | Obsidian Vault | Why decisions were made, project goals, kickoff docs, release plans, session notes |
| Code Memory | jCodemunch | What the code does, symbols, functions, AST structure, module relationships |

### Memory Retrieval Order (for both Claude Code and Gemini CLI):
1. Query Obsidian vault first → understand project intent and history
2. Query jCodemunch second → understand current code state
3. Only then read raw files if both sources are insufficient

### Memory Write-Back Protocol:
- After every major session, write a brief note to Obsidian: what was built, why, what changed
- jCodemunch re-indexes automatically on file change (no manual step needed)
- Kickoff docs live at: [vault]/Projects/kickoff-[project-name].md
- Release plans live at: [vault]/Projects/release-[project-name].md

### Setup:
VAULT_PATH = "/home/jack/obsidian-vault"

Install obsidian-http-mcp for stable Linux MCP transport:
  git clone https://github.com/NasAndNora/obsidian-http-mcp
  cd obsidian-http-mcp && npm install
  Point vault path to VAULT_PATH above
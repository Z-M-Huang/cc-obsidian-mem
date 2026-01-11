# cc-obsidian-mem

Obsidian-based persistent memory system for Claude Code. Automatically captures session activity, errors, decisions, and patterns into a browsable, visualizable knowledge base.

## Features

- **Automatic Capture**: Hooks automatically track file edits, commands, and errors
- **AI Summaries**: Claude-powered knowledge extraction from conversations
- **Obsidian Integration**: Full Obsidian syntax support with Dataview queries for visualization
- **Canvas Visualizations**: Auto-generated dashboard, timeline, and graph canvases
- **Project Organization**: Memories organized by project with cross-project patterns
- **MCP Tools**: Search, read, and write memories directly from Claude Code
- **Skills**: User-invokable commands (`/mem-search`, `/mem-save`, `/mem-status`)

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime installed
- [Obsidian](https://obsidian.md/) with an existing vault
- [Dataview plugin](https://github.com/blacksmithgu/obsidian-dataview) (recommended for dashboards)
- Claude Code CLI

### Step 1: Install the Plugin

**Option A: From GitHub Marketplace (Recommended)**

```bash
# In Claude Code, run:
/plugin marketplace add z-m-huang/cc-obsidian-mem
/plugin install cc-obsidian-mem
```

**Option B: From Local Clone**

```bash
# Clone the repository
git clone https://github.com/Z-M-Huang/cc-obsidian-mem.git
cd cc-obsidian-mem/plugin
bun install

# In Claude Code, run:
/plugin marketplace add /path/to/cc-obsidian-mem
/plugin install cc-obsidian-mem
```

### Step 2: Configure Your Vault

Run the setup wizard:

```bash
# Navigate to the plugin directory and run setup
cd ~/.claude/plugins/cc-obsidian-mem  # or your clone location
cd plugin && bun run setup
```

The wizard will prompt you for your Obsidian vault path and create the config file.

**Or manually create** `~/.cc-obsidian-mem/config.json`:

```json
{
  "vault": {
    "path": "/path/to/your/obsidian/vault",
    "memFolder": "_claude-mem"
  },
  "capture": {
    "fileEdits": true,
    "bashCommands": true,
    "bashOutput": { "enabled": true, "maxLength": 5000 },
    "errors": true,
    "decisions": true
  },
  "summarization": {
    "enabled": true,
    "model": "sonnet"
  },
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000,
    "includeRelatedErrors": true,
    "includeProjectPatterns": true
  },
  "canvas": {
    "enabled": true,
    "autoGenerate": true,
    "updateStrategy": "always"
  }
}
```

> **Note**: AI summarization uses the Claude Code CLI (`claude -p`), so no separate API key is required. Valid model values: `sonnet`, `opus`, `haiku`.

### Step 3: Restart Claude Code

Restart Claude Code to load the plugin and hooks.

### Step 4: Enable Proactive Memory Use (Important!)

The plugin provides MCP tools, but Claude won't automatically use them unless instructed. Add the following to your project's `CLAUDE.md` file:

```markdown
## Memory System (cc-obsidian-mem)

You have access to a persistent memory system via MCP tools. Use it proactively.

### Available Tools

| Tool | Use When |
|------|----------|
| `mem_search` | Looking for past decisions, errors, patterns, or context |
| `mem_read` | Need full content of a specific note |
| `mem_write` | Saving important decisions, patterns, or learnings |
| `mem_supersede` | Updating/replacing outdated information |
| `mem_project_context` | Starting work on a project (get recent context) |
| `mem_list_projects` | Need to see all tracked projects |
| `mem_generate_canvas` | Generate Obsidian canvas visualizations |

### When to Search Memory

**Proactively search memory (`mem_search`) when:**
- Starting work on a codebase - check for project context and recent decisions
- Encountering an error - search for similar errors and their solutions
- Making architectural decisions - look for related past decisions
- User asks "how did we..." or "why did we..." or "what was..."
- Implementing a feature similar to past work

**Example searches:**
- `mem_search query="authentication" type="decision"` - Find auth-related decisions
- `mem_search query="TypeError" type="error"` - Find past TypeScript errors
- `mem_search query="database schema"` - Find DB-related knowledge
- `mem_project_context project="my-project"` - Get full project context

### When to Save to Memory

**Save to memory (`mem_write`) when:**
- Making significant architectural or technical decisions
- Discovering important patterns or gotchas
- Solving tricky bugs (save the solution)
- Learning something project-specific that will be useful later

**Use `mem_supersede` when:**
- A previous decision is being replaced
- Updating outdated documentation or patterns
```

You can also add this to your global `~/.claude/CLAUDE.md` to apply it to all projects.

---

## Usage

### Automatic Capture

Once installed, the plugin automatically:
- Tracks file edits, bash commands, and errors during sessions
- Extracts knowledge from web searches and documentation lookups
- Generates AI-powered knowledge extraction when you run `/compact` or end a session
- Persists decisions, errors, patterns, and learnings to your Obsidian vault

### Skills (User Commands)

#### `/mem-search` - Search your knowledge base
```
/mem-search authentication error fix
/mem-search database schema decisions
/mem-search API rate limiting patterns
```

#### `/mem-save` - Save knowledge explicitly
```
/mem-save decision: We chose PostgreSQL for better JSON support
/mem-save pattern: This regex validates email addresses
/mem-save learning: API rate limits at 100 req/min
```

#### `/mem-status` - Check system status
```
/mem-status
```

### MCP Tools

These tools are available to Claude during conversations:

| Tool | Description |
|------|-------------|
| `mem_search` | Search notes by query, project, type, or tags |
| `mem_read` | Read a specific note's content |
| `mem_write` | Create or update notes |
| `mem_supersede` | Create a new note that supersedes an existing one (bidirectional links) |
| `mem_project_context` | Get context for a project |
| `mem_list_projects` | List all tracked projects |
| `mem_generate_canvas` | Generate canvas visualizations (dashboard, timeline, graph) |

---

## Architecture

```
┌──────────────┐     ┌─────────────┐     ┌────────────────┐
│ Claude Code  │◄───►│ MCP Server  │◄───►│ Obsidian Vault │
└──────┬───────┘     └─────────────┘     └────────────────┘
       │
       ▼
┌──────────────┐     ┌─────────────┐
│    Hooks     │────►│Session Store│
│ (Lifecycle)  │     │ (Ephemeral) │
└──────────────┘     └─────────────┘
```

### Hooks

| Hook | Purpose |
|------|---------|
| `SessionStart` | Initialize session tracking, inject project context, migrate pending files |
| `UserPromptSubmit` | Track user prompts |
| `PostToolUse` | Capture observations, extract knowledge from web tools |
| `PreCompact` | Trigger background AI summarization before `/compact` |
| `SessionEnd` | Generate canvas visualizations, cleanup session files |

---

## Vault Structure

```
vault/
├── _claude-mem/
│   ├── index.md                     # Dashboard with Dataview queries
│   ├── projects/
│   │   └── {project-name}/
│   │       ├── {project-name}.md    # Project overview
│   │       ├── errors/
│   │       │   ├── errors.md        # Category index
│   │       │   └── *.md             # Error patterns
│   │       ├── decisions/
│   │       │   ├── decisions.md     # Category index
│   │       │   └── *.md             # Architectural decisions
│   │       ├── knowledge/
│   │       │   ├── knowledge.md     # Category index
│   │       │   └── *.md             # Q&A, explanations, learnings
│   │       ├── research/
│   │       │   ├── research.md      # Category index
│   │       │   └── *.md             # External research notes
│   │       ├── patterns/
│   │       │   ├── patterns.md      # Category index
│   │       │   └── *.md             # Project-specific patterns
│   │       ├── files/
│   │       │   ├── files.md         # Category index
│   │       │   └── *.md             # File-specific knowledge
│   │       └── canvases/
│   │           ├── dashboard.canvas # Grid layout by folder type
│   │           ├── timeline.canvas  # Decisions chronologically
│   │           └── graph.canvas     # Radial knowledge graph
│   ├── global/
│   │   ├── patterns/                # Reusable cross-project patterns
│   │   └── knowledge/               # General learnings
│   └── templates/                   # Note templates
```

> **Note**: Session data is stored ephemerally in `~/.cc-obsidian-mem/sessions/` during active sessions and cleaned up when sessions end. Only persistent knowledge is stored in the vault.

### Note Linking

Notes follow a hierarchical linking structure for Obsidian graph navigation:
- Individual notes link to their category index via `parent` frontmatter
- Category indexes link to the project base
- Superseded notes have bidirectional links (`superseded_by` ↔ `supersedes`)

---

## Obsidian Features Used

- **Frontmatter/Properties**: YAML metadata for filtering and Dataview
- **Wikilinks**: `[[Note]]`, `[[Note#heading]]` for navigation
- **Callouts**: `> [!warning]`, `> [!success]` for visual highlighting
- **Dataview queries**: Dynamic dashboards and indexes
- **Graph view**: Visualize connections between notes
- **Tags**: `#error`, `#decision`, `#learning`, `#project/name` for organization

---

## Troubleshooting

### Plugin not loading

1. Verify installation: `/plugin list` should show `cc-obsidian-mem`
2. Check plugin validation: `claude plugin validate ~/.claude/plugins/cc-obsidian-mem`
3. Enable debug mode: `claude --debug`

### No data being captured

1. Restart Claude Code after installing
2. Check config exists: `cat ~/.cc-obsidian-mem/config.json`
3. Verify vault path is correct and writable
4. Check session files: `ls ~/.cc-obsidian-mem/sessions/`

### AI summaries not working

1. Verify `summarization.enabled` is `true` in config
2. Check model is valid: `sonnet`, `opus`, or `haiku`
3. View background log: `cat /tmp/cc-obsidian-mem-background.log` (Linux/Mac) or `%TEMP%\cc-obsidian-mem-background.log` (Windows)
4. Ensure Claude CLI is available: `which claude`

### Claude not using memory tools proactively

1. Add the memory system instructions to your project's `CLAUDE.md` (see Step 4 above)
2. Or add to global `~/.claude/CLAUDE.md` for all projects
3. You can also ask Claude directly: "search memory for..."

---

## Development

### Project Structure

```
cc-obsidian-mem/
├── .claude-plugin/
│   └── marketplace.json     # Marketplace manifest
├── plugin/
│   ├── .claude-plugin/
│   │   └── plugin.json      # Plugin manifest
│   ├── .mcp.json            # MCP server config
│   ├── hooks/
│   │   ├── hooks.json       # Hook definitions
│   │   └── scripts/         # Hook scripts
│   ├── scripts/             # Utility scripts
│   ├── skills/              # Skill definitions
│   └── src/
│       ├── mcp-server/      # MCP server
│       ├── services/        # AI services
│       └── shared/          # Shared utilities
```

### Running Tests

```bash
cd plugin && bun test
```

### Building

```bash
cd plugin && bun run build
```

---

## License

MIT

## Credits

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by thedotmack.

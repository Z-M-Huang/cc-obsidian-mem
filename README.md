# cc-obsidian-mem

Obsidian-based persistent memory system for Claude Code. Automatically captures session activity, errors, decisions, and patterns into a browsable, visualizable knowledge base.

## Documentation

**New to cc-obsidian-mem?** Check out the **[Wiki](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki)** for comprehensive guides:

| Guide | Description |
|-------|-------------|
| [Getting Started](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki/Getting-Started) | Step-by-step setup for beginners |
| [Installation](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki/Installation) | Detailed installation instructions |
| [Configuration](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki/Configuration) | All configuration options explained |
| [MCP Tools](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki/MCP-Tools) | Tools Claude uses to access memory |
| [Skills](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki/Skills) | Slash commands (`/mem-search`, `/mem-save`, etc.) |
| [Vault Structure](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki/Vault-Structure) | How knowledge is organized |
| [Troubleshooting](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki/Troubleshooting) | Common issues and solutions |
| [FAQ](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki/FAQ) | Frequently asked questions |

## Features

- **Automatic Capture**: Hooks automatically track file edits, commands, and errors
- **Exploration Tracking**: Captures codebase exploration (files read, search patterns used)
- **AI Summaries**: Claude-powered knowledge extraction from conversations with Zod validation
- **Obsidian Integration**: Full Obsidian syntax support with Dataview queries for visualization
- **Canvas Visualizations**: Auto-generated dashboard, timeline, and graph canvases
- **File-Based Indexing**: JSON index files for faster search operations
- **Session Summaries**: Creates session summary notes with exploration history
- **Project Organization**: Memories organized by project with cross-project patterns
- **MCP Tools**: Search, read, and write memories directly from Claude Code
- **Skills**: User-invokable commands (`/mem-search`, `/mem-save`, `/mem-status`)

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime installed
- [Obsidian](https://obsidian.md/) with an existing vault
- [Dataview plugin](https://github.com/blacksmithgu/obsidian-dataview) (recommended for dashboards)
- Claude Code CLI **v1.0.49 or later** (required for `--no-session-persistence` flag)
  - Check your version: `claude --version`
  - Upgrade if needed: `npm install -g @anthropic-ai/claude-code`

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
  "logging": {
    "verbose": false
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
    "model": "sonnet",
    "sessionSummary": true,
    "errorSummary": true,
    "timeout": 180000
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
  },
  "processing": {
    "frequency": "compact-only",
    "periodicInterval": 10
  },
  "deduplication": {
    "enabled": true,
    "threshold": 0.6
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

| Tool                  | Use When                                                 |
| --------------------- | -------------------------------------------------------- |
| `mem_search`          | Looking for past decisions, errors, patterns, or context |
| `mem_read`            | Need full content of a specific note                     |
| `mem_write`           | Saving important decisions, patterns, or learnings       |
| `mem_write_knowledge` | Saving Q&A, explanations, research from conversations    |
| `mem_supersede`       | Updating/replacing outdated information                  |
| `mem_project_context` | Starting work on a project (get recent context)          |
| `mem_list_projects`   | Need to see all tracked projects                         |
| `mem_generate_canvas` | Generate Obsidian canvas visualizations                  |
| `mem_file_ops`        | Delete, move, or create directories in the vault         |

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

### Updating the Plugin

When updating to a new version, we recommend a clean reinstall:

```bash
# 1. Uninstall the current version
/plugin uninstall cc-obsidian-mem

# 2. Reinstall from marketplace
/plugin install cc-obsidian-mem

# 3. Restart Claude Code session
# Exit and start a new Claude session to load the updated hooks
```

> **Note**: Your configuration file (`~/.cc-obsidian-mem/config.json`) and all knowledge in your Obsidian vault are preserved during reinstall. Only the plugin code is updated.

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

| Tool                  | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `mem_search`          | Search notes by query, project, type, or tags                           |
| `mem_read`            | Read a specific note's content                                          |
| `mem_write`           | Create or update notes (error, decision, pattern, file, learning)       |
| `mem_write_knowledge` | Write knowledge notes (qa, explanation, decision, research, learning)   |
| `mem_supersede`       | Create a new note that supersedes an existing one (bidirectional links) |
| `mem_project_context` | Get context for a project                                               |
| `mem_list_projects`   | List all tracked projects                                               |
| `mem_generate_canvas` | Generate canvas visualizations (dashboard, timeline, graph)             |
| `mem_file_ops`        | Cross-platform file operations (delete, move, mkdir) for vault cleanup  |

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

| Hook               | Purpose                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `SessionStart`     | Initialize session tracking, inject project context, migrate pending files |
| `UserPromptSubmit` | Track user prompts                                                         |
| `PostToolUse`      | Capture observations, extract knowledge from web tools                     |
| `PreCompact`       | Trigger background AI summarization before `/compact`                      |
| `SessionEnd`       | Generate canvas visualizations, cleanup session files                      |

---

## Vault Structure

```
vault/
├── _claude-mem/
│   ├── index.md                     # Dashboard with Dataview queries
│   ├── projects/
│   │   └── {project-name}/
│   │       ├── {project-name}.md    # Project overview
│   │       ├── _index.json          # Project index (auto-generated for fast search)
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
│   │       ├── sessions/            # Session summary notes
│   │       │   └── *.md             # {date}_{session_id}.md
│   │       └── canvases/
│   │           ├── dashboard.canvas # Grid layout by folder type
│   │           ├── timeline.canvas  # Decisions chronologically
│   │           └── graph.canvas     # Radial knowledge graph
│   ├── global/
│   │   ├── patterns/                # Reusable cross-project patterns
│   │   └── knowledge/               # General learnings
│   └── templates/                   # Note templates
```

> **Note**: Session data is stored ephemerally in `~/.cc-obsidian-mem/sessions/` during active sessions (including `{session_id}.json` for state and `{session_id}.exploration.jsonl` for exploration tracking) and cleaned up when sessions end. Only persistent knowledge is stored in the vault.

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

For detailed troubleshooting, see the [Troubleshooting Wiki](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki/Troubleshooting).

**Quick fixes:**

| Problem | Solution |
|---------|----------|
| Plugin not loading | Run `/plugin list` to verify, restart Claude Code |
| No data captured | Check config exists at `~/.cc-obsidian-mem/config.json` |
| AI summaries not working | Verify `summarization.enabled: true` in config |
| Claude not using memory | Add memory instructions to your `CLAUDE.md` (see Step 4) |

**Enable debug logging:**

```json
"logging": { "verbose": true }
```

Then view: `tail -f /tmp/cc-obsidian-mem-*.log`

### `--continue` picks up wrong session

If Claude's `--continue` command picks up an agent session instead of your actual conversation, this is caused by polluted session files from cc-obsidian-mem's background processes.

**This was fixed in v1.0.4+** by using the `--no-session-persistence` flag. The cleanup below is only needed for sessions created with older versions.

**Option 1: Delete all session history (simplest)**

This removes all Claude Code session history. You won't be able to `--continue` any previous sessions.

- **Windows:** Delete all contents in `%USERPROFILE%\.claude\projects`
- **macOS/Linux:** `rm -rf ~/.claude/projects/*`

**Option 2: Targeted cleanup (preserves other sessions)**

Only removes sessions polluted by cc-obsidian-mem:

**Windows (PowerShell):**

```powershell
Get-ChildItem "$env:USERPROFILE\.claude\projects" -Recurse -Filter "*.jsonl" |
  Where-Object { (Get-Content $_.FullName -Raw) -match "cc-mem-agent|cc-obsidian-mem-" } |
  Remove-Item -Force
Get-ChildItem "$env:USERPROFILE\.claude\projects" -Recurse -Filter "sessions-index.json" |
  Remove-Item -Force
```

**macOS/Linux:**

```bash
grep -rl "cc-mem-agent\|cc-obsidian-mem-" ~/.claude/projects --include="*.jsonl" | xargs rm -f
find ~/.claude/projects -name "sessions-index.json" -delete
```

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
│   ├── tests/               # Test files
│   └── src/
│       ├── vault/           # Vault management (read/write/search), canvas generation
│       ├── summarizer/      # AI-powered knowledge extraction
│       ├── mcp-server/      # MCP tools (mem_search, mem_write, etc.)
│       ├── session-end/     # Background session processing
│       ├── sqlite/          # SQLite database operations
│       ├── context/         # Context injection for prompts
│       ├── sdk/             # SDK agent integration
│       ├── shared/          # Types, config, validation, logging
│       ├── cli/             # Setup CLI
│       ├── fallback/        # JSON fallback storage
│       └── worker/          # Background worker service
```

### Topic-Based Filenames (Deduplication)

Knowledge notes use **topic-based filenames** instead of date-prefixed filenames. This prevents duplicate notes on the same topic:

- Notes are named `authentication-bug.md` instead of `2026-01-15_authentication-bug.md`
- When new knowledge matches an existing topic, it's **appended** to the existing note
- Each entry within a note has a timestamp header (`## Entry: YYYY-MM-DD HH:MM`)

**Deduplication Algorithm** (v1.0.4+):

- Uses **Jaccard word similarity** to match topics with similar (not just identical) titles
- Searches **across all categories** to find similar topics, but only appends to **same-category** matches
- Default threshold: 60% similarity (configurable)
- Stopwords (common words like "the", "for", "in") are filtered before comparison
- Falls back to exact slug matching for single-word titles

**Configuration** (add to `~/.cc-obsidian-mem/config.json`):

```json
"deduplication": {
  "enabled": true,
  "threshold": 0.6
}
```

| Option      | Values        | Description                                    |
| ----------- | ------------- | ---------------------------------------------- |
| `enabled`   | `true`/`false`| Enable cross-category deduplication (default: `true`) |
| `threshold` | 0.0 - 1.0     | Similarity threshold (default: `0.6` = 60%)    |

**Migration for existing vaults**: Existing date-prefixed notes continue to work. New knowledge will use topic-based filenames. You can manually merge duplicate notes if desired.

### Running Tests

```bash
cd plugin && bun test
```

### Building

```bash
cd plugin && bun run build
```

---

## Support

- **Documentation:** [Wiki](https://github.com/Z-M-Huang/cc-obsidian-mem/wiki)
- **Bug Reports:** [GitHub Issues](https://github.com/Z-M-Huang/cc-obsidian-mem/issues)
- **Questions:** [GitHub Discussions](https://github.com/Z-M-Huang/cc-obsidian-mem/discussions)

## License

MIT

## Credits

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by thedotmack.

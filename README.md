# cc-obsidian-mem

Obsidian-based persistent memory system for Claude Code. Automatically captures session activity, errors, decisions, and patterns into a browsable, visualizable knowledge base.

## Features

- **Automatic Capture**: Session hooks automatically log file edits, commands, and errors
- **AI Summaries**: Claude-powered session summaries and error analysis
- **Obsidian Integration**: Full Obsidian syntax support with Dataview queries for visualization
- **Project Organization**: Memories organized by project with cross-project patterns
- **MCP Tools**: Search, read, and write memories directly from Claude Code
- **Skills**: User-invokable commands (`/mem-search`, `/mem-save`, `/mem-status`)

## Architecture

```
┌──────────────┐     ┌─────────────┐     ┌────────────────┐
│ Claude Code  │◄───►│ MCP Server  │◄───►│ Obsidian Vault │
└──────┬───────┘     └─────────────┘     └────────────────┘
       │                    ▲
       ▼                    │
┌──────────────┐     ┌─────────────┐
│    Hooks     │────►│   Worker    │
│ (Lifecycle)  │     │  (HTTP API) │
└──────────────┘     └─────────────┘
```

## Installation

### Prerequisites

- [Bun](https://bun.sh/) runtime
- [Obsidian](https://obsidian.md/) (with Dataview plugin recommended)
- Claude Code

### Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/Z-M-Huang/cc-obsidian-mem.git
   cd cc-obsidian-mem
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Run the setup wizard:
   ```bash
   bun run setup
   ```

4. Install as a Claude Code plugin:
   ```bash
   claude-code plugin install /path/to/cc-obsidian-mem
   ```

## Configuration

Configuration is stored at `~/.cc-obsidian-mem/config.json`:

```json
{
  "vault": {
    "path": "/path/to/your/obsidian/vault",
    "memFolder": "_claude-mem"
  },
  "worker": {
    "port": 37781,
    "autoStart": true
  },
  "capture": {
    "fileEdits": true,
    "bashCommands": true,
    "errors": true,
    "decisions": true,
    "bashOutput": {
      "enabled": true,
      "maxLength": 5000
    }
  },
  "summarization": {
    "enabled": true,
    "model": "claude-sonnet-4-5-20250514",
    "apiKeyEnvVar": "ANTHROPIC_API_KEY"
  },
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000,
    "includeRecentSessions": 3
  }
}
```

## Usage

### Automatic Capture

Once installed, the plugin automatically:
- Logs file edits, bash commands, and errors during sessions
- Creates session notes with observations
- Updates error patterns when recurring issues occur
- Generates AI summaries at session end (if enabled)

### Skills (User Commands)

#### `/mem-search` - Search your knowledge base
```
/mem-search authentication error fix
/mem-search database schema decisions
/mem-search recent sessions
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

The MCP server provides these tools:

| Tool | Description |
|------|-------------|
| `mem_search` | Search notes by query, project, type, or tags |
| `mem_read` | Read a specific note's content |
| `mem_write` | Create or update notes |
| `mem_project_context` | Get context for a project |
| `mem_list_projects` | List all tracked projects |

## Vault Structure

```
vault/
├── _claude-mem/
│   ├── _index.md                # Dashboard with Dataview queries
│   ├── projects/
│   │   └── {project-name}/
│   │       ├── _index.md        # Project overview
│   │       ├── sessions/        # Session logs
│   │       ├── errors/          # Error patterns
│   │       ├── decisions/       # Architectural decisions
│   │       └── files/           # File-specific knowledge
│   ├── global/
│   │   ├── patterns/            # Reusable patterns
│   │   ├── tools/               # Tool usage notes
│   │   └── learnings/           # General learnings
│   └── templates/               # Note templates
```

## Obsidian Features Used

- **Frontmatter/Properties**: YAML metadata for filtering and Dataview
- **Wikilinks**: `[[Note]]`, `[[Note#heading]]` for navigation
- **Callouts**: `> [!warning]`, `> [!success]` for visual highlighting
- **Dataview queries**: Dynamic dashboards and indexes
- **Graph view**: Visualize connections between notes
- **Tags**: `#session`, `#error`, `#project/name` for organization

## Development

### Running the worker service manually:
```bash
bun run dev:worker
```

### Running the MCP server manually:
```bash
bun run dev:mcp
```

### Building:
```bash
bun run build
```

## Troubleshooting

### Worker not starting
1. Check if port 37781 is available
2. Try running manually: `bun run src/worker/index.ts`
3. Check logs for errors

### No data being captured
1. Verify hooks are installed in `.claude/hooks.json`
2. Check vault path is correct and writable
3. Ensure worker is running: `curl http://localhost:37781/health`

### AI summaries not working
1. Verify `ANTHROPIC_API_KEY` is set
2. Check `summarization.enabled` is `true` in config
3. Ensure API key has access to the configured model

## License

MIT

## Credits

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by thedotmack.

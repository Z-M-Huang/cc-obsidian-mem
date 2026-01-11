# cc-obsidian-mem

Obsidian-based persistent memory system for Claude Code. Automatically captures session activity, errors, decisions, and patterns into a browsable, visualizable knowledge base.

## Features

- **Automatic Capture**: Session hooks log file edits, commands, errors, and web research
- **AI Summaries**: Claude-powered session summaries and knowledge extraction
- **Obsidian Integration**: Full Obsidian syntax support with Dataview queries
- **Project Organization**: Memories organized by project with cross-project patterns
- **MCP Tools**: Search, read, write, and supersede memories from Claude Code
- **TechKB Integration**: Optional Johnny Decimal organization for technical documentation
- **HTTP/SSE Deployment**: Remote access via Docker with Traefik and OAuth support
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
    "model": "sonnet",
    "sessionSummary": true,
    "errorSummary": true
  },
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000,
    "includeRecentSessions": 3,
    "includeRelatedErrors": true,
    "includeProjectPatterns": true
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
- Logs file edits, bash commands, and errors during sessions
- Creates session notes with observations
- Extracts knowledge from web searches and documentation lookups
- Generates AI summaries when you run `/compact` or end a session

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

These tools are available to Claude during conversations:

| Tool | Description |
|------|-------------|
| `mem_search` | Search notes by query, project, type, or tags |
| `mem_read` | Read a specific note's content |
| `mem_write` | Create or update notes |
| `mem_supersede` | Create a new note that supersedes an existing one (bidirectional links) |
| `mem_project_context` | Get context for a project |
| `mem_list_projects` | List all tracked projects |

---

## TechKB Integration

For users with existing Johnny Decimal-organized documentation, the plugin supports TechKB integration.

### Enable TechKB

Add to your `~/.cc-obsidian-mem/config.json`:

```json
{
  "techkb": {
    "enabled": true,
    "basePath": "TechKB",
    "projectFolder": "10-projects",
    "categoryMapping": {
      "projects": "10-projects",
      "clients": "20-clients",
      "servers": "30-servers",
      "containers": "31-containers",
      "networking": "32-networking",
      "troubleshooting": "60-troubleshooting",
      "guides": "70-guides",
      "hardware": "80-hardware",
      "software": "81-software",
      "commands": "82-commands",
      "resources": "90-resources"
    }
  }
}
```

### TechKB Tools

| Tool | Description |
|------|-------------|
| `mem_techkb_categories` | List available TechKB categories |
| `mem_techkb_write` | Write notes to TechKB with automatic path resolution |
| `mem_techkb_search` | Search TechKB by category and query |

### TechKB Vault Structure

```
vault/
└── TechKB/
    ├── 10-projects/           # Active projects with _claude-mem
    ├── 20-clients/            # Client information
    ├── 30-servers/            # Server configurations
    ├── 31-containers/         # Docker/Kubernetes
    ├── 32-networking/         # DNS, VPNs, Traefik
    ├── 60-troubleshooting/    # Error solutions
    ├── 70-guides/             # How-to guides
    ├── 80-hardware/           # Hardware specs
    ├── 81-software/           # Software configs
    ├── 82-commands/           # CLI cheatsheets
    └── 90-resources/          # Bookmarks, templates
```

See `plugin/docs/TECHKB-INTEGRATION.md` for the complete setup guide.

---

## HTTP/SSE Deployment

For remote access via Claude.ai or other HTTP clients, deploy as a Docker container.

### Quick Deploy

```bash
cd plugin

# Configure environment
cp .env.example .env
# Edit .env: set VAULT_PATH, DOMAIN, BEARER_TOKEN

# Deploy with Docker Compose
docker compose up -d
```

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `/mcp` | Streamable HTTP (recommended, protocol 2025-03-26+) |
| `/sse` + `/messages` | Legacy SSE transport |
| `/health` | Health check (no auth required) |
| `/.well-known/oauth-protected-resource` | RFC 9728 OAuth metadata |

### Authentication

The HTTP server supports multiple authentication methods:

1. **Bearer Token**: Simple token-based authentication
2. **Cloudflare Access OAuth 2.0**: RFC 9728 protected resource metadata
3. **Both**: Accept either method

Configure via environment variables:
```bash
AUTH_MODE=both              # bearer, oauth, or both
BEARER_TOKEN=your-secret
CF_ACCESS_AUD=your-aud-tag
```

### Docker Features

- Non-root user (mcpuser, UID 1001)
- Built-in health checks
- JSON logging with rotation
- Resource limits (1 CPU, 512M memory)
- Traefik integration with automatic HTTPS
- Watchtower auto-update support

See `plugin/docs/HTTP-DEPLOYMENT.md` for the complete deployment guide.

---

## Architecture

```
┌──────────────┐     ┌─────────────────┐     ┌────────────────┐
│ Claude Code  │◄───►│   MCP Server    │◄───►│ Obsidian Vault │
│              │     │ (stdio or HTTP) │     │                │
└──────┬───────┘     └─────────────────┘     └────────────────┘
       │
       ▼
┌──────────────┐     ┌─────────────────┐     ┌────────────────┐
│    Hooks     │────►│  Session Store  │────►│   AI Services  │
│ (Lifecycle)  │     │  (File-based)   │     │ (Summarizer)   │
└──────────────┘     └─────────────────┘     └────────────────┘
```

### Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| `SessionStart` | Session begins | Initialize session, inject recent context |
| `UserPromptSubmit` | User submits prompt | Track user prompts |
| `PostToolUse` | Tool completes | Capture file edits, commands, errors, knowledge |
| `PreCompact` | Before `/compact` | Spawn background knowledge extraction |
| `Stop` | User stops session | Mark session as stopped |
| `SessionEnd` | Session ends | Persist to vault, generate AI summaries |

### AI Services

| Service | Purpose |
|---------|---------|
| **Summarizer** | AI-powered content summarization using Claude Agent SDK |
| **Knowledge Extractor** | Extract Q&A pairs, research, patterns from conversations |
| **Transcript Parser** | Parse JSONL transcripts to rebuild conversation context |

### Session Management

- **Multi-session Support**: Concurrent session tracking with unique IDs
- **Atomic Writes**: File-based storage with lock-based observation appending
- **Background Processing**: Non-blocking summarization using `claude -p` CLI
- **Knowledge Tracking**: Pre-compact knowledge capture before compaction

---

## Vault Structure

```
vault/
├── _claude-mem/
│   ├── index.md                     # Dashboard with Dataview queries
│   ├── projects/
│   │   └── {project-name}/
│   │       ├── {project-name}.md    # Project overview
│   │       ├── sessions/
│   │       │   ├── sessions.md      # Category index
│   │       │   └── *.md             # Session logs
│   │       ├── errors/
│   │       │   ├── errors.md        # Category index
│   │       │   └── *.md             # Error patterns
│   │       ├── decisions/
│   │       │   ├── decisions.md     # Category index
│   │       │   └── *.md             # Architectural decisions
│   │       ├── knowledge/
│   │       │   ├── knowledge.md     # Category index
│   │       │   └── *.md             # Q&A, explanations, research
│   │       ├── research/
│   │       │   ├── research.md      # Category index
│   │       │   └── *.md             # External research notes
│   │       └── files/
│   │           ├── files.md         # Category index
│   │           └── *.md             # File-specific knowledge
│   ├── global/
│   │   ├── patterns/                # Reusable patterns
│   │   ├── tools/                   # Tool usage notes
│   │   └── learnings/               # General learnings
│   └── templates/                   # Note templates
```

### Note Linking

Notes follow a hierarchical linking structure for Obsidian graph navigation:
- Individual notes link to their category index via `parent` frontmatter
- Category indexes link to the project base
- Superseded notes have bidirectional links (`superseded_by` ↔ `supersedes`)

### Knowledge Types

| Type | Description |
|------|-------------|
| `qa` | Question-answer pairs extracted from conversations |
| `explanation` | Detailed explanations of concepts |
| `decision` | Architectural and design decisions with rationale |
| `research` | External research and documentation notes |
| `learning` | General insights and learnings |

---

## Obsidian Features Used

- **Frontmatter/Properties**: YAML metadata for filtering and Dataview
- **Wikilinks**: `[[Note]]`, `[[Note#heading]]` for navigation
- **Callouts**: `> [!warning]`, `> [!success]` for visual highlighting
- **Dataview queries**: Dynamic dashboards and indexes
- **Graph view**: Visualize connections between notes
- **Tags**: `#session`, `#error`, `#project/name` for organization

---

## Configuration Reference

### Full Configuration Example

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
    "model": "sonnet",
    "sessionSummary": true,
    "errorSummary": true
  },
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000,
    "includeRecentSessions": 3,
    "includeRelatedErrors": true,
    "includeProjectPatterns": true
  },
  "techkb": {
    "enabled": false,
    "basePath": "TechKB",
    "projectFolder": "10-projects",
    "categoryMapping": {
      "projects": "10-projects",
      "servers": "30-servers",
      "troubleshooting": "60-troubleshooting",
      "guides": "70-guides"
    },
    "defaultFrontmatter": {
      "author": "Claude"
    }
  }
}
```

### Configuration Sections

| Section | Description |
|---------|-------------|
| `vault` | Obsidian vault location and memory folder name |
| `capture` | What to capture: file edits, commands, errors, decisions |
| `summarization` | AI summarization settings and model selection |
| `contextInjection` | Context injection at session start |
| `techkb` | Optional TechKB integration settings |

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

### HTTP/SSE deployment issues

1. Check container logs: `docker compose logs -f`
2. Verify health endpoint: `curl https://your-domain/health`
3. Check authentication: ensure `BEARER_TOKEN` matches your client config
4. Verify vault mount: ensure the vault path is correctly mounted

---

## Development

### Project Structure

```
cc-obsidian-mem/
├── .claude/                      # Claude Code configuration
│   ├── settings.local.json       # Permissions, hooks, status line
│   └── scripts/                  # Helper scripts
├── .claude-plugin/
│   └── marketplace.json          # Marketplace manifest
├── plugin/
│   ├── .claude-plugin/
│   │   └── plugin.json           # Plugin manifest
│   ├── .mcp.json                 # MCP server config
│   ├── Dockerfile                # Container image for HTTP server
│   ├── docker-compose.yml        # Docker Compose with Traefik
│   ├── docs/                     # Documentation
│   │   ├── HTTP-DEPLOYMENT.md    # HTTP/SSE deployment guide
│   │   └── TECHKB-INTEGRATION.md # TechKB setup guide
│   ├── hooks/
│   │   ├── hooks.json            # Hook definitions
│   │   └── scripts/              # Hook implementations
│   ├── scripts/                  # Utility scripts
│   │   └── backfill-parent-links.ts
│   ├── skills/                   # Skill definitions
│   │   ├── development-guidelines/
│   │   ├── mem-save/
│   │   ├── mem-search/
│   │   ├── mem-status/
│   │   └── testing-process/
│   ├── src/
│   │   ├── cli/                  # Setup CLI
│   │   ├── mcp-server/           # MCP server (stdio + HTTP)
│   │   │   ├── index.ts          # Stdio transport entry
│   │   │   ├── http-server.ts    # HTTP/SSE transport
│   │   │   └── utils/            # Vault, frontmatter, wikilinks
│   │   ├── services/             # AI services
│   │   │   ├── summarizer.ts     # Content summarization
│   │   │   ├── knowledge-extractor.ts
│   │   │   └── transcript.ts     # JSONL parsing
│   │   └── shared/               # Shared utilities
│   │       ├── config.ts         # Configuration loading
│   │       ├── session-store.ts  # Session management
│   │       ├── types.ts          # TypeScript types
│   │       └── constants.ts      # Constants and defaults
│   └── tests/                    # Test suite
```

### Running Tests

```bash
cd plugin
bun test              # Run all tests
bun test --watch      # Watch mode
bunx tsc --noEmit     # Type check only
```

### Building

```bash
cd plugin && bun run build
```

### Local Development

```bash
# Install from local path
claude /plugin install /path/to/cc-obsidian-mem/plugin

# Uninstall
claude /plugin uninstall cc-obsidian-mem

# Check installed plugins
claude /plugin list
```

### Version Bump Checklist

When releasing a new version, update the version number in **all three files**:

| File | Field |
|------|-------|
| `plugin/package.json` | `version` |
| `plugin/.claude-plugin/plugin.json` | `version` |
| `.claude-plugin/marketplace.json` | `plugins[0].version` |

### Development Skills

| Skill | Description |
|-------|-------------|
| `/testing-process` | Guidelines for TypeScript/Bun testing |
| `/development-guidelines` | Best practices for cc-obsidian-mem development |

---

## License

MIT

## Credits

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by thedotmack.

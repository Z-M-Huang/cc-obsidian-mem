# TechKB Integration

cc-obsidian-mem supports integration with TechKB-style vaults that use Johnny Decimal organization (10-projects, 30-infrastructure, etc.).

## Overview

When TechKB integration is enabled:

1. **Project memory** is stored in `TechKB/10-projects/{project}/_claude-mem/`
2. **General knowledge** can be written to any TechKB category (infrastructure, hardware, troubleshooting, etc.)

## Configuration

Add to your `~/.cc-obsidian-mem/config.json`:

```json
{
  "vault": {
    "path": "/path/to/your/vault",
    "memFolder": "_claude-mem"
  },
  "techkb": {
    "enabled": true,
    "basePath": "TechKB",
    "projectFolder": "10-projects",
    "categoryMapping": {
      "infrastructure": "30-infrastructure",
      "mcp-servers": "30-infrastructure/35-mcp-servers",
      "docker": "30-infrastructure/docker",
      "development": "40-development",
      "troubleshooting": "60-troubleshooting",
      "hardware": "80-reference/hardware",
      "software": "80-reference/software",
      "reference": "80-reference"
    }
  }
}
```

## Default Categories

The following categories are available by default:

| Category Key | Path | Description |
|--------------|------|-------------|
| `projects` | `10-projects` | Project-specific documentation |
| `infrastructure` | `30-infrastructure` | Infrastructure docs, servers, networking |
| `mcp-servers` | `30-infrastructure/35-mcp-servers` | MCP server configurations |
| `docker` | `30-infrastructure/docker` | Docker and container configs |
| `development` | `40-development` | Development guides and patterns |
| `troubleshooting` | `60-troubleshooting` | Error solutions, debugging guides |
| `hardware` | `80-reference/hardware` | Hardware specs, VPS configs |
| `software` | `80-reference/software` | Software configurations |
| `reference` | `80-reference` | General reference docs |

## Custom Categories

Add custom categories by extending the `categoryMapping` in your config:

```json
{
  "techkb": {
    "categoryMapping": {
      "networking": "30-infrastructure/networking",
      "databases": "30-infrastructure/databases",
      "security": "40-development/security"
    }
  }
}
```

## MCP Tools

Three TechKB-specific tools are available:

### `mem_techkb_categories`

List all available TechKB categories:

```
mem_techkb_categories
```

### `mem_techkb_write`

Write a note to a TechKB category:

```json
{
  "category": "hardware",
  "title": "VPS Contabo CX51 Specifications",
  "content": "## Specifications\n\n- CPU: 8 vCPU\n- RAM: 24 GB\n- Storage: 200 GB NVMe\n- Network: 32 TB traffic",
  "tags": ["vps", "contabo", "hosting"]
}
```

Parameters:
- `category` (required): Category key or path relative to TechKB base
- `title` (required): Note title
- `content` (required): Markdown content (title heading added automatically)
- `tags` (optional): Additional tags
- `filename` (optional): Custom filename without .md extension
- `append` (optional): Append to existing note instead of creating new
- `metadata` (optional): Additional frontmatter fields

### `mem_techkb_search`

Search TechKB notes:

```json
{
  "query": "docker compose traefik",
  "category": "infrastructure",
  "limit": 10
}
```

## Vault Structure

With TechKB enabled, your vault structure becomes:

```
vault/
├── TechKB/
│   ├── 10-projects/
│   │   ├── my-project/
│   │   │   └── _claude-mem/         # Project memory
│   │   │       ├── sessions/
│   │   │       ├── decisions/
│   │   │       ├── errors/
│   │   │       └── knowledge/
│   │   └── another-project/
│   │       └── _claude-mem/
│   ├── 30-infrastructure/
│   │   ├── 35-mcp-servers/          # MCP server docs
│   │   ├── docker/                   # Docker configs
│   │   └── networking/               # Network docs
│   ├── 60-troubleshooting/          # Error solutions
│   └── 80-reference/
│       ├── hardware/                 # Hardware specs
│       └── software/                 # Software configs
└── _claude-mem/                      # Global memory (if not using TechKB)
    └── global/
```

## Default Frontmatter

Configure default frontmatter for all TechKB notes:

```json
{
  "techkb": {
    "defaultFrontmatter": {
      "type": "note",
      "author": "Claude Code"
    }
  }
}
```

## Example Workflows

### Documenting Hardware Specs

```
Use mem_techkb_write with:
- category: "hardware"
- title: "Raspberry Pi 5 Home Server"
- content: Specifications and configuration details
```

### Recording Troubleshooting Steps

```
Use mem_techkb_write with:
- category: "troubleshooting"
- title: "Docker Container Permission Denied Fix"
- content: Problem description and solution steps
```

### Searching Infrastructure Docs

```
Use mem_techkb_search with:
- query: "cloudflare tunnel"
- category: "infrastructure"
```

## Integration with Project Memory

TechKB integration works alongside regular project memory:

- Use `mem_write` for project-specific decisions, errors, sessions
- Use `mem_techkb_write` for general knowledge that applies across projects
- Use `mem_search` for project memory
- Use `mem_techkb_search` for TechKB knowledge

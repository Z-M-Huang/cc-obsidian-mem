# TechKB Integration

cc-obsidian-mem supports integration with TechKB-style vaults that use Johnny Decimal organization.

## Overview

When TechKB integration is enabled:

1. **Project memory** is stored in `TechKB/10-projects/{project}/_claude-mem/`
2. **Client info** is stored in `TechKB/20-clients/{client}/`
3. **General knowledge** can be written to any TechKB category (servers, hardware, troubleshooting, etc.)

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
    "projectFolder": "10-projects"
  }
}
```

## Default Categories

The following categories are available by default:

| Category Key | Path | Description |
|--------------|------|-------------|
| `projects` | `10-projects` | Active project codebases and memory |
| `clients` | `20-clients` | Client info, contracts, preferences |
| `servers` | `30-servers` | Server configs, VPS setup |
| `containers` | `31-containers` | Docker, Kubernetes, Podman |
| `networking` | `32-networking` | DNS, VPNs, Cloudflare, Traefik |
| `troubleshooting` | `60-troubleshooting` | Error solutions, debugging |
| `guides` | `70-guides` | How-to guides, tutorials, runbooks |
| `hardware` | `80-hardware` | Hardware specs, VPS specs |
| `software` | `81-software` | Software configs, tool settings |
| `commands` | `82-commands` | Command cheatsheets, CLI references |
| `resources` | `90-resources` | Bookmarks, vendor docs, templates |

## Custom Categories

Add custom categories by extending the `categoryMapping` in your config:

```json
{
  "techkb": {
    "categoryMapping": {
      "databases": "33-databases",
      "security": "34-security",
      "automation": "50-automation"
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
  "category": "containers",
  "limit": 10
}
```

## Vault Structure

With TechKB enabled, your vault structure becomes:

```
vault/
└── TechKB/
    ├── 10-projects/                    # Active project work
    │   ├── acme-website/
    │   │   └── _claude-mem/            # Project memory
    │   │       ├── sessions/
    │   │       ├── decisions/
    │   │       ├── errors/
    │   │       └── knowledge/
    │   └── personal-portfolio/
    │       └── _claude-mem/
    │
    ├── 20-clients/                     # Client relationships
    │   ├── acme-corp/
    │   │   ├── acme-corp.md            # Client overview
    │   │   ├── contracts/
    │   │   └── communications/
    │   └── bobs-plumbing/
    │
    ├── 30-servers/                     # Infrastructure cluster
    ├── 31-containers/
    ├── 32-networking/
    │
    ├── 60-troubleshooting/             # Problem-solving
    │
    ├── 70-guides/                      # Learning cluster
    │
    ├── 80-hardware/                    # Reference cluster
    ├── 81-software/
    ├── 82-commands/
    │
    └── 90-resources/                   # Meta cluster
```

## Client Workflow

For freelance/agency work with multiple clients:

### 1. New Client Onboard

```
mem_techkb_write category="clients" title="Acme Corp" filename="acme-corp"
content="## Contact
- John Smith (john@acme.com)
- Budget: $5k/month

## Preferences
- Prefers Next.js + Tailwind
- Weekly standups Friday 2pm
- Communication via Slack"
```

### 2. Start Their Project

When you start working on `acme-website`, Claude Code automatically creates:
- `10-projects/acme-website/_claude-mem/` for project memory

### 3. Reference Client Preferences

```
mem_techkb_search query="Acme preferences" category="clients"
```

## Project Naming Convention

For client projects, use `{client}-{project-type}`:

```
10-projects/
├── acme-website/           # Acme Corp's marketing site
├── acme-dashboard/         # Acme Corp's internal dashboard
├── bobs-plumbing-site/     # Bob's Plumbing website
└── personal-portfolio/     # Your own projects
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
mem_techkb_write category="hardware" title="Raspberry Pi 5 Home Server"
```

### Recording Troubleshooting Steps

```
mem_techkb_write category="troubleshooting" title="Docker Permission Denied Fix"
```

### Saving a Useful Command

```
mem_techkb_write category="commands" title="Docker Cleanup Commands"
content="## Remove all stopped containers
docker container prune -f

## Remove unused images
docker image prune -a -f"
```

### Creating a Guide

```
mem_techkb_write category="guides" title="Setting Up Traefik with Docker"
```

## Integration with Project Memory

TechKB integration works alongside regular project memory:

| Use Case | Tool | Location |
|----------|------|----------|
| Project decisions | `mem_write` | `10-projects/{project}/_claude-mem/decisions/` |
| Project errors | `mem_write` | `10-projects/{project}/_claude-mem/errors/` |
| Client info | `mem_techkb_write` | `20-clients/{client}/` |
| Server config | `mem_techkb_write` | `30-servers/` |
| General debugging | `mem_techkb_write` | `60-troubleshooting/` |
| How-to guides | `mem_techkb_write` | `70-guides/` |

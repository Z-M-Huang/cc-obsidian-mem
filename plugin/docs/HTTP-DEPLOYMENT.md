# HTTP/SSE Deployment Guide

This guide covers deploying the cc-obsidian-mem MCP server as an HTTP/SSE service with Traefik reverse proxy.

## Overview

The HTTP server supports two transport protocols:

| Transport | Endpoint | Status | Use Case |
|-----------|----------|--------|----------|
| **Streamable HTTP** | `/mcp` | Recommended | Claude.ai, Claude Code, modern clients |
| **HTTP+SSE** | `/sse` + `/messages` | Deprecated | Legacy client compatibility |

## Quick Start

### 1. Clone and Configure

```bash
cd plugin

# Copy example environment file
cp .env.example .env

# Edit .env with your settings
nano .env
```

### 2. Required Environment Variables

```bash
# Path to your Obsidian vault
VAULT_PATH=/path/to/your/obsidian/vault

# Domain for Traefik routing
DOMAIN=obsidian-mem.yourdomain.com

# Generate a secure bearer token
BEARER_TOKEN=$(openssl rand -base64 32)
```

### 3. Deploy with Docker Compose

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f
```

## Traefik Integration

### Prerequisites

- Traefik running with Docker provider
- External network named `traefik_proxy`
- Certificate resolver configured (e.g., `letsencrypt`)

### Create Traefik Network (if not exists)

```bash
docker network create traefik_proxy
```

### Traefik Labels Explained

The docker-compose.yml includes these Traefik labels:

```yaml
labels:
  # Enable Traefik for this container
  - "traefik.enable=true"

  # HTTP Router - route requests to this service
  - "traefik.http.routers.obsidian-mem.rule=Host(`obsidian-mem.example.com`)"
  - "traefik.http.routers.obsidian-mem.entrypoints=websecure"
  - "traefik.http.routers.obsidian-mem.tls=true"
  - "traefik.http.routers.obsidian-mem.tls.certresolver=letsencrypt"

  # Service - which port to route to
  - "traefik.http.services.obsidian-mem.loadbalancer.server.port=8080"

  # CORS middleware
  - "traefik.http.middlewares.obsidian-mem-cors.headers.accesscontrolallowmethods=GET,POST,DELETE,OPTIONS"
  - "traefik.http.middlewares.obsidian-mem-cors.headers.accesscontrolallowheaders=Content-Type,Authorization,Mcp-Session-Id"
```

## Claude Integration

### Claude.ai (Web)

Add to your Claude.ai MCP configuration:

```json
{
  "mcpServers": {
    "obsidian-mem": {
      "transport": "http",
      "url": "https://obsidian-mem.yourdomain.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "obsidian-mem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-http",
        "https://obsidian-mem.yourdomain.com/mcp",
        "--header",
        "Authorization: Bearer YOUR_TOKEN_HERE"
      ]
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add obsidian-mem https://obsidian-mem.yourdomain.com/mcp \
  --bearer-token YOUR_TOKEN_HERE
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (no auth required) |
| `/mcp` | GET, POST, DELETE | Streamable HTTP transport |
| `/sse` | GET | Legacy SSE connection (deprecated) |
| `/messages` | POST | Legacy message endpoint (deprecated) |

## Health Check

```bash
curl https://obsidian-mem.yourdomain.com/health
```

Response:
```json
{
  "status": "healthy",
  "name": "obsidian-mem",
  "version": "0.3.0",
  "timestamp": "2026-01-11T00:00:00.000Z"
}
```

## Security

### Bearer Token Authentication

All endpoints except `/health` require a valid bearer token:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://obsidian-mem.yourdomain.com/mcp
```

### CORS

The server includes CORS headers for cross-origin requests. Configure allowed origins via:

```bash
ALLOWED_ORIGINS=https://claude.ai,https://your-app.com
```

### TLS/HTTPS

Always use HTTPS in production. Traefik handles TLS termination with Let's Encrypt certificates.

## Monitoring

### Uptime Kuma

Add a monitor with these settings:

```yaml
Monitor Type: HTTP(s)
URL: https://obsidian-mem.yourdomain.com/health
Method: GET
Expected Status: 200
Interval: 60 seconds
```

### Docker Labels for Uptime Kuma Auto-Discovery

```yaml
labels:
  - kuma.obsidian-mem.http.name=Obsidian Memory MCP
  - kuma.obsidian-mem.http.url=https://obsidian-mem.yourdomain.com/health
  - kuma.obsidian-mem.http.interval=60
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs obsidian-mem

# Verify vault path exists
ls -la $VAULT_PATH
```

### Authentication fails

```bash
# Test with curl
curl -v -H "Authorization: Bearer $BEARER_TOKEN" \
  https://obsidian-mem.yourdomain.com/health
```

### CORS issues

Ensure your origin is in `ALLOWED_ORIGINS`:

```bash
ALLOWED_ORIGINS=https://claude.ai,https://your-custom-origin.com
```

### Session issues

The server maintains session state. If sessions expire unexpectedly:

1. Check container memory limits
2. Verify the container hasn't restarted
3. Check logs for session cleanup messages

## Local Development

### Run without Docker

```bash
cd plugin

# Install dependencies
bun install

# Set environment variables
export BEARER_TOKEN=dev-token
export CC_OBSIDIAN_MEM_VAULT_PATH=/path/to/vault

# Run in development mode
bun run dev:http
```

### Build for production

```bash
bun run build:http
bun run start:http
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VAULT_PATH` | Yes | - | Host path to Obsidian vault |
| `DOMAIN` | Yes | - | Public domain for Traefik |
| `BEARER_TOKEN` | Recommended | - | Authentication token |
| `MEM_FOLDER` | No | `_claude-mem` | Folder within vault |
| `ALLOWED_ORIGINS` | No | `https://claude.ai` | CORS allowed origins |
| `CERT_RESOLVER` | No | `letsencrypt` | Traefik cert resolver |
| `TZ` | No | `America/New_York` | Container timezone |
| `MCP_PORT` | No | `8080` | Internal server port |
| `MCP_HOST` | No | `0.0.0.0` | Internal bind address |

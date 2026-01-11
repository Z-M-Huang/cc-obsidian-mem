# cc-obsidian-mem MCP Server
# Dockerfile for HTTP/SSE transport with Traefik

FROM oven/bun:1-alpine

LABEL org.opencontainers.image.source="https://github.com/Z-M-Huang/cc-obsidian-mem"
LABEL org.opencontainers.image.description="Obsidian-based persistent memory MCP server for Claude Code"
LABEL org.opencontainers.image.licenses="MIT"

# Install curl for health checks
RUN apk add --no-cache curl

# Create non-root user
RUN addgroup -g 1000 mcpuser && \
    adduser -u 1000 -G mcpuser -s /bin/sh -D mcpuser

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src/ ./src/

# Build the HTTP server
RUN bun build src/mcp-server/http-server.ts --outdir dist --target bun

# Create vault mount point
RUN mkdir -p /vault && chown mcpuser:mcpuser /vault

# Create config directory
RUN mkdir -p /home/mcpuser/.cc-obsidian-mem && chown -R mcpuser:mcpuser /home/mcpuser

# Switch to non-root user
USER mcpuser

# Environment variables
ENV MCP_PORT=8080
ENV MCP_HOST=0.0.0.0
ENV BEARER_TOKEN=""
ENV ALLOWED_ORIGINS="https://claude.ai"
ENV CC_OBSIDIAN_MEM_VAULT_PATH="/vault"
ENV CC_OBSIDIAN_MEM_FOLDER="_claude-mem"

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run the HTTP server
CMD ["bun", "run", "dist/http-server.js"]

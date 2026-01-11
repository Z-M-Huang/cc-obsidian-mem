---
name: development-guidelines
description: Best practices for developing cc-obsidian-mem. Use during implementation and code review.
---

# Development Guidelines

## Working with Dependencies

1. Use latest stable versions for dependencies.
2. **Never assume how external dependencies work** - always check documentation.
3. Use Context7 MCP to look up documentation for libraries and APIs before implementing.
   - Ensure documentation version matches declared dependency version.
   - Fall back to web search only if Context7 doesn't have the docs.

## TypeScript/Bun Best Practices

### Type Safety
- Prefer explicit types over `any`
- Use strict TypeScript config (already enabled)
- Leverage type inference where it's clear
- Export interfaces for public APIs

### Code Style
- Use single quotes for strings
- 2-space indentation
- No semicolons (Bun style)
- Use async/await over raw promises

### Error Handling
- Use typed errors with meaningful messages
- Handle errors at appropriate boundaries
- Log errors with context for debugging
- Return error states instead of throwing in public APIs

## Project Structure

```
plugin/
├── src/
│   ├── cli/           # Setup CLI
│   ├── mcp-server/    # MCP server (stdio + HTTP)
│   ├── services/      # Business logic
│   └── shared/        # Types, config, utilities
├── hooks/             # Claude Code hooks
├── skills/            # Claude Code skills
└── tests/             # Test files
```

## MCP Development

### Adding New Tools
1. Define the tool schema in `index.ts` (stdio) and `http-server.ts` (HTTP)
2. Implement the handler function
3. Add appropriate input validation using Zod
4. Return structured ToolResult responses

### Testing MCP Tools
- Use the test vault in `tests/fixtures/`
- Mock file system operations where appropriate
- Test both success and error paths

## Memory System Concepts

### Note Types
- `session` - Session activity logs
- `decision` - Architectural decisions
- `error` - Error solutions
- `knowledge` - Learned information
- `learning` - General learnings

### TechKB Categories (when enabled)
- Projects, Clients, Servers, Containers, Networking
- Troubleshooting, Guides, Hardware, Software, Commands, Resources

## Pre-Commit Checklist
- [ ] Tests pass: `bun test`
- [ ] Types check: `bunx tsc --noEmit`
- [ ] No sensitive data committed
- [ ] Clear commit message

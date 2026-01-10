#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { getDefaultConfig, saveConfig, getConfigDir, getMemFolderPath } from '../shared/config.js';
import { VaultManager } from '../mcp-server/utils/vault.js';
import { stringifyFrontmatter, generateFrontmatter } from '../mcp-server/utils/frontmatter.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n🧠 cc-obsidian-mem Setup Wizard\n');
  console.log('This will configure the Obsidian-based memory system for Claude Code.\n');

  const config = getDefaultConfig();

  // Ask for vault path
  const defaultVaultPath = path.join(os.homedir(), 'ObsidianVault');
  const vaultPath = await ask(`Obsidian vault path [${defaultVaultPath}]: `);
  config.vault.path = vaultPath || defaultVaultPath;

  // Ask for memory folder name
  const memFolder = await ask(`Memory folder name [_claude-mem]: `);
  config.vault.memFolder = memFolder || '_claude-mem';

  // Ask about AI summarization
  const enableSummarization = await ask('Enable AI-powered session summaries? (requires ANTHROPIC_API_KEY) [Y/n]: ');
  config.summarization.enabled = !enableSummarization.toLowerCase().startsWith('n');

  if (config.summarization.enabled) {
    const apiKeyEnv = await ask(`Environment variable for API key [ANTHROPIC_API_KEY]: `);
    config.summarization.apiKeyEnvVar = apiKeyEnv || 'ANTHROPIC_API_KEY';

    // Check if API key exists
    if (!process.env[config.summarization.apiKeyEnvVar]) {
      console.log(`\n⚠️  Warning: ${config.summarization.apiKeyEnvVar} not found in environment.`);
      console.log('   AI summarization will be disabled until the API key is set.\n');
    }
  }

  // Save configuration
  console.log('\nSaving configuration...');
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  saveConfig(config);
  console.log(`Configuration saved to: ${path.join(configDir, 'config.json')}`);

  // Create vault structure
  console.log('\nCreating vault structure...');
  const vault = new VaultManager(config.vault.path, config.vault.memFolder);
  await vault.ensureStructure();

  // Create main dashboard
  await createDashboard(config.vault.path, config.vault.memFolder);

  // Create templates
  await createTemplates(config.vault.path, config.vault.memFolder);

  console.log(`Vault structure created at: ${path.join(config.vault.path, config.vault.memFolder)}`);

  // Print next steps
  console.log('\n✅ Setup complete!\n');
  console.log('Next steps:');
  console.log('1. Open your Obsidian vault and enable the Dataview plugin (recommended)');
  console.log('2. Install this plugin in Claude Code:');
  console.log('   claude-code plugin install /path/to/cc-obsidian-mem');
  console.log('3. Start a new Claude Code session to begin capturing memories\n');

  if (config.summarization.enabled && !process.env[config.summarization.apiKeyEnvVar]) {
    console.log(`Remember to set ${config.summarization.apiKeyEnvVar} for AI summaries.\n`);
  }

  rl.close();
}

async function createDashboard(vaultPath: string, memFolder: string): Promise<void> {
  const dashboardPath = path.join(vaultPath, memFolder, '_index.md');

  const frontmatter = generateFrontmatter('learning', {
    title: 'Claude Memory Dashboard',
    tags: ['index', 'dashboard'],
  });

  const content = `# Claude Memory Dashboard

Welcome to your Claude Code knowledge base. This dashboard provides an overview of all captured memories.

## Quick Stats

- **Total Notes**: \`$= dv.pages('"${memFolder}"').length\`
- **Sessions**: \`$= dv.pages('"${memFolder}"').where(p => p.type == "session").length\`
- **Errors**: \`$= dv.pages('"${memFolder}"').where(p => p.type == "error").length\`
- **Decisions**: \`$= dv.pages('"${memFolder}"').where(p => p.type == "decision").length\`

## Recent Sessions

\`\`\`dataview
TABLE project, duration_minutes as "Duration", observations_count as "Actions", errors_encountered as "Errors"
FROM "${memFolder}/projects"
WHERE type = "session"
SORT start_time DESC
LIMIT 10
\`\`\`

## Active Projects

\`\`\`dataview
TABLE length(rows) as "Sessions", sum(rows.observations_count) as "Total Actions"
FROM "${memFolder}/projects"
WHERE type = "session"
GROUP BY project
SORT length(rows) DESC
\`\`\`

## Unresolved Errors

\`\`\`dataview
TABLE occurrences as "Count", last_seen as "Last Seen", project
FROM "${memFolder}"
WHERE type = "error" AND resolved = false
SORT occurrences DESC
LIMIT 10
\`\`\`

## Recent Decisions

\`\`\`dataview
LIST
FROM "${memFolder}"
WHERE type = "decision"
SORT date DESC
LIMIT 10
\`\`\`

## Global Patterns

\`\`\`dataview
TABLE category, usage_count as "Usage"
FROM "${memFolder}/global/patterns"
WHERE type = "pattern"
SORT usage_count DESC
LIMIT 10
\`\`\`

---

> [!tip] Getting Started
> - Use \`/mem-search\` to search your knowledge base
> - Use \`/mem-save\` to explicitly save learnings
> - Use \`/mem-status\` to check system status
`;

  fs.writeFileSync(dashboardPath, stringifyFrontmatter(frontmatter, content));
}

async function createTemplates(vaultPath: string, memFolder: string): Promise<void> {
  const templatesDir = path.join(vaultPath, memFolder, 'templates');

  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });
  }

  // Session template
  fs.writeFileSync(path.join(templatesDir, 'session.md'), `---
type: session
session_id: ""
project: ""
start_time:
end_time:
duration_minutes:
status: ""
tags:
  - session
---

# Session: {{date}}

## Summary

> [!note] Session Summary
> _Summary will be generated after session ends_

## Key Actions

- Action 1
- Action 2

## Files Modified

- \`file1.ts\`

## Observations

### Observation 1

> [!info] Tool: Edit
> Details here
`);

  // Error template
  fs.writeFileSync(path.join(templatesDir, 'error.md'), `---
type: error
error_type: ""
project: ""
first_seen:
last_seen:
occurrences: 1
resolved: false
tags:
  - error
---

# Error: {{error_type}}

## Summary

> [!danger] Error Pattern
> {{error_message}}

## Context

**File**: \`\`
**Line**:

## Error Message

\`\`\`
{{error_message}}
\`\`\`

## Stack Trace

\`\`\`
{{stack_trace}}
\`\`\`

## Resolution

> [!success] Solution
> _Not yet resolved_

## Occurrences

| Date | Session | Context |
|------|---------|---------|
| | | |
`);

  // Decision template
  fs.writeFileSync(path.join(templatesDir, 'decision.md'), `---
type: decision
title: ""
project: ""
date:
status: "accepted"
tags:
  - decision
---

# Decision: {{title}}

## Context

What is the issue that we're seeing that is motivating this decision?

## Decision

What is the change that we're proposing and/or doing?

## Rationale

Why is this the best approach?

## Consequences

### Positive

-

### Negative

-

## Alternatives Considered

- Alternative 1: Why not chosen
`);

  // Pattern template
  fs.writeFileSync(path.join(templatesDir, 'pattern.md'), `---
type: pattern
name: ""
category: ""
usage_count: 0
tags:
  - pattern
---

# Pattern: {{name}}

## Description

What does this pattern do?

## When to Use

In what situations should this pattern be applied?

## Implementation

\`\`\`language
// Code example
\`\`\`

## Example Usage

\`\`\`language
// Usage example
\`\`\`

## Notes

Additional context or caveats.
`);

  // Learning template
  fs.writeFileSync(path.join(templatesDir, 'learning.md'), `---
type: learning
title: ""
tags:
  - learning
---

# {{title}}

## Key Insight

What was learned?

## Context

How did this come up?

## Application

How can this be applied in the future?

## Related

- [[Related Note]]
`);
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});

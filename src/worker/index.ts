#!/usr/bin/env bun

import { startServer } from './server.js';
import { loadConfig } from '../shared/config.js';
import { VaultManager } from '../mcp-server/utils/vault.js';

async function main() {
  console.log('Initializing cc-obsidian-mem worker...');

  // Load configuration
  const config = loadConfig();
  console.log(`Using vault: ${config.vault.path}`);

  // Ensure vault structure exists
  const vault = new VaultManager(config.vault.path, config.vault.memFolder);
  await vault.ensureStructure();
  console.log('Vault structure verified');

  // Start the server
  await startServer(config);
}

main().catch((error) => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});

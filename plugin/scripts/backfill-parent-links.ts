#!/usr/bin/env bun

/**
 * Backfill script to add parent links to existing notes and create category indexes
 */

import { VaultManager } from '../src/mcp-server/utils/vault.js';
import { loadConfig, sanitizeProjectName } from '../src/shared/config.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const config = loadConfig();
  const vault = new VaultManager(config.vault.path, config.vault.memFolder);
  const memPath = vault.getMemPath();

  // Get all projects
  const projectsPath = path.join(memPath, 'projects');
  if (!fs.existsSync(projectsPath)) {
    console.log('No projects folder found');
    return;
  }

  const projects = fs.readdirSync(projectsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  console.log(`Found ${projects.length} projects: ${projects.join(', ')}`);

  for (const projectName of projects) {
    console.log(`\nProcessing project: ${projectName}`);

    // Ensure project structure (creates category indexes)
    await vault.ensureProjectStructure(projectName);
    console.log('  Created category indexes');

    const projectPath = path.join(projectsPath, projectName);

    // Update project base file with category links if missing
    const projectBasePath = path.join(projectPath, `${projectName}.md`);
    if (fs.existsSync(projectBasePath)) {
      let content = fs.readFileSync(projectBasePath, 'utf-8');
      if (!content.includes('## Categories')) {
        const categories = ['research', 'decisions', 'errors', 'patterns'];
        const categoryLinks = categories
          .map(cat => `- [[${config.vault.memFolder}/projects/${projectName}/${cat}/${cat}|${cat.charAt(0).toUpperCase() + cat.slice(1)}]]`)
          .join('\n');

        content = content.replace(
          `# ${projectName}`,
          `# ${projectName}\n\n## Categories\n\n${categoryLinks}\n\n---`
        );
        fs.writeFileSync(projectBasePath, content);
        console.log('  Updated project base with category links');
      }
    }

    // Backfill parent links for existing notes
    const categories = ['research', 'decisions', 'errors', 'patterns'];

    for (const category of categories) {
      const categoryPath = path.join(projectPath, category);
      if (!fs.existsSync(categoryPath)) continue;

      // Use category name as index file name (e.g., decisions/decisions.md)
      const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.md') && f !== `${category}.md`);
      const parentLink = `[[${config.vault.memFolder}/projects/${projectName}/${category}/${category}]]`;

      for (const file of files) {
        const filePath = path.join(categoryPath, file);
        let content = fs.readFileSync(filePath, 'utf-8');

        // Skip if already has parent
        if (content.includes('parent:')) continue;

        // Add parent field to frontmatter (before the closing ---)
        const fmEnd = content.indexOf('---', 4);
        if (fmEnd > 0) {
          const before = content.substring(0, fmEnd);
          const after = content.substring(fmEnd);
          content = before + `parent: "${parentLink}"\n` + after;
          fs.writeFileSync(filePath, content);
          console.log(`  Added parent to: ${category}/${file}`);
        }
      }
    }
  }

  console.log('\nBackfill complete!');
}

main().catch(console.error);

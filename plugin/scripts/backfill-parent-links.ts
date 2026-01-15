#!/usr/bin/env bun

/**
 * Backfill script to add parent links to existing notes and create category indexes
 */

import { ensureProjectStructure, getMemFolderPath, buildParentLink, CATEGORIES, slugifyProjectName } from '../src/vault/vault-manager.js';
import { loadConfig } from '../src/shared/config.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const config = loadConfig();
  const memPath = getMemFolderPath();

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

    try {
      const memFolder = config.vault.memFolder || '_claude-mem';

      // For backfill, use the ORIGINAL folder name on disk
      // This ensures we scan existing files, not a new slugified folder
      const projectPath = path.join(projectsPath, projectName);

      // Check if folder name is already slugified
      const projectSlug = slugifyProjectName(projectName);
      const isAlreadySlugified = projectSlug === projectName;

      if (isAlreadySlugified) {
        // Folder is already slugified - safe to use ensureProjectStructure
        ensureProjectStructure(projectName);
        console.log('  Created/verified category indexes');
      } else {
        // Legacy folder with spaces/dots - work with it as-is
        console.log(`  Legacy folder detected (slug would be: ${projectSlug})`);
        console.log('  Working with existing folder structure');
      }

      // Update project base file with category links if missing
      const projectBasePath = path.join(projectPath, `${projectName}.md`);
      if (fs.existsSync(projectBasePath)) {
        let content = fs.readFileSync(projectBasePath, 'utf-8');
        if (!content.includes('## Categories')) {
          const categoryLinks = CATEGORIES
            .map(cat => `- [[${memFolder}/projects/${projectName}/${cat}/${cat}|${cat.charAt(0).toUpperCase() + cat.slice(1)}]]`)
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
      for (const category of CATEGORIES) {
        const categoryPath = path.join(projectPath, category);
        if (!fs.existsSync(categoryPath)) continue;

        // Create category index if missing (only for already-slugified projects)
        if (isAlreadySlugified) {
          const categoryIndexPath = path.join(categoryPath, `${category}.md`);
          if (!fs.existsSync(categoryIndexPath)) {
            const parentLink = buildParentLink(memFolder, projectName);
            const indexContent = `---
type: "index"
title: "${category.charAt(0).toUpperCase() + category.slice(1)}"
project: "${projectName}"
created: "${new Date().toISOString()}"
parent: "${parentLink}"
---

# ${category.charAt(0).toUpperCase() + category.slice(1)}

Notes in this category will be listed below.
`;
            fs.writeFileSync(categoryIndexPath, indexContent);
            console.log(`  Created category index: ${category}/${category}.md`);
          }
        }

        // Use category name as index file name (e.g., decisions/decisions.md)
        const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.md') && f !== `${category}.md`);
        // Use original projectName for parent links to match existing folder structure
        const parentLink = buildParentLink(memFolder, projectName, category);

        for (const file of files) {
          try {
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
          } catch (error) {
            console.error(`  Error processing ${category}/${file}:`, error instanceof Error ? error.message : String(error));
          }
        }
      }
    } catch (error) {
      console.error(`Error processing project ${projectName}:`, error instanceof Error ? error.message : String(error));
    }
  }

  console.log('\nBackfill complete!');
}

main().catch(console.error);

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Config, TechKBConfig, TechKBCategory } from './types.js';

/**
 * Default TechKB category mappings
 * Based on Johnny Decimal structure with PARA methodology
 */
export const DEFAULT_TECHKB_CATEGORIES: Record<string, TechKBCategory> = {
  // 10-19: Projects (handled specially)
  projects: {
    id: 'projects',
    name: 'Projects',
    path: '10-projects',
    description: 'Project-specific documentation and memory',
  },
  // 30-39: Infrastructure
  infrastructure: {
    id: 'infrastructure',
    name: 'Infrastructure',
    path: '30-infrastructure',
    description: 'Infrastructure documentation, server configs, networking',
  },
  'mcp-servers': {
    id: 'mcp-servers',
    name: 'MCP Servers',
    path: '30-infrastructure/35-mcp-servers',
    description: 'MCP server configurations and documentation',
  },
  docker: {
    id: 'docker',
    name: 'Docker',
    path: '30-infrastructure/docker',
    description: 'Docker and container configurations',
  },
  // 40-49: Development
  development: {
    id: 'development',
    name: 'Development',
    path: '40-development',
    description: 'Development guides, patterns, and best practices',
  },
  // 60-69: Troubleshooting
  troubleshooting: {
    id: 'troubleshooting',
    name: 'Troubleshooting',
    path: '60-troubleshooting',
    description: 'Error solutions, debugging guides, issue resolutions',
  },
  // 80-89: Reference
  hardware: {
    id: 'hardware',
    name: 'Hardware Reference',
    path: '80-reference/hardware',
    description: 'Hardware specifications, VPS configs, equipment docs',
  },
  software: {
    id: 'software',
    name: 'Software Reference',
    path: '80-reference/software',
    description: 'Software configurations, tool documentation',
  },
  reference: {
    id: 'reference',
    name: 'Reference',
    path: '80-reference',
    description: 'General reference documentation',
  },
};

const DEFAULT_CONFIG: Config = {
  vault: {
    path: path.join(os.homedir(), 'ObsidianVault'),
    memFolder: '_claude-mem',
  },
  capture: {
    fileEdits: true,
    bashCommands: true,
    bashOutput: {
      enabled: true,
      maxLength: 5000,
    },
    errors: true,
    decisions: true,
  },
  summarization: {
    enabled: true,
    model: 'sonnet', // Agent SDK uses simple names: 'sonnet', 'opus', 'haiku'
    sessionSummary: true,
    errorSummary: true,
  },
  contextInjection: {
    enabled: true,
    maxTokens: 4000,
    includeRecentSessions: 3,
    includeRelatedErrors: true,
    includeProjectPatterns: true,
  },
  // TechKB is disabled by default - users opt-in
  techkb: undefined,
};

/**
 * Default TechKB configuration for users who enable it
 */
export const DEFAULT_TECHKB_CONFIG: TechKBConfig = {
  enabled: false,
  basePath: 'TechKB',
  projectFolder: '10-projects',
  categoryMapping: Object.fromEntries(
    Object.entries(DEFAULT_TECHKB_CATEGORIES).map(([key, cat]) => [key, cat.path])
  ),
  defaultFrontmatter: {
    type: 'note',
  },
};

let cachedConfig: Config | null = null;

/**
 * Get the path to the config file
 */
export function getConfigPath(): string {
  return process.env.CONFIG_PATH || path.join(os.homedir(), '.cc-obsidian-mem', 'config.json');
}

/**
 * Get the path to the config directory
 */
export function getConfigDir(): string {
  return path.dirname(getConfigPath());
}

/**
 * Load configuration from file, merging with defaults
 */
export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    // Return defaults if no config file exists
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }

  try {
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(fileContent) as Partial<Config>;

    // Deep merge with defaults
    cachedConfig = deepMerge(DEFAULT_CONFIG, userConfig);
    return cachedConfig;
  } catch (error) {
    console.error(`Failed to load config from ${configPath}:`, error);
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }
}

/**
 * Save configuration to file
 */
export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const configDir = getConfigDir();

  // Ensure config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  cachedConfig = config;
}

/**
 * Get the full path to the memory folder in the vault
 */
export function getMemFolderPath(config?: Config): string {
  const cfg = config || loadConfig();
  return path.join(cfg.vault.path, cfg.vault.memFolder);
}

/**
 * Get the path to a project's folder in the vault
 */
export function getProjectPath(projectName: string, config?: Config): string {
  return path.join(getMemFolderPath(config), 'projects', sanitizeProjectName(projectName));
}

/**
 * Sanitize project name for use as folder name
 */
export function sanitizeProjectName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}

/**
 * Deep merge two objects
 */
function deepMerge(target: Config, source: Partial<Config>): Config {
  const result = JSON.parse(JSON.stringify(target)) as Config;

  if (source.vault) {
    result.vault = { ...result.vault, ...source.vault };
  }
  if (source.capture) {
    result.capture = {
      ...result.capture,
      ...source.capture,
      bashOutput: source.capture.bashOutput
        ? { ...result.capture.bashOutput, ...source.capture.bashOutput }
        : result.capture.bashOutput,
    };
  }
  if (source.summarization) {
    result.summarization = { ...result.summarization, ...source.summarization };
  }
  if (source.contextInjection) {
    result.contextInjection = { ...result.contextInjection, ...source.contextInjection };
  }
  if (source.techkb) {
    // Merge TechKB config with defaults if user has enabled it
    result.techkb = {
      ...DEFAULT_TECHKB_CONFIG,
      ...source.techkb,
      categoryMapping: {
        ...DEFAULT_TECHKB_CONFIG.categoryMapping,
        ...(source.techkb.categoryMapping || {}),
      },
      defaultFrontmatter: {
        ...DEFAULT_TECHKB_CONFIG.defaultFrontmatter,
        ...(source.techkb.defaultFrontmatter || {}),
      },
    };
  }

  return result;
}

/**
 * Clear the config cache (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get default config (useful for setup wizard)
 */
export function getDefaultConfig(): Config {
  return { ...DEFAULT_CONFIG };
}

// ===== TechKB Helper Functions =====

/**
 * Check if TechKB integration is enabled
 */
export function isTechKBEnabled(config?: Config): boolean {
  const cfg = config || loadConfig();
  return cfg.techkb?.enabled ?? false;
}

/**
 * Get the TechKB base path (absolute)
 */
export function getTechKBBasePath(config?: Config): string | null {
  const cfg = config || loadConfig();
  if (!cfg.techkb?.enabled) return null;
  return path.join(cfg.vault.path, cfg.techkb.basePath);
}

/**
 * Get the TechKB path for a specific category
 * @param category - Category key (e.g., 'infrastructure', 'hardware')
 * @returns Absolute path to the category folder, or null if TechKB disabled or category not found
 */
export function getTechKBCategoryPath(category: string, config?: Config): string | null {
  const cfg = config || loadConfig();
  if (!cfg.techkb?.enabled) return null;

  const categoryPath = cfg.techkb.categoryMapping[category];
  if (!categoryPath) return null;

  return path.join(cfg.vault.path, cfg.techkb.basePath, categoryPath);
}

/**
 * Get the TechKB project path (where _claude-mem folders go for projects)
 * @param projectName - Name of the project
 * @returns Path like vault/TechKB/10-projects/{project}/_claude-mem/
 */
export function getTechKBProjectPath(projectName: string, config?: Config): string | null {
  const cfg = config || loadConfig();
  if (!cfg.techkb?.enabled) return null;

  const sanitizedProject = sanitizeProjectName(projectName);
  return path.join(
    cfg.vault.path,
    cfg.techkb.basePath,
    cfg.techkb.projectFolder,
    sanitizedProject,
    cfg.vault.memFolder
  );
}

/**
 * Get all available TechKB categories
 * @returns Array of category info objects
 */
export function getTechKBCategories(config?: Config): TechKBCategory[] {
  const cfg = config || loadConfig();
  if (!cfg.techkb?.enabled) return [];

  return Object.entries(cfg.techkb.categoryMapping).map(([id, catPath]) => {
    const defaultCat = DEFAULT_TECHKB_CATEGORIES[id];
    return {
      id,
      name: defaultCat?.name || id.charAt(0).toUpperCase() + id.slice(1),
      path: catPath,
      description: defaultCat?.description,
    };
  });
}

/**
 * Resolve a TechKB path - handles both absolute paths and category-relative paths
 * @param pathOrCategory - Either a category key or a path relative to TechKB base
 * @returns Absolute path
 */
export function resolveTechKBPath(pathOrCategory: string, config?: Config): string | null {
  const cfg = config || loadConfig();
  if (!cfg.techkb?.enabled) return null;

  // Check if it's a known category
  const categoryPath = cfg.techkb.categoryMapping[pathOrCategory];
  if (categoryPath) {
    return path.join(cfg.vault.path, cfg.techkb.basePath, categoryPath);
  }

  // Otherwise treat as a direct path relative to TechKB base
  return path.join(cfg.vault.path, cfg.techkb.basePath, pathOrCategory);
}

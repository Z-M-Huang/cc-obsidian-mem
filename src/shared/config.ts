import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Config } from './types.js';

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
    model: 'claude-sonnet-4-5-20250514',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
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

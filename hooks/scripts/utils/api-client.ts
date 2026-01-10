import { loadConfig } from '../../../src/shared/config.js';
import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Client for communicating with the worker service
 */
export class WorkerClient {
  private baseUrl: string;
  private port: number;

  constructor(port?: number) {
    const config = loadConfig();
    this.port = port || config.worker.port;
    this.baseUrl = `http://localhost:${this.port}`;
  }

  /**
   * Ensure the worker service is running
   */
  async ensureRunning(): Promise<boolean> {
    const isRunning = await this.healthCheck();
    if (isRunning) {
      return true;
    }

    // Try to start the worker
    const config = loadConfig();
    if (config.worker.autoStart) {
      await this.startWorker();
      // Wait a bit for it to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      return this.healthCheck();
    }

    return false;
  }

  /**
   * Check if worker is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Start the worker in the background
   */
  private async startWorker(): Promise<void> {
    const workerPath = path.join(__dirname, '../../../src/worker/index.ts');

    // Spawn worker as detached process
    const child = spawn('bun', ['run', workerPath], {
      detached: true,
      stdio: 'ignore',
    });

    child.unref();
  }

  /**
   * Make a POST request to the worker
   */
  async post<T = unknown>(endpoint: string, data: unknown): Promise<T | null> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(`Worker POST ${endpoint} failed: ${response.status}`);
        return null;
      }

      return await response.json() as T;
    } catch (error) {
      console.error(`Worker POST ${endpoint} error:`, error);
      return null;
    }
  }

  /**
   * Make a GET request to the worker
   */
  async get<T = unknown>(endpoint: string, params?: Record<string, string>): Promise<T | null> {
    try {
      let url = `${this.baseUrl}${endpoint}`;
      if (params) {
        const searchParams = new URLSearchParams(params);
        url += `?${searchParams.toString()}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(`Worker GET ${endpoint} failed: ${response.status}`);
        return null;
      }

      return await response.json() as T;
    } catch (error) {
      console.error(`Worker GET ${endpoint} error:`, error);
      return null;
    }
  }
}

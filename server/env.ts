// Loads ~/Desktop/lesson1/.env (if present) into process.env without dotenv.
// Imported first by every server entry point.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const ROOT_DIR = resolve(import.meta.dirname, '..');
const ENV_FILE = join(ROOT_DIR, '.env');

const shellEnv = { ...process.env };
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

// Startup config (read once). Defaults keep local development as in lesson 2;
// the Docker image sets HOST=0.0.0.0 and DB_PATH=/app/data/moneyflow.sqlite.
const config = (name: string) => process.env[name]?.trim() || undefined;

export const HOST = config('HOST') ?? '127.0.0.1';
export const PORT = Number(config('PORT') ?? 8787);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`[moneyflow] PORT must be a number from 1 to 65535, got "${config('PORT')}"`);
}
/** SQLite file shared by the API and the bot; a relative path is resolved from the project root. */
export const DB_PATH = resolve(ROOT_DIR, config('DB_PATH') ?? join('data', 'moneyflow.sqlite'));

/**
 * Current value of a secret, re-read from .env on every call, so a key added or removed
 * during the lesson applies without a restart. Falls back to the shell environment.
 */
export function readEnv(name: string): string | undefined {
  let fromFile: string | undefined;
  try {
    fromFile = parseEnv(readFileSync(ENV_FILE, 'utf8'))[name];
  } catch {
    // no .env file
  }
  return (fromFile ?? shellEnv[name])?.trim() || undefined;
}

// Loads ~/Desktop/lesson1/.env (if present) into process.env without dotenv.
// Imported first by every server entry point.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const ROOT_DIR = resolve(import.meta.dirname, '..');
export const DB_PATH = join(ROOT_DIR, 'data', 'moneyflow.sqlite');
const ENV_FILE = join(ROOT_DIR, '.env');

const shellEnv = { ...process.env };
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

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

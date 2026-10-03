// Basic Auth for the deployed site and /api: on only when APP_PASSWORD is set (login "moneyflow").
// Locally without APP_PASSWORD everything stays open, as in lesson 2.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { API_PATHS } from '../shared/contract.ts';
import { readEnv } from './env.ts';

export const APP_LOGIN = 'moneyflow';

/**
 * Paths that never ask for the password: the liveness check and the localhost-only MCP.
 * Step 3 adds '/internal' here (it checks its own bearer token).
 */
const PUBLIC_PATHS = [API_PATHS.health, '/mcp'];

/** True for `prefix` itself and everything below it (`/mcp`, `/mcp/x`), not for `/mcpx`. */
export const isUnder = (path: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

// Hash both sides first so timingSafeEqual always compares equal lengths.
const sameSecret = (given: string, expected: string) =>
  timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());

function credentials(header: string | undefined): { login: string; password: string } | undefined {
  const [scheme, encoded] = header?.split(' ') ?? [];
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return undefined;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon === -1 ? undefined : { login: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const password = readEnv('APP_PASSWORD'); // re-read per request, like the other secrets
  if (!password || isUnder(req.path, PUBLIC_PATHS)) return next();

  const given = credentials(req.get('authorization'));
  // Evaluate both comparisons so a wrong login takes as long as a wrong password.
  const loginOk = sameSecret(given?.login ?? '', APP_LOGIN);
  const passwordOk = sameSecret(given?.password ?? '', password);
  if (given && loginOk && passwordOk) return next();

  res.set('WWW-Authenticate', 'Basic realm="MoneyFlow"');
  res.status(401).json({ error: { code: 'unauthorized', message: 'MoneyFlow needs the login and password.' } });
}

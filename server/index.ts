// MoneyFlow HTTP API on HOST:PORT (127.0.0.1:8787 by default). Thin layer over server/service.ts.
// Locally Vite proxies the browser's /api requests here; in Docker this server also serves dist/.
import { DB_PATH, HOST, PORT, ROOT_DIR, readEnv } from './env.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { API_PATHS, type HealthResponse } from '../shared/contract.ts';
import { basicAuth, isUnder } from './auth.ts';
import { closeDb, getDb } from './db.ts';
import { INTERNAL_PREFIX, mountInternal } from './internal.ts';
import { mountMcp } from './mcp/index.ts';
import { ServiceError, createTransaction, getDashboard, getQuote } from './service.ts';

const DIST_DIR = join(ROOT_DIR, 'dist');
const SPA_INDEX = join(DIST_DIR, 'index.html');
/** Never answered with the SPA: unknown paths here stay JSON 404s. */
const BACKEND_PREFIXES = ['/api', '/mcp', INTERNAL_PREFIX];

const app = express();
app.disable('x-powered-by');
app.use(basicAuth);
app.use(express.json({ limit: '16kb' }));

const queryText = (value: unknown) => (value === undefined ? undefined : String(value));

app.get(API_PATHS.health, (_req, res) => {
  res.json({ ok: true } satisfies HealthResponse);
});

app.get(API_PATHS.dashboard, (req, res) => {
  res.json(getDashboard(queryText(req.query.month)));
});

app.get(API_PATHS.quote, async (req, res) => {
  res.json(await getQuote(req.query.asset, req.query.quantity));
});

app.post(API_PATHS.transactions, async (req, res) => {
  const { transaction } = await createTransaction(req.body, { source: 'web' });
  res.status(201).json(transaction);
});

// Phase 2: the MCP module attaches /mcp here.
mountMcp(app);

// Step 3: read API for the MCP on Vercel (/internal/mcp/*, bearer token instead of the password).
mountInternal(app);

// Production build (npm run build): the site itself plus SPA fallback. Without dist/ — API only.
const serveSite = existsSync(SPA_INDEX);
if (serveSite) {
  app.use(express.static(DIST_DIR));
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isUnder(req.path, BACKEND_PREFIXES)) return next();
    res.sendFile(SPA_INDEX);
  });
}

// Every other response is JSON too: the site treats non-JSON as "backend unreachable".
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'not_found', message: `Not found: ${req.method} ${req.path}` } });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ServiceError) {
    res.status(error.status).json(error.toResponse());
    return;
  }
  const bodyError = error as { type?: string };
  if (bodyError?.type === 'entity.parse.failed' || bodyError?.type === 'entity.too.large') {
    const failure = new ServiceError('validation_failed', 'Send the transaction as a valid JSON object.');
    res.status(failure.status).json(failure.toResponse());
    return;
  }
  console.error('[moneyflow] unexpected error:', error);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on the MoneyFlow backend.' } });
});

getDb(); // create the schema and import lesson 1 data before the first request

const server = app.listen(PORT, HOST);
server.on('listening', () => {
  const key = readEnv('COINGECKO_DEMO_API_KEY') ? 'configured' : 'missing (crypto will return 503)';
  const site = serveSite ? 'site from dist/' : 'API only';
  const auth = readEnv('APP_PASSWORD') ? 'password on' : 'no password';
  const readApi = readEnv('MCP_READ_TOKEN') ? 'MCP read API on' : 'MCP read API off';
  console.log(
    `[moneyflow] ${site} on http://${HOST}:${PORT}  ·  ${auth}  ·  ${readApi}  ·  database ${DB_PATH}  ·  CoinGecko key ${key}`,
  );
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `[moneyflow] port ${PORT} is busy: another backend is already running (lsof -nP -iTCP:${PORT} -sTCP:LISTEN)`
      : error,
  );
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    closeDb();
    process.exit(0);
  });
}

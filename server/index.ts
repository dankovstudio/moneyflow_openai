// MoneyFlow HTTP API on 127.0.0.1:8787. Thin layer over server/service.ts;
// Vite proxies the browser's /api requests here.
import { DB_PATH, readEnv } from './env.ts';
import express, { type NextFunction, type Request, type Response } from 'express';
import { API_PATHS, type HealthResponse } from '../shared/contract.ts';
import { closeDb, getDb } from './db.ts';
import { mountMcp } from './mcp/index.ts';
import { ServiceError, createTransaction, getDashboard, getQuote } from './service.ts';

const HOST = '127.0.0.1';
const PORT = 8787;

const app = express();
app.disable('x-powered-by');
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
  console.log(`[moneyflow] API on http://${HOST}:${PORT}  ·  database ${DB_PATH}  ·  CoinGecko key ${key}`);
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

// Read API for the MoneyFlow MCP on Vercel: the same JSON as listExpenses() and spendingSummary().
// Off (404) until MCP_READ_TOKEN is set; then every request needs `Authorization: Bearer <MCP_READ_TOKEN>`.
// Basic Auth skips /internal (server/auth.ts): the bearer token is its own check.
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { sameSecret } from './auth.ts';
import { readEnv } from './env.ts';
import { listExpenses, spendingSummary } from './service.ts';

export const INTERNAL_PREFIX = '/internal';

const queryText = (value: unknown) => (value === undefined ? undefined : String(value));

function bearerToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

function requireReadToken(req: Request, res: Response, next: NextFunction): void {
  const expected = readEnv('MCP_READ_TOKEN'); // re-read per request, like the other secrets
  if (!expected) return next('router'); // read API off: falls through to the JSON 404

  res.set('Cache-Control', 'no-store');
  const given = bearerToken(req.get('authorization'));
  if (given && sameSecret(given, expected)) return next();

  res.set('WWW-Authenticate', 'Bearer realm="MoneyFlow MCP"');
  res.status(401).json({ error: { code: 'unauthorized', message: 'MoneyFlow read API needs a valid MCP read token.' } });
}

/** Called by server/index.ts before the 404 handler. ServiceError (bad month) goes to the app error handler. */
export function mountInternal(app: Express): void {
  const router = express.Router();
  router.use(requireReadToken);

  // GET /internal/mcp/expenses?month=YYYY-MM&limit=N → ExpenseList
  router.get('/mcp/expenses', (req, res) => {
    const limit = queryText(req.query.limit);
    res.json(listExpenses({ month: queryText(req.query.month), limit: limit === undefined ? undefined : Number(limit) }));
  });

  // GET /internal/mcp/summary?month=YYYY-MM → SpendingSummary
  router.get('/mcp/summary', (req, res) => {
    res.json(spendingSummary(queryText(req.query.month)));
  });

  app.use(INTERNAL_PREFIX, router);
}

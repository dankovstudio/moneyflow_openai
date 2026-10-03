// MoneyFlow MCP as a Vercel Function: the same two read-only tools as server/mcp/tools.ts,
// but the data comes from the MoneyFlow read API on the server (GET /internal/mcp/*), not from SQLite.
// Public URL: https://<project>.vercel.app/<MCP_PATH_SECRET>/mcp (vercel.json rewrites it to /api/mcp?secret=…).
// Env (Vercel): MONEYFLOW_API_URL, MCP_READ_TOKEN, MCP_PATH_SECRET. Values are never logged.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

// ---------- Minimal copies of shared/contract.ts and server/service.ts (Vercel builds only mcp-vercel/) ----------

const TIME_ZONE = 'Europe/London';
const MAX_LIST_LIMIT = 100;

type CryptoAsset = 'USDT' | 'USDC' | 'ETH' | 'BTC' | 'SOL';

type Transaction = {
  date: string;
  createdAt: string;
  description: string;
  category: string;
  account: string;
  amountPence: number;
  source: 'seed' | 'web' | 'telegram';
} & ({ asset: 'GBP' } | { asset: CryptoAsset; quantity: string; coinId: string; rateGbp: string; quotedAt: string });

/** GET /internal/mcp/expenses — listExpenses() */
type ExpenseList = { month: string; totalCount: number; expenses: Transaction[] };

/** GET /internal/mcp/summary — spendingSummary() */
type SpendingSummary = {
  month: string;
  expensesPence: number;
  expenseCount: number;
  categories: { category: string; amountPence: number }[];
};

type ApiErrorResponse = { error?: { code?: string; message?: string } };

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const formatGbp = (pence: number) => gbp.format(pence / 100);

// ---------- Tools (same inputs, descriptions and output as server/mcp/tools.ts) ----------

const INSTRUCTIONS =
  'Read-only access to MoneyFlow, a personal finance dashboard. All totals are GBP. ' +
  'Months are Europe/London calendar months as YYYY-MM, from 2026-09 to the current month. ' +
  'Crypto expenses (USDT, USDC, ETH, BTC, SOL) keep the GBP amount fixed when they were entered, ' +
  'plus the original coin quantity and CoinGecko rate; they are never re-priced.';

const monthInput = z
  .string()
  .optional()
  .describe('Month as YYYY-MM (Europe/London), e.g. "2026-09". Omit for the current month.');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const londonDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** "2026-09-30T15:13:05.000Z" → "30/09/2026, 16:13:05" (Europe/London). */
const toLondonTime = (timestamp: string) => londonDateTime.format(new Date(timestamp));

const json = (data: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

/** A failure whose text the model may see as-is (never a stack trace, URL or token). */
class ToolError extends Error {}

const UNAVAILABLE = 'MoneyFlow could not read the data right now. Try again.';

/** GET <MONEYFLOW_API_URL>/internal/mcp/<path> with the read token; query values left undefined are not sent. */
async function readApi<T>(path: 'expenses' | 'summary', query: Record<string, string | number | undefined>): Promise<T> {
  const baseUrl = process.env.MONEYFLOW_API_URL?.trim();
  const token = process.env.MCP_READ_TOKEN?.trim();
  if (!baseUrl || !token) {
    throw new ToolError('MoneyFlow MCP is not configured: set MONEYFLOW_API_URL and MCP_READ_TOKEN on Vercel.');
  }

  const url = new URL(`/internal/mcp/${path}`, baseUrl);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok) return (await response.json()) as T;

  if (response.status === 401) {
    throw new ToolError('MoneyFlow rejected the MCP read token. MCP_READ_TOKEN must be the same on Vercel and on the server.');
  }
  if (response.status === 400) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
    if (body?.error?.message) {
      throw new ToolError(JSON.stringify({ error: { code: body.error.code, message: body.error.message } }));
    }
  }
  throw new Error(`read API answered ${response.status}`);
}

/** Runs a tool body; only ToolError texts reach the model. */
async function run(tool: string, args: Record<string, unknown>, body: () => Promise<unknown>): Promise<CallToolResult> {
  console.log(`[moneyflow] MCP ${tool} ${JSON.stringify(args)}`);
  try {
    return json(await body());
  } catch (error) {
    if (error instanceof ToolError) return { isError: true, content: [{ type: 'text', text: error.message }] };
    console.error(`[moneyflow] MCP ${tool} failed:`, error instanceof Error ? error.message : error);
    return { isError: true, content: [{ type: 'text', text: UNAVAILABLE }] };
  }
}

function toExpense(transaction: Transaction) {
  const expense = {
    date: transaction.date,
    recordedAt: transaction.createdAt,
    recordedAtLondon: toLondonTime(transaction.createdAt),
    description: transaction.description,
    category: transaction.category,
    account: transaction.account,
    amountPence: transaction.amountPence,
    amountGbp: formatGbp(transaction.amountPence),
    asset: transaction.asset,
    source: transaction.source,
  };
  if (transaction.asset === 'GBP') return expense;
  return {
    ...expense,
    original: `${transaction.quantity} ${transaction.asset}`,
    quantity: transaction.quantity,
    coinId: transaction.coinId,
    rateGbpPerCoin: transaction.rateGbp,
    quotedAt: transaction.quotedAt,
  };
}

function registerTools(server: McpServer): void {
  server.registerTool(
    'list_expenses',
    {
      title: 'List MoneyFlow expenses',
      description:
        'Expenses of one month, newest first, capped by `limit`. Each expense has date, recordedAt (UTC ISO time ' +
        'the expense was saved; for source "seed" it is the import time of the demo data) and recordedAtLondon, ' +
        'description, category, account, the stored GBP amount (amountPence and amountGbp) and source (seed, web or telegram). ' +
        'Crypto expenses also have the original asset and quantity, the GBP rate per coin and the quote time. ' +
        '`totalCount` is the number of all expenses in the month; `hasMore` is true when the list was cut.',
      inputSchema: {
        month: monthInput,
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe(`Maximum number of expenses to return, 1-${MAX_LIST_LIMIT}. Default 20.`),
      },
      annotations: { title: 'List MoneyFlow expenses', ...READ_ONLY },
    },
    async ({ month, limit }) =>
      run('list_expenses', { month, limit }, async () => {
        const list = await readApi<ExpenseList>('expenses', { month, limit });
        return {
          month: list.month,
          currency: 'GBP',
          totalCount: list.totalCount,
          returned: list.expenses.length,
          hasMore: list.totalCount > list.expenses.length,
          expenses: list.expenses.map(toExpense),
        };
      }),
  );

  server.registerTool(
    'spending_summary',
    {
      title: 'MoneyFlow spending summary',
      description:
        'Total GBP spending of one month, the number of expenses and the split by expense category ' +
        '(largest first, with each category share of the total in percent). Crypto expenses count at their stored GBP amount.',
      inputSchema: { month: monthInput },
      annotations: { title: 'MoneyFlow spending summary', ...READ_ONLY },
    },
    async ({ month }) =>
      run('spending_summary', { month }, async () => {
        const summary = await readApi<SpendingSummary>('summary', { month });
        return {
          month: summary.month,
          currency: 'GBP',
          totalPence: summary.expensesPence,
          totalGbp: formatGbp(summary.expensesPence),
          expenseCount: summary.expenseCount,
          categories: summary.categories.map(({ category, amountPence }) => ({
            category,
            amountPence,
            amountGbp: formatGbp(amountPence),
            sharePercent: summary.expensesPence ? Math.round((amountPence * 1000) / summary.expensesPence) / 10 : 0,
          })),
        };
      }),
  );
}

// ---------- HTTP: path secret, POST only, stateless Streamable HTTP ----------

// No Redis, no SSE endpoint: a fresh server per POST, like the local /mcp.
const mcpHandler = createMcpHandler(
  registerTools,
  { serverInfo: { name: 'moneyflow', version: '0.1.0' }, instructions: INSTRUCTIONS },
  { basePath: '', disableSse: true, maxDuration: 60 },
);

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * The secret is the first path segment (/<secret>/mcp) or ?secret= (after the vercel.json rewrite);
 * Vercel may hand the function either URL. Hashing first keeps timingSafeEqual on equal lengths.
 */
function hasPathSecret(url: URL): boolean {
  const secret = process.env.MCP_PATH_SECRET?.trim();
  if (!secret) return false;
  const expected = digest(secret);
  const candidates = [url.searchParams.get('secret'), /^\/([^/]+)\/mcp\/?$/.exec(url.pathname)?.[1]];
  return candidates.some((given) => given != null && timingSafeEqual(digest(given), expected));
}

const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status, headers });

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!hasPathSecret(url)) return new Response('Not found', { status: 404 });

  if (request.method !== 'POST') {
    return rpcError(405, -32000, 'Method not allowed. MoneyFlow MCP is stateless: send JSON-RPC with POST.', { Allow: 'POST' });
  }

  // mcp-handler parses the body itself without catching errors, so invalid JSON is answered here.
  const body = await request.text();
  try {
    JSON.parse(body);
  } catch {
    return rpcError(400, -32700, 'Parse error: send valid JSON.');
  }

  // mcp-handler only serves the exact path /mcp: hand it a clean URL without the secret.
  return mcpHandler(new Request(new URL('/mcp', url), { method: 'POST', headers: request.headers, body, signal: request.signal }));
}

export { handle as GET, handle as POST, handle as DELETE };

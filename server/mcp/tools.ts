// MoneyFlow MCP server: two read-only tools over the shared service (no SQL, no writes, no files).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TIME_ZONE, type Transaction } from '../../shared/contract.ts';
import { MAX_LIST_LIMIT, ServiceError, formatGbp, listExpenses, spendingSummary } from '../service.ts';

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

/** Runs a tool body; only ServiceError messages reach the model, never stack traces or paths. */
async function run(tool: string, args: Record<string, unknown>, body: () => unknown): Promise<CallToolResult> {
  console.log(`[moneyflow] MCP ${tool} ${JSON.stringify(args)}`);
  try {
    return json(body());
  } catch (error) {
    if (error instanceof ServiceError) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: error.code, message: error.message } }) }] };
    }
    console.error(`[moneyflow] MCP ${tool} failed:`, error);
    return { isError: true, content: [{ type: 'text', text: 'MoneyFlow could not read the data right now. Try again.' }] };
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

/** A fresh server per request (stateless transport); nothing here keeps state between calls. */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'moneyflow', version: '0.1.0' }, { instructions: INSTRUCTIONS });

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
      run('list_expenses', { month, limit }, () => {
        const list = listExpenses({ month, limit });
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
      run('spending_summary', { month }, () => {
        const summary = spendingSummary(month);
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

  return server;
}

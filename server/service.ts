// Shared MoneyFlow service: the only code that reads and writes transactions.
// Used by the HTTP API (server/index.ts), the Telegram bot and the MCP server,
// so every entry point gets the same validation, CoinGecko pricing and storage.
import './env.ts';
import { randomUUID } from 'node:crypto';
import {
  ACCOUNTS,
  ASSETS,
  CRYPTO_ACCOUNT,
  CRYPTO_ASSETS,
  EXPENSE_CATEGORIES,
  FIRST_MONTH,
  GBP_ACCOUNTS,
  INCOME_CATEGORIES,
  ISO_DATE_PATTERN,
  MIN_DATE,
  TIME_ZONE,
  YEAR_MONTH_PATTERN,
  isCryptoAsset,
  isValidQuantity,
  parseGbpAmountPence,
  type CategoryTotal,
  type CreateTransactionRequest,
  type CryptoAsset,
  type DashboardResponse,
  type IsoDate,
  type QuoteResponse,
  type Transaction,
  type TransactionSource,
  type YearMonth,
} from '../shared/contract.ts';
import { fetchQuote, normalizeDecimal } from './coingecko.ts';
import { getDb } from './db.ts';
import { ServiceError, type FieldErrors } from './errors.ts';

export { ServiceError } from './errors.ts';

// ---------- Dates (Europe/London) ----------

const londonDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date in Europe/London of an instant, e.g. a Telegram message time. */
export const londonDate = (instant: Date = new Date()): IsoDate => londonDateFormat.format(instant);

export const currentMonth = (): YearMonth => londonDate().slice(0, 7);

/** FIRST_MONTH … current month, oldest first. */
export function availableMonths(): YearMonth[] {
  const last = currentMonth();
  const months: YearMonth[] = [];
  let [year, month] = FIRST_MONTH.split('-').map(Number);
  for (let value = FIRST_MONTH; value <= last; ) {
    months.push(value);
    if (++month > 12) [year, month] = [year + 1, 1];
    value = `${year}-${String(month).padStart(2, '0')}`;
  }
  return months.length > 0 ? months : [FIRST_MONTH];
}

function lastDayOfMonth(month: YearMonth): IsoDate {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** Validates an optional YYYY-MM against availableMonths(); defaults to the current month. */
export function resolveMonth(month?: string): YearMonth {
  const months = availableMonths();
  if (month === undefined || month === '') return months[months.length - 1];
  if (!YEAR_MONTH_PATTERN.test(month) || !months.includes(month)) {
    throw new ServiceError(
      'validation_failed',
      `Choose a month from ${months[0]} to ${months[months.length - 1]} (YYYY-MM).`,
    );
  }
  return month;
}

function isCalendarDate(value: string) {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// ---------- Formatting helpers for the bot and MCP ----------

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/** 261089 → "£2,610.89" (display only; amounts stay integer pence). */
export const formatGbp = (pence: number) => gbp.format(pence / 100);

// ---------- Rows ----------

type TransactionRow = {
  id: string;
  date: string;
  type: 'income' | 'expense';
  asset: string;
  account: string;
  category: string;
  description: string;
  amount_pence: number;
  quantity: string | null;
  coin_id: string | null;
  rate_gbp: string | null;
  quoted_at: string | null;
  source: TransactionSource;
  created_at: string;
};

function toTransaction(row: TransactionRow): Transaction {
  const base = {
    id: row.id,
    date: row.date,
    description: row.description,
    amountPence: row.amount_pence,
    createdAt: row.created_at,
    source: row.source,
  };
  if (row.asset === 'GBP') {
    return { ...base, asset: 'GBP', account: row.account, type: row.type, category: row.category } as Transaction;
  }
  return {
    ...base,
    asset: row.asset,
    type: 'expense',
    account: CRYPTO_ACCOUNT,
    category: row.category,
    quantity: row.quantity,
    coinId: row.coin_id,
    rateGbp: row.rate_gbp,
    quotedAt: row.quoted_at,
  } as Transaction;
}

const NEWEST_FIRST = 'ORDER BY date DESC, created_at DESC, rowid DESC';

function findByExternalId(externalId: string): Transaction | undefined {
  const row = getDb().prepare('SELECT * FROM transactions WHERE external_id = ?').get(externalId);
  return row ? toTransaction(row as TransactionRow) : undefined;
}

// ---------- Validation ----------

const MAX_DESCRIPTION_LENGTH = 120;

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

const asText = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

function fail(fields: FieldErrors): never {
  throw new ServiceError('validation_failed', Object.values(fields).join(' '), fields);
}

function unsupportedAsset(asset: string, allowGbp: boolean) {
  const supported = `${allowGbp ? 'GBP or ' : ''}one of ${CRYPTO_ASSETS.join(', ')}`;
  const message = asset ? `"${asset}" is not supported. Use ${supported}.` : `Choose ${supported}.`;
  return new ServiceError(asset ? 'unsupported_asset' : 'validation_failed', message, { asset: message });
}

function readDescription(value: unknown, fields: FieldErrors) {
  const description = typeof value === 'string' ? value.trim() : '';
  if (!description) fields.description = 'Enter a description.';
  else if (description.length > MAX_DESCRIPTION_LENGTH) {
    fields.description = `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`;
  }
  return description;
}

function readQuantity(value: unknown, asset: CryptoAsset, fields: FieldErrors) {
  const quantity = asText(value).trim();
  if (isValidQuantity(quantity)) return normalizeDecimal(quantity);
  fields.quantity = `Enter a positive ${asset} quantity with up to 8 decimals, e.g. 0.1.`;
  return '';
}

function readCryptoAsset(value: unknown): CryptoAsset {
  const asset = asText(value).trim().toUpperCase();
  if (!isCryptoAsset(asset)) throw unsupportedAsset(asset, false);
  return asset;
}

// ---------- Quotes ----------

/** Live CoinGecko estimate in GBP. Stores nothing. */
export async function getQuote(asset: unknown, quantity: unknown): Promise<QuoteResponse> {
  const cryptoAsset = readCryptoAsset(asset);
  const fields: FieldErrors = {};
  const normalized = readQuantity(quantity, cryptoAsset, fields);
  if (!normalized) fail(fields);
  return fetchQuote(cryptoAsset, normalized);
}

// ---------- Creating transactions ----------

export type CreateOptions = {
  /** Who is writing: 'web' (default) or 'telegram'. */
  source?: Exclude<TransactionSource, 'seed'>;
  /** Idempotency key, e.g. `telegram:<chat_id>:<message_id>`. A repeat returns the stored row. */
  externalId?: string;
};

export type CreateResult = {
  transaction: Transaction;
  /** false when `externalId` was already stored: nothing new was written. */
  created: boolean;
};

type NewRow = Omit<TransactionRow, 'id' | 'created_at' | 'source'>;

function insert(row: NewRow, source: TransactionSource, externalId: string | undefined): CreateResult {
  const id = randomUUID();
  const result = getDb()
    .prepare(`
      INSERT INTO transactions (id, date, type, asset, account, category, description, amount_pence,
        quantity, coin_id, rate_gbp, quoted_at, source, external_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (external_id) DO NOTHING
    `)
    .run(
      id, row.date, row.type, row.asset, row.account, row.category, row.description, row.amount_pence,
      row.quantity, row.coin_id, row.rate_gbp, row.quoted_at, source, externalId ?? null, new Date().toISOString(),
    );

  if (result.changes === 0 && externalId) return { transaction: findByExternalId(externalId)!, created: false };

  const stored = getDb().prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow;
  const transaction = toTransaction(stored);
  const original = transaction.asset === 'GBP' ? '' : ` (${transaction.quantity} ${transaction.asset} @ £${transaction.rateGbp})`;
  console.log(
    `[moneyflow] saved ${source} ${transaction.type} ${formatGbp(transaction.amountPence)}${original}` +
      ` · ${transaction.description} · ${transaction.account}/${transaction.category} · ${transaction.date}`,
  );
  return { transaction, created: true };
}

/**
 * Validates and stores one transaction (GBP or crypto), returning the saved row.
 * Crypto: Crypto Wallet, today's London date and a fresh CoinGecko quote are set here.
 * Throws ServiceError (nothing is written) on any validation or pricing problem.
 */
export async function createTransaction(
  input: CreateTransactionRequest,
  options: CreateOptions = {},
): Promise<CreateResult> {
  const source = options.source ?? 'web';
  const externalId = options.externalId?.trim() || undefined;

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ServiceError('validation_failed', 'Send the transaction as a JSON object.');
  }
  const body = input as Record<string, unknown>;
  const asset = asText(body.asset).trim().toUpperCase();
  if (!isOneOf(ASSETS, asset)) throw unsupportedAsset(asset, true);

  if (externalId) {
    const existing = findByExternalId(externalId);
    if (existing) return { transaction: existing, created: false };
  }

  const fields: FieldErrors = {};

  if (asset === 'GBP') {
    const type = body.type;
    if (type !== 'income' && type !== 'expense') fields.type = 'Choose income or expense.';

    const amountPence = parseGbpAmountPence(asText(body.amount));
    if (amountPence === null) fields.amount = 'Enter an amount from £0.01 to £1,000,000.00 with up to 2 decimals.';

    if (!isOneOf(GBP_ACCOUNTS, body.account)) {
      fields.account = `Choose ${GBP_ACCOUNTS.join(', ')}${body.account === CRYPTO_ACCOUNT ? ' (Crypto Wallet is for crypto expenses only)' : ''}.`;
    }

    const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    if (!isOneOf(categories, body.category)) fields.category = `Choose one of: ${categories.join(', ')}.`;

    const description = readDescription(body.description, fields);

    const date = asText(body.date).trim();
    const today = londonDate();
    if (!isCalendarDate(date)) fields.date = 'Enter a date as YYYY-MM-DD.';
    else if (date < MIN_DATE || date > today) fields.date = `Choose a date from ${MIN_DATE} to ${today}.`;

    if (Object.keys(fields).length > 0) fail(fields);

    return insert(
      {
        date, type: type as 'income' | 'expense', asset, account: body.account as string,
        category: body.category as string, description, amount_pence: amountPence!,
        quantity: null, coin_id: null, rate_gbp: null, quoted_at: null,
      },
      source,
      externalId,
    );
  }

  if (body.type !== undefined && body.type !== 'expense') fields.type = 'Crypto can only be an expense.';
  const quantity = readQuantity(body.quantity, asset, fields);
  if (!isOneOf(EXPENSE_CATEGORIES, body.category)) {
    fields.category = `Choose one of: ${EXPENSE_CATEGORIES.join(', ')}.`;
  }
  const description = readDescription(body.description, fields);
  if (Object.keys(fields).length > 0) fail(fields);

  // Always a fresh quote at save time, never the preview the form showed.
  const quote = await fetchQuote(asset, quantity);
  return insert(
    {
      date: londonDate(), type: 'expense', asset, account: CRYPTO_ACCOUNT, category: body.category as string,
      description, amount_pence: quote.amountPence,
      quantity: quote.quantity, coin_id: quote.coinId, rate_gbp: quote.rateGbp, quoted_at: quote.quotedAt,
    },
    source,
    externalId,
  );
}

// ---------- Reading ----------

function monthRange(month: YearMonth) {
  return [`${month}-01`, lastDayOfMonth(month)] as const;
}

function categoryTotals(from: IsoDate, to: IsoDate): CategoryTotal[] {
  return getDb()
    .prepare(`
      SELECT category, SUM(amount_pence) AS amountPence FROM transactions
      WHERE type = 'expense' AND date BETWEEN ? AND ?
      GROUP BY category HAVING amountPence > 0
      ORDER BY amountPence DESC, category
    `)
    .all(from, to) as CategoryTotal[];
}

/** Everything the site shows for one month (defaults to the current London month). */
export function getDashboard(month?: string): DashboardResponse {
  const selected = resolveMonth(month);
  const [from, to] = monthRange(selected);
  const db = getDb();

  const balanceRows = db
    .prepare(`
      SELECT a.name AS account,
        a.opening_balance_pence + COALESCE(SUM(CASE t.type WHEN 'income' THEN t.amount_pence ELSE -t.amount_pence END), 0)
          AS balancePence
      FROM accounts a LEFT JOIN transactions t ON t.account = a.name AND t.date <= ?
      GROUP BY a.name
    `)
    .all(to) as { account: string; balancePence: number }[];
  const balances = new Map(balanceRows.map((row) => [row.account, row.balancePence]));
  const accounts = ACCOUNTS.map((account) => ({ account, balancePence: balances.get(account) ?? 0 }));

  const { incomePence, expensesPence } = db
    .prepare(`
      SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount_pence END), 0) AS incomePence,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_pence END), 0) AS expensesPence
      FROM transactions WHERE date BETWEEN ? AND ?
    `)
    .get(from, to) as { incomePence: number; expensesPence: number };

  const transactions = db
    .prepare(`SELECT * FROM transactions WHERE date BETWEEN ? AND ? ${NEWEST_FIRST}`)
    .all(from, to) as TransactionRow[];

  return {
    month: selected,
    availableMonths: availableMonths(),
    currentMonth: currentMonth(),
    today: londonDate(),
    totals: {
      incomePence,
      expensesPence,
      netPence: incomePence - expensesPence,
      totalBalancePence: accounts.reduce((sum, { balancePence }) => sum + balancePence, 0),
    },
    accounts,
    categories: categoryTotals(from, to),
    transactions: transactions.map(toTransaction),
  };
}

export type ExpenseList = {
  month: YearMonth;
  /** All expenses of the month, even if `expenses` was cut by `limit`. */
  totalCount: number;
  /** Newest first. Crypto rows keep `asset`, `quantity` and `rateGbp`; `amountPence` is the stored GBP amount. */
  expenses: Transaction[];
};

export const MAX_LIST_LIMIT = 100;

/** Expenses of a month (default: current), newest first, at most `limit` (1…100, default 20). */
export function listExpenses(options: { month?: string; limit?: number } = {}): ExpenseList {
  const month = resolveMonth(options.month);
  const [from, to] = monthRange(month);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20) || 20, 1), MAX_LIST_LIMIT);
  const db = getDb();

  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM transactions WHERE type = 'expense' AND date BETWEEN ? AND ?`)
    .get(from, to) as { count: number };
  const rows = db
    .prepare(`SELECT * FROM transactions WHERE type = 'expense' AND date BETWEEN ? AND ? ${NEWEST_FIRST} LIMIT ?`)
    .all(from, to, limit) as TransactionRow[];

  return { month, totalCount: count, expenses: rows.map(toTransaction) };
}

export type SpendingSummary = {
  month: YearMonth;
  expensesPence: number;
  expenseCount: number;
  /** Non-zero expense categories, largest first. */
  categories: CategoryTotal[];
};

/** Total GBP spending of a month (default: current) and its split by category. */
export function spendingSummary(month?: string): SpendingSummary {
  const selected = resolveMonth(month);
  const [from, to] = monthRange(selected);
  const { expensesPence, expenseCount } = getDb()
    .prepare(`
      SELECT COALESCE(SUM(amount_pence), 0) AS expensesPence, COUNT(*) AS expenseCount
      FROM transactions WHERE type = 'expense' AND date BETWEEN ? AND ?
    `)
    .get(from, to) as { expensesPence: number; expenseCount: number };
  return { month: selected, expensesPence, expenseCount, categories: categoryTotals(from, to) };
}

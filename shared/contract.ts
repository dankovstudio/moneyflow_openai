// MoneyFlow API contract shared by the frontend (src/) and the backend (server/).
// The backend implements these shapes as-is; neither side redeclares them.
// Money is always integer pence; crypto quantities and rates are decimal strings.

// ---------- Accounts, categories, assets ----------

export const GBP_ACCOUNTS = ['NatWest', 'Revolut', 'Payoneer', 'Cash'] as const;
export const CRYPTO_ACCOUNT = 'Crypto Wallet';
export const ACCOUNTS = [...GBP_ACCOUNTS, CRYPTO_ACCOUNT] as const;

export type GbpAccount = (typeof GBP_ACCOUNTS)[number];
export type CryptoAccount = typeof CRYPTO_ACCOUNT;
export type Account = (typeof ACCOUNTS)[number];

export const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Other'] as const;
export const EXPENSE_CATEGORIES = [
  'Housing', 'Groceries', 'Transport', 'Dining', 'Shopping',
  'Subscriptions', 'Health', 'Other',
] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type TransactionType = 'income' | 'expense';

export const CRYPTO_ASSETS = ['USDT', 'USDC', 'ETH', 'BTC', 'SOL'] as const;
export const ASSETS = ['GBP', ...CRYPTO_ASSETS] as const;

export type CryptoAsset = (typeof CRYPTO_ASSETS)[number];
export type Asset = (typeof ASSETS)[number];

/** CoinGecko coin IDs; prices are requested directly in GBP (vs_currencies=gbp). */
export const COINGECKO_IDS = {
  USDT: 'tether',
  USDC: 'usd-coin',
  ETH: 'ethereum',
  BTC: 'bitcoin',
  SOL: 'solana',
} as const satisfies Record<CryptoAsset, string>;

export type CoinGeckoId = (typeof COINGECKO_IDS)[CryptoAsset];

export const isCryptoAsset = (value: string): value is CryptoAsset =>
  CRYPTO_ASSETS.some((asset) => asset === value);

// ---------- Dates and periods ----------

/** Calendar dates and months are Europe/London. Timestamps are UTC ISO 8601. */
export const TIME_ZONE = 'Europe/London';
/** First day with data (lesson 1 demo set). GBP dates range from here to today. */
export const MIN_DATE = '2026-09-01';
export const FIRST_MONTH = '2026-09';

/** YYYY-MM-DD */
export type IsoDate = string;
/** YYYY-MM */
export type YearMonth = string;
/** Non-negative decimal written as a string, e.g. "0.1" or "0.00125". */
export type DecimalString = string;

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;

// ---------- Amount rules ----------

/** Smallest storable amount; a crypto expense worth less is rejected with amount_too_small. */
export const MIN_AMOUNT_PENCE = 1;
/** Upper limit for a GBP amount: £1,000,000.00. */
export const MAX_GBP_AMOUNT_PENCE = 100_000_000;
export const MAX_QUANTITY_DECIMALS = 8;

const GBP_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const QUANTITY_PATTERN = new RegExp(`^\\d{1,12}(?:\\.\\d{1,${MAX_QUANTITY_DECIMALS}})?$`);

/** "12.50" → 1250. Returns null unless 0.01 ≤ amount ≤ £1,000,000.00 with ≤ 2 decimals. */
export function parseGbpAmountPence(value: string): number | null {
  const amount = value.trim();
  if (!GBP_AMOUNT_PATTERN.test(amount)) return null;

  const [pounds, decimals = ''] = amount.split('.');
  const pence = Number(pounds) * 100 + Number(decimals.padEnd(2, '0'));
  return pence >= MIN_AMOUNT_PENCE && pence <= MAX_GBP_AMOUNT_PENCE ? pence : null;
}

/** Positive coin quantity with up to 12 integer digits and MAX_QUANTITY_DECIMALS decimals. */
export function isValidQuantity(value: string): boolean {
  const quantity = value.trim();
  return QUANTITY_PATTERN.test(quantity) && /[1-9]/.test(quantity);
}

// ---------- Transactions ----------

export type TransactionSource = 'seed' | 'web' | 'telegram';

type TransactionMeta = {
  id: string;
  date: IsoDate;
  description: string;
  /** Final GBP amount in pence, always positive; `type` gives the direction. */
  amountPence: number;
  /** UTC ISO timestamp of when the row was stored. */
  createdAt: string;
  source: TransactionSource;
};

export type GbpTransaction = TransactionMeta & {
  asset: 'GBP';
  account: GbpAccount;
} & (
  | { type: 'income'; category: IncomeCategory }
  | { type: 'expense'; category: ExpenseCategory }
);

/** Crypto is expense-only, always on Crypto Wallet, dated "today" at the moment of saving. */
export type CryptoTransaction = TransactionMeta & {
  asset: CryptoAsset;
  type: 'expense';
  account: CryptoAccount;
  category: ExpenseCategory;
  quantity: DecimalString;
  coinId: CoinGeckoId;
  /** GBP per 1 coin, fixed at save time and never re-priced. */
  rateGbp: DecimalString;
  /** UTC ISO timestamp of the CoinGecko quote. */
  quotedAt: string;
};

export type Transaction = GbpTransaction | CryptoTransaction;

// ---------- Endpoints ----------

export const API_PATHS = {
  health: '/api/health',
  dashboard: '/api/dashboard',
  quote: '/api/quote',
  transactions: '/api/transactions',
} as const;

/** GET /api/health */
export type HealthResponse = { ok: true };

/**
 * GET /api/dashboard?month=YYYY-MM
 * `month` is optional and defaults to the current month; a month outside
 * `availableMonths` is rejected with validation_failed.
 */
export type DashboardQuery = { month?: YearMonth };

export type AccountBalance = {
  account: Account;
  /** Opening balance plus every transaction dated up to the last day of the month. */
  balancePence: number;
};

export type CategoryTotal = {
  category: ExpenseCategory;
  amountPence: number;
};

export type DashboardResponse = {
  month: YearMonth;
  /** From FIRST_MONTH to currentMonth, oldest first. */
  availableMonths: YearMonth[];
  currentMonth: YearMonth;
  today: IsoDate;
  /** Income, expenses and net cover the selected month only. */
  totals: {
    incomePence: number;
    expensesPence: number;
    netPence: number;
    /** Sum of all five account balances at the end of the month. */
    totalBalancePence: number;
  };
  /** All five accounts, in ACCOUNTS order. */
  accounts: AccountBalance[];
  /** Expense categories with a non-zero total, largest first. */
  categories: CategoryTotal[];
  /** Transactions of the month, newest date first (ties: newest createdAt first). */
  transactions: Transaction[];
};

/** GET /api/quote?asset=ETH&quantity=0.1 — preview only, stores nothing. */
export type QuoteQuery = { asset: CryptoAsset; quantity: DecimalString };

export type QuoteResponse = {
  asset: CryptoAsset;
  coinId: CoinGeckoId;
  quantity: DecimalString;
  rateGbp: DecimalString;
  amountPence: number;
  quotedAt: string;
};

/** POST /api/transactions for GBP. `amount` is pounds as a decimal string, e.g. "12.50". */
export type CreateGbpTransactionRequest = {
  asset: 'GBP';
  amount: DecimalString;
  account: GbpAccount;
  description: string;
  date: IsoDate;
} & (
  | { type: 'income'; category: IncomeCategory }
  | { type: 'expense'; category: ExpenseCategory }
);

/** POST /api/transactions for crypto. The server sets Crypto Wallet, today's date and the final quote. */
export type CreateCryptoTransactionRequest = {
  asset: CryptoAsset;
  type: 'expense';
  quantity: DecimalString;
  category: ExpenseCategory;
  description: string;
};

export type CreateTransactionRequest = CreateGbpTransactionRequest | CreateCryptoTransactionRequest;

/** 201 Created: the stored transaction. */
export type CreateTransactionResponse = Transaction;

// ---------- Errors ----------

export const ERROR_STATUS = {
  validation_failed: 400,
  unsupported_asset: 400,
  amount_too_small: 400,
  coingecko_key_missing: 503,
  quote_unavailable: 502,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export type TransactionField =
  | 'type' | 'asset' | 'amount' | 'quantity' | 'account' | 'category' | 'description' | 'date';

/** Every non-2xx response has this body. `fields` maps form fields to messages. */
export type ApiErrorResponse = {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Partial<Record<TransactionField, string>>;
  };
};

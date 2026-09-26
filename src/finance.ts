import {
  ACCOUNTS,
  EXPENSE_CATEGORIES,
  INITIAL_BALANCES_PENCE,
  type Account,
  type ExpenseCategory,
  type Transaction,
} from './data.ts';

export function calculateDashboard(transactions: Transaction[]) {
  const balancesPence: Record<Account, number> = { ...INITIAL_BALANCES_PENCE };
  const categoryTotalsPence = Object.fromEntries(
    EXPENSE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<ExpenseCategory, number>;

  let incomePence = 0;
  let expensesPence = 0;

  for (const transaction of transactions) {
    if (transaction.type === 'income') {
      incomePence += transaction.amountPence;
      balancesPence[transaction.account] += transaction.amountPence;
    } else {
      expensesPence += transaction.amountPence;
      balancesPence[transaction.account] -= transaction.amountPence;
      categoryTotalsPence[transaction.category] += transaction.amountPence;
    }
  }

  const spending = EXPENSE_CATEGORIES
    .map((category) => ({ category, amountPence: categoryTotalsPence[category] }))
    .filter(({ amountPence }) => amountPence > 0)
    .sort((a, b) => b.amountPence - a.amountPence);

  return {
    incomePence,
    expensesPence,
    netPence: incomePence - expensesPence,
    totalBalancePence: ACCOUNTS.reduce((sum, account) => sum + balancesPence[account], 0),
    balancesPence,
    spending,
    recentTransactions: [...transactions].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export const formatGBP = (pence: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pence / 100);

export const formatDate = (isoDate: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T12:00:00Z`));

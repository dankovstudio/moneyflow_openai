export const ACCOUNTS = ['NatWest', 'Revolut', 'Payoneer', 'Cash'] as const;
export type Account = (typeof ACCOUNTS)[number];

export const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Other'] as const;
export const EXPENSE_CATEGORIES = [
  'Housing', 'Groceries', 'Transport', 'Dining', 'Shopping',
  'Subscriptions', 'Health', 'Other',
] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const DEMO_DATE_MIN = '2026-09-01';
export const DEMO_DATE_MAX = '2026-09-30';
export const DEFAULT_TRANSACTION_DATE = '2026-09-26';

export type Transaction = {
  id: string;
  date: string;
  account: Account;
  description: string;
  amountPence: number;
} & (
  | { type: 'income'; category: IncomeCategory }
  | { type: 'expense'; category: ExpenseCategory }
);

export const INITIAL_BALANCES_PENCE: Record<Account, number> = {
  NatWest: 120000,
  Revolut: 30000,
  Payoneer: 60000,
  Cash: 20000,
};

export const INITIAL_TRANSACTIONS: Transaction[] = [
  { id: 'demo-01', date: '2026-09-01', type: 'income', account: 'NatWest', category: 'Salary', description: 'Monthly salary', amountPence: 420000 },
  { id: 'demo-02', date: '2026-09-02', type: 'expense', account: 'NatWest', category: 'Housing', description: 'Rent', amountPence: 200000 },
  { id: 'demo-03', date: '2026-09-05', type: 'income', account: 'Payoneer', category: 'Freelance', description: 'Project payment', amountPence: 85000 },
  { id: 'demo-04', date: '2026-09-08', type: 'expense', account: 'NatWest', category: 'Groceries', description: 'Tesco', amountPence: 8460 },
  { id: 'demo-05', date: '2026-09-10', type: 'expense', account: 'Revolut', category: 'Transport', description: 'TfL', amountPence: 4250 },
  { id: 'demo-06', date: '2026-09-11', type: 'expense', account: 'Revolut', category: 'Dining', description: 'Coffee shop', amountPence: 1890 },
  { id: 'demo-07', date: '2026-09-12', type: 'expense', account: 'NatWest', category: 'Subscriptions', description: 'Software subscription', amountPence: 6999 },
  { id: 'demo-08', date: '2026-09-14', type: 'expense', account: 'Cash', category: 'Dining', description: 'Dinner', amountPence: 14500 },
  { id: 'demo-09', date: '2026-09-16', type: 'expense', account: 'Payoneer', category: 'Shopping', description: 'Online purchase', amountPence: 12000 },
  { id: 'demo-10', date: '2026-09-18', type: 'expense', account: 'Revolut', category: 'Groceries', description: 'Market', amountPence: 5640 },
  { id: 'demo-11', date: '2026-09-20', type: 'expense', account: 'NatWest', category: 'Health', description: 'Gym', amountPence: 2900 },
  { id: 'demo-12', date: '2026-09-22', type: 'expense', account: 'Revolut', category: 'Transport', description: 'TfL', amountPence: 3200 },
];

// Lesson 1 demo data. The backend imports it once to seed SQLite;
// the frontend never reads it and always shows what the API returns.
import type {
  Account,
  ExpenseCategory,
  GbpAccount,
  IncomeCategory,
  IsoDate,
} from '../shared/contract.ts';

export type SeedTransaction = {
  id: string;
  date: IsoDate;
  account: GbpAccount;
  description: string;
  amountPence: number;
} & (
  | { type: 'income'; category: IncomeCategory }
  | { type: 'expense'; category: ExpenseCategory }
);

/** Opening balances on 1 September 2026, before any transaction. */
export const INITIAL_BALANCES_PENCE: Record<Account, number> = {
  NatWest: 120000,
  Revolut: 30000,
  Payoneer: 60000,
  Cash: 20000,
  'Crypto Wallet': 100000,
};

export const INITIAL_TRANSACTIONS: SeedTransaction[] = [
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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCOUNTS,
  CRYPTO_ACCOUNT,
  type DashboardResponse,
  type Transaction,
  type YearMonth,
} from '../shared/contract.ts';
import { ApiError, UNREACHABLE_MESSAGE, getDashboard } from './api.ts';
import {
  formatDate,
  formatDateTime,
  formatGBP,
  formatMonth,
  formatMonthName,
  formatRate,
  lastDayOfMonth,
} from './finance.ts';
import TransactionDialog from './TransactionDialog.tsx';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ready'; data: DashboardResponse };

export default function App() {
  const [selectedMonth, setSelectedMonth] = useState<YearMonth | undefined>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (month: YearMonth | undefined) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsRefreshing(true);
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));

    try {
      const data = await getDashboard(month, controller.signal);
      setState({ status: 'ready', data });
      setSelectedMonth(data.month);
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        status: 'error',
        error: error instanceof ApiError ? error : new ApiError('unreachable', UNREACHABLE_MESSAGE),
      });
    } finally {
      if (requestRef.current === controller) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(undefined);
    return () => requestRef.current?.abort();
  }, [load]);

  function changeMonth(month: YearMonth) {
    setSelectedMonth(month);
    void load(month);
  }

  function closeDialog() {
    setIsDialogOpen(false);
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  function handleSaved(transaction: Transaction) {
    closeDialog();
    changeMonth(transaction.date.slice(0, 7));
  }

  const data = state.status === 'ready' ? state.data : null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand" aria-label="MoneyFlow">
            <span className="brand-mark" aria-hidden="true">M</span>
            <span>MoneyFlow</span>
          </div>
          <div className="header-actions">
            {data && (
              <div className="period-picker">
                <label className="visually-hidden" htmlFor="month-select">Month</label>
                <select
                  id="month-select"
                  className="period-select"
                  value={selectedMonth ?? data.month}
                  onChange={(event) => changeMonth(event.target.value)}
                >
                  {[...data.availableMonths].reverse().map((month) => (
                    <option value={month} key={month}>
                      {formatMonth(month)}{month === data.currentMonth ? ' · Current' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              className="add-button"
              type="button"
              ref={addButtonRef}
              disabled={!data}
              onClick={() => setIsDialogOpen(true)}
            >
              <span aria-hidden="true">+</span> Add transaction
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard">
        {state.status === 'loading' && (
          <section className="panel status-panel" aria-live="polite" aria-busy="true">
            <p className="eyebrow">Loading</p>
            <h1 className="status-title">Loading your dashboard…</h1>
          </section>
        )}

        {state.status === 'error' && (
          <section className="panel status-panel" role="alert">
            <p className="eyebrow">Connection problem</p>
            <h1 className="status-title">
              {state.error.kind === 'unreachable' ? UNREACHABLE_MESSAGE : 'The dashboard could not be loaded'}
            </h1>
            <p className="status-text">
              {state.error.kind === 'unreachable'
                ? 'No data is shown until the backend answers. Make sure the API is running on 127.0.0.1:8787, then try again.'
                : state.error.message}
            </p>
            <button className="add-button" type="button" onClick={() => void load(selectedMonth)}>
              Try again
            </button>
          </section>
        )}

        {data && <Dashboard data={data} isRefreshing={isRefreshing} />}
      </main>

      {isDialogOpen && data && (
        <TransactionDialog
          today={data.today}
          onClose={closeDialog}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function Dashboard({ data, isRefreshing }: { data: DashboardResponse; isRefreshing: boolean }) {
  const monthLabel = formatMonth(data.month);
  const monthName = formatMonthName(data.month);
  const largestCategory = data.categories[0]?.amountPence ?? 0;
  const isCurrentMonth = data.month === data.currentMonth;
  const balanceDate = isCurrentMonth ? `Today, ${formatDate(data.today)}` : `As of ${formatDate(lastDayOfMonth(data.month))}`;

  return (
    <div className="dashboard-content" aria-busy={isRefreshing}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Personal finance overview</p>
          <h1>{monthLabel} at a glance</h1>
          <p className="intro">Your money across {ACCOUNTS.length} accounts, all in one place.</p>
        </div>
      </div>

      <section className="summary" aria-label={`${monthLabel} financial summary`}>
        <div className="summary-card summary-balance">
          <span className="summary-label">Total balance</span>
          <p className="summary-value">{formatGBP(data.totals.totalBalancePence)}</p>
          <p className="summary-note">All accounts · {balanceDate}</p>
        </div>
        <div className="summary-card">
          <span className="summary-label">Income</span>
          <p className="summary-value">{formatGBP(data.totals.incomePence)}</p>
          <p className="summary-note">Received in {monthName}</p>
        </div>
        <div className="summary-card">
          <span className="summary-label">Expenses</span>
          <p className="summary-value">{formatGBP(data.totals.expensesPence)}</p>
          <p className="summary-note">Spent in {monthName}</p>
        </div>
        <div className="summary-card">
          <span className="summary-label">Net</span>
          <p className="summary-value">{formatGBP(data.totals.netPence)}</p>
          <p className="summary-note">Income minus expenses</p>
        </div>
      </section>

      <div className="detail-grid">
        <section className="panel accounts-panel" aria-labelledby="accounts-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Where it sits</p>
              <h2 id="accounts-title">Accounts</h2>
            </div>
            <span className="panel-count">{balanceDate}</span>
          </div>
          <ul className="account-list">
            {data.accounts.map(({ account, balancePence }, index) => (
              <li className="account-row" key={account}>
                <span className={`account-symbol account-symbol-${index}`} aria-hidden="true">{account[0]}</span>
                <span className="account-name">
                  {account}
                  {account === CRYPTO_ACCOUNT && <span className="account-note">Book value in GBP</span>}
                </span>
                <span className="account-amount">{formatGBP(balancePence)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel spending-panel" aria-labelledby="spending-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">What went out</p>
              <h2 id="spending-title">Spending by category</h2>
            </div>
            <span className="panel-total">{formatGBP(data.totals.expensesPence)}</span>
          </div>
          {data.categories.length > 0 ? (
            <ul className="spending-list">
              {data.categories.map(({ category, amountPence }) => (
                <li className="spending-row" key={category}>
                  <div className="spending-labels">
                    <span>{category}</span>
                    <span>{formatGBP(amountPence)}</span>
                  </div>
                  <div className="spending-track" aria-hidden="true">
                    <span style={{ width: `${(amountPence / largestCategory) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No expenses in {monthLabel}.</p>
          )}
        </section>
      </div>

      <section className="panel transactions-panel" aria-labelledby="transactions-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">The details</p>
            <h2 id="transactions-title">Transactions · {monthLabel}</h2>
          </div>
          <span className="panel-count">
            {data.transactions.length} {data.transactions.length === 1 ? 'transaction' : 'transactions'}
          </span>
        </div>
        {data.transactions.length > 0 ? (
          <div className="transactions-list">
            <div className="transaction-heading" aria-hidden="true">
              <span>Date</span><span>Description</span><span>Account</span><span>Category</span><span>Type</span><span>Amount</span>
            </div>
            <ul>
              {data.transactions.map((transaction) => (
                <li className="transaction-row" key={transaction.id}>
                  <span className="transaction-description">
                    {transaction.description}
                    {transaction.asset !== 'GBP' && (
                      <span
                        className="transaction-asset"
                        title={`Rate ${formatRate(transaction.rateGbp)} per ${transaction.asset}, quoted ${formatDateTime(transaction.quotedAt)}`}
                      >
                        <span aria-hidden="true"> · </span>
                        {transaction.quantity} {transaction.asset}
                      </span>
                    )}
                  </span>
                  <div className="transaction-meta">
                    <time className="transaction-date" dateTime={transaction.date}>{formatDate(transaction.date)}</time>
                    <span className="transaction-account">{transaction.account}</span>
                    <span className="transaction-category">{transaction.category}</span>
                  </div>
                  <span className={`transaction-type transaction-type-${transaction.type}`}>
                    {transaction.type === 'income' ? 'Income' : 'Expense'}
                  </span>
                  <span className={`transaction-amount transaction-amount-${transaction.type}`}>
                    {transaction.type === 'income' ? '+' : '−'}{formatGBP(transaction.amountPence)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="empty-state">No transactions in {monthLabel}. Pick another month above.</p>
        )}
      </section>
    </div>
  );
}

import { useRef, useState } from 'react';
import { ACCOUNTS, INITIAL_TRANSACTIONS, type Transaction } from './data.ts';
import { calculateDashboard, formatDate, formatGBP } from './finance.ts';
import TransactionDialog from './TransactionDialog.tsx';

export default function App() {
  const [transactions, setTransactions] = useState<Transaction[]>(() => [...INITIAL_TRANSACTIONS]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const dashboard = calculateDashboard(transactions);
  const largestCategory = dashboard.spending[0]?.amountPence ?? 0;

  function closeDialog() {
    setIsDialogOpen(false);
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  function addTransaction(transaction: Transaction) {
    setTransactions((current) => [transaction, ...current]);
    closeDialog();
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand" aria-label="MoneyFlow">
            <span className="brand-mark" aria-hidden="true">M</span>
            <span>MoneyFlow</span>
          </div>
          <div className="header-actions">
            <span className="period-label">September 2026 <span aria-hidden="true">·</span> Demo</span>
            <button className="add-button" type="button" ref={addButtonRef} onClick={() => setIsDialogOpen(true)}>
              <span aria-hidden="true">+</span> Add transaction
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Personal finance overview</p>
            <h1>September at a glance</h1>
            <p className="intro">Your money across four accounts, all in one place.</p>
          </div>
        </div>

        <section className="summary" aria-label="September financial summary">
          <div className="summary-card summary-balance">
            <span className="summary-label">Total balance</span>
            <p className="summary-value">{formatGBP(dashboard.totalBalancePence)}</p>
            <p className="summary-note">Across all four accounts</p>
          </div>
          <div className="summary-card">
            <span className="summary-label">Income</span>
            <p className="summary-value">{formatGBP(dashboard.incomePence)}</p>
            <p className="summary-note">Received this month</p>
          </div>
          <div className="summary-card">
            <span className="summary-label">Expenses</span>
            <p className="summary-value">{formatGBP(dashboard.expensesPence)}</p>
            <p className="summary-note">Spent this month</p>
          </div>
          <div className="summary-card">
            <span className="summary-label">Net</span>
            <p className="summary-value">{formatGBP(dashboard.netPence)}</p>
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
              <span className="panel-count">4 accounts</span>
            </div>
            <ul className="account-list">
              {ACCOUNTS.map((account, index) => (
                <li className="account-row" key={account}>
                  <span className={`account-symbol account-symbol-${index}`} aria-hidden="true">{account[0]}</span>
                  <span className="account-name">{account}</span>
                  <span className="account-amount">{formatGBP(dashboard.balancesPence[account])}</span>
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
              <span className="panel-total">{formatGBP(dashboard.expensesPence)}</span>
            </div>
            {dashboard.spending.length > 0 ? (
              <ul className="spending-list">
                {dashboard.spending.map(({ category, amountPence }) => (
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
              <p className="empty-state">No expenses this month.</p>
            )}
          </section>
        </div>

        <section className="panel transactions-panel" aria-labelledby="transactions-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">The details</p>
              <h2 id="transactions-title">Recent transactions</h2>
            </div>
            <span className="panel-count">{dashboard.recentTransactions.length} transactions</span>
          </div>
          {dashboard.recentTransactions.length > 0 ? (
            <div className="transactions-list">
              <div className="transaction-heading" aria-hidden="true">
                <span>Date</span><span>Description</span><span>Account</span><span>Category</span><span>Type</span><span>Amount</span>
              </div>
              <ul>
                {dashboard.recentTransactions.map((transaction) => (
                  <li className="transaction-row" key={transaction.id}>
                    <span className="transaction-description">{transaction.description}</span>
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
            <p className="empty-state">No transactions this month.</p>
          )}
        </section>
      </main>
      {isDialogOpen && (
        <TransactionDialog
          onClose={closeDialog}
          onAdd={addTransaction}
        />
      )}
    </div>
  );
}

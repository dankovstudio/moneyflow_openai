import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ACCOUNTS,
  DEFAULT_TRANSACTION_DATE,
  DEMO_DATE_MAX,
  DEMO_DATE_MIN,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type ExpenseCategory,
  type IncomeCategory,
  type Transaction,
} from './data.ts';

type FormValues = {
  type: 'income' | 'expense';
  amount: string;
  account: string;
  category: string;
  description: string;
  date: string;
};

type FieldName = keyof FormValues;
type FormErrors = Partial<Record<FieldName, string>>;

const INITIAL_FORM: FormValues = {
  type: 'expense',
  amount: '',
  account: '',
  category: '',
  description: '',
  date: DEFAULT_TRANSACTION_DATE,
};

const MAX_AMOUNT_PENCE = 100_000_000;

function parseAmountPence(value: string): number | null {
  const amount = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return null;

  const [pounds, decimals = ''] = amount.split('.');
  const pence = Number(pounds) * 100 + Number(decimals.padEnd(2, '0'));
  return pence > 0 && pence <= MAX_AMOUNT_PENCE ? pence : null;
}

function validate(values: FormValues): { errors: FormErrors; amountPence: number | null } {
  const errors: FormErrors = {};
  const amountPence = parseAmountPence(values.amount);
  const categories = values.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  if (amountPence === null) errors.amount = 'Enter an amount from £0.01 to £1,000,000.00, up to 2 decimal places.';
  if (!ACCOUNTS.some((account) => account === values.account)) errors.account = 'Choose an account.';
  if (!categories.some((category) => category === values.category)) errors.category = 'Choose a category.';
  if (!values.description.trim()) errors.description = 'Enter a description.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || values.date < DEMO_DATE_MIN || values.date > DEMO_DATE_MAX) {
    errors.date = 'Choose a date in September 2026.';
  }

  return { errors, amountPence };
}

type Props = {
  onClose: () => void;
  onAdd: (transaction: Transaction) => void;
};

export default function TransactionDialog({ onClose, onAdd }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<FormValues>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const categories = values.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLSelectElement>('#field-type')?.focus();
    }
  }, []);

  function updateField(field: Exclude<FieldName, 'type'>, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function updateType(type: FormValues['type']) {
    setValues((current) => ({ ...current, type, category: '' }));
    setErrors((current) => ({ ...current, type: undefined, category: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(values);
    setErrors(result.errors);

    const firstError = Object.keys(result.errors)[0] as FieldName | undefined;
    if (firstError) {
      dialogRef.current?.querySelector<HTMLElement>(`#field-${firstError}`)?.focus();
      return;
    }

    const common = {
      id: crypto.randomUUID(),
      date: values.date,
      account: values.account as Transaction['account'],
      description: values.description.trim(),
      amountPence: result.amountPence!,
    };
    const transaction: Transaction = values.type === 'income'
      ? { ...common, type: 'income', category: values.category as IncomeCategory }
      : { ...common, type: 'expense', category: values.category as ExpenseCategory };

    onAdd(transaction);
  }

  return (
    <dialog className="transaction-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="dialog-title" aria-describedby="dialog-intro">
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">September 2026 · Demo</p>
          <h2 id="dialog-title">Add transaction</h2>
          <p id="dialog-intro">Record an income or expense for this month.</p>
        </div>
        <button className="dialog-close" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
      </div>

      <form className="transaction-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="field-type">Type</label>
            <select id="field-type" value={values.type} onChange={(event) => updateType(event.target.value === 'income' ? 'income' : 'expense')}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="field-amount">Amount <span className="field-unit">GBP</span></label>
            <input id="field-amount" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values.amount} onChange={(event) => updateField('amount', event.target.value)} aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'amount-help amount-error' : 'amount-help'} />
            <p className="field-help" id="amount-help">Up to £1,000,000.00, 2 decimal places max.</p>
            {errors.amount && <p className="field-error" id="amount-error" role="alert">{errors.amount}</p>}
          </div>

          <div className="form-field">
            <label htmlFor="field-account">Account</label>
            <select id="field-account" value={values.account} onChange={(event) => updateField('account', event.target.value)} aria-invalid={Boolean(errors.account)} aria-describedby={errors.account ? 'account-error' : undefined}>
              <option value="">Select account</option>
              {ACCOUNTS.map((account) => <option value={account} key={account}>{account}</option>)}
            </select>
            {errors.account && <p className="field-error" id="account-error" role="alert">{errors.account}</p>}
          </div>

          <div className="form-field">
            <label htmlFor="field-category">Category</label>
            <select id="field-category" value={values.category} onChange={(event) => updateField('category', event.target.value)} aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? 'category-error' : undefined}>
              <option value="">Select category</option>
              {categories.map((category) => <option value={category} key={category}>{category}</option>)}
            </select>
            {errors.category && <p className="field-error" id="category-error" role="alert">{errors.category}</p>}
          </div>

          <div className="form-field form-field-wide">
            <label htmlFor="field-description">Description</label>
            <input id="field-description" type="text" autoComplete="off" placeholder="What was it for?" value={values.description} onChange={(event) => updateField('description', event.target.value)} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'description-error' : undefined} />
            {errors.description && <p className="field-error" id="description-error" role="alert">{errors.description}</p>}
          </div>

          <div className="form-field form-field-wide">
            <label htmlFor="field-date">Date</label>
            <input id="field-date" type="date" min={DEMO_DATE_MIN} max={DEMO_DATE_MAX} value={values.date} onChange={(event) => updateField('date', event.target.value)} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? 'date-help date-error' : 'date-help'} />
            <p className="field-help" id="date-help">September 2026 only.</p>
            {errors.date && <p className="field-error" id="date-error" role="alert">{errors.date}</p>}
          </div>
        </div>

        <div className="dialog-actions">
          <button className="cancel-button" type="button" onClick={onClose}>Cancel</button>
          <button className="save-button" type="submit">Add transaction</button>
        </div>
      </form>
    </dialog>
  );
}

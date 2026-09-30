import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ASSETS,
  CRYPTO_ACCOUNT,
  EXPENSE_CATEGORIES,
  GBP_ACCOUNTS,
  INCOME_CATEGORIES,
  MAX_QUANTITY_DECIMALS,
  MIN_DATE,
  isCryptoAsset,
  isValidQuantity,
  parseGbpAmountPence,
  type Asset,
  type CreateTransactionRequest,
  type CryptoAsset,
  type ExpenseCategory,
  type GbpAccount,
  type IncomeCategory,
  type IsoDate,
  type QuoteResponse,
  type Transaction,
  type TransactionField,
} from '../shared/contract.ts';
import { ApiError, UNREACHABLE_MESSAGE, createTransaction, getQuote } from './api.ts';
import { formatDate, formatDateTime, formatGBP, formatRate } from './finance.ts';

type FormValues = {
  type: 'income' | 'expense';
  asset: Asset;
  amount: string;
  account: string;
  category: string;
  description: string;
  date: string;
};

type FieldName = Exclude<keyof FormValues, 'type'>;
type FormErrors = Partial<Record<FieldName, string>>;

type QuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; quote: QuoteResponse }
  | { status: 'error'; message: string };

const QUOTE_DELAY_MS = 600;
const FIELD_ORDER: FieldName[] = ['asset', 'amount', 'account', 'category', 'description', 'date'];

const GBP_AMOUNT_ERROR = 'Enter an amount from £0.01 to £1,000,000.00, up to 2 decimal places.';
const quantityError = (asset: CryptoAsset) =>
  `Enter a positive number of ${asset}, up to ${MAX_QUANTITY_DECIMALS} decimal places.`;

function validate(values: FormValues, today: IsoDate): FormErrors {
  const errors: FormErrors = {};
  const categories: readonly string[] = values.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  if (!ASSETS.some((asset) => asset === values.asset) || (values.type === 'income' && values.asset !== 'GBP')) {
    errors.asset = 'Choose GBP, USDT, USDC, ETH, BTC or SOL.';
  }
  if (isCryptoAsset(values.asset)) {
    if (!isValidQuantity(values.amount)) errors.amount = quantityError(values.asset);
    if (values.account !== CRYPTO_ACCOUNT) errors.account = `${values.asset} can only be paid from ${CRYPTO_ACCOUNT}.`;
  } else {
    if (parseGbpAmountPence(values.amount) === null) errors.amount = GBP_AMOUNT_ERROR;
    if (!GBP_ACCOUNTS.some((account) => account === values.account)) errors.account = 'Choose an account.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || values.date < MIN_DATE || values.date > today) {
      errors.date = `Choose a date from ${formatDate(MIN_DATE)} to today.`;
    }
  }
  if (!categories.includes(values.category)) errors.category = 'Choose a category.';
  if (!values.description.trim()) errors.description = 'Enter a description.';

  return errors;
}

function toRequest(values: FormValues): CreateTransactionRequest {
  const description = values.description.trim();
  if (isCryptoAsset(values.asset)) {
    return {
      asset: values.asset,
      type: 'expense',
      quantity: values.amount.trim(),
      category: values.category as ExpenseCategory,
      description,
    };
  }
  const common = {
    asset: 'GBP' as const,
    amount: values.amount.trim(),
    account: values.account as GbpAccount,
    description,
    date: values.date,
  };
  return values.type === 'income'
    ? { ...common, type: 'income', category: values.category as IncomeCategory }
    : { ...common, type: 'expense', category: values.category as ExpenseCategory };
}

/** Maps contract field names to form fields: crypto quantity lives in the Amount input. */
function toFormErrors(fields: Partial<Record<TransactionField, string>> = {}): FormErrors {
  const errors: FormErrors = {};
  for (const [field, message] of Object.entries(fields) as [TransactionField, string][]) {
    if (field === 'type') continue;
    errors[field === 'quantity' ? 'amount' : field] = message;
  }
  return errors;
}

function quoteErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return 'The estimate is unavailable right now.';
  if (error.kind === 'unreachable') return `${UNREACHABLE_MESSAGE}. No estimate yet.`;
  return error.message;
}

type Props = {
  today: IsoDate;
  onClose: () => void;
  onSaved: (transaction: Transaction) => void;
};

export default function TransactionDialog({ today, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submittingRef = useRef(false);
  const [values, setValues] = useState<FormValues>({
    type: 'expense',
    asset: 'GBP',
    amount: '',
    account: '',
    category: '',
    description: '',
    date: today,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quote, setQuote] = useState<QuoteState>({ status: 'idle' });
  const [quoteRequest, setQuoteRequest] = useState(0);

  const isCrypto = isCryptoAsset(values.asset);
  const categories = values.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const assetOptions: readonly Asset[] = values.type === 'income' ? ['GBP'] : ASSETS;
  const accountOptions: readonly string[] = isCrypto ? [CRYPTO_ACCOUNT] : GBP_ACCOUNTS;
  const quantity = values.amount.trim();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLSelectElement>('#field-type')?.focus();
    }
  }, []);

  // Preview estimate: fetched after typing pauses or when the field loses focus.
  useEffect(() => {
    if (!isCryptoAsset(values.asset) || !isValidQuantity(quantity)) {
      setQuote({ status: 'idle' });
      return;
    }
    const asset = values.asset;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setQuote({ status: 'loading' });
      try {
        setQuote({ status: 'ready', quote: await getQuote({ asset, quantity }, controller.signal) });
      } catch (error) {
        if (!controller.signal.aborted) setQuote({ status: 'error', message: quoteErrorMessage(error) });
      }
    }, quoteRequest > 0 ? 0 : QUOTE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [values.asset, quantity, quoteRequest]);

  function updateField(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
    if (field === 'amount') setQuoteRequest(0);
  }

  function updateType(type: FormValues['type']) {
    setValues((current) => ({
      ...current,
      type,
      category: '',
      ...(type === 'income' && current.asset !== 'GBP' ? { asset: 'GBP', account: '', amount: '' } : {}),
    }));
    setErrors((current) => ({ ...current, asset: undefined, account: undefined, category: undefined }));
    setFormError(null);
  }

  function updateAsset(asset: Asset) {
    setValues((current) => {
      const switchesKind = isCryptoAsset(asset) !== isCryptoAsset(current.asset);
      return {
        ...current,
        asset,
        account: isCryptoAsset(asset) ? CRYPTO_ACCOUNT : switchesKind ? '' : current.account,
        amount: switchesKind ? '' : current.amount,
      };
    });
    setErrors((current) => ({ ...current, asset: undefined, amount: undefined, account: undefined, date: undefined }));
    setFormError(null);
    setQuoteRequest(0);
  }

  function requestQuoteNow() {
    if (isCrypto && isValidQuantity(quantity) && quote.status !== 'ready') setQuoteRequest((count) => count + 1);
  }

  function focusFirstError(fieldErrors: FormErrors) {
    const first = FIELD_ORDER.find((field) => fieldErrors[field]);
    if (first) dialogRef.current?.querySelector<HTMLElement>(`#field-${first}`)?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    const clientErrors = validate(values, today);
    setErrors(clientErrors);
    setFormError(null);
    if (Object.keys(clientErrors).length > 0) {
      focusFirstError(clientErrors);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const saved = await createTransaction(toRequest(values));
      onSaved(saved);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError('unreachable', UNREACHABLE_MESSAGE);
      const fieldErrors = toFormErrors(apiError.fields);
      if (apiError.code === 'amount_too_small') fieldErrors.amount ??= apiError.message;
      if (apiError.code === 'unsupported_asset') fieldErrors.asset ??= apiError.message;

      setErrors(fieldErrors);
      setFormError(
        apiError.kind === 'unreachable'
          ? `${UNREACHABLE_MESSAGE}. Nothing was saved; your entries are kept so you can try again.`
          : Object.keys(fieldErrors).length > 0
            ? null
            : `${apiError.message} Nothing was saved; your entries are kept so you can try again.`,
      );
      focusFirstError(fieldErrors);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  function requestClose() {
    if (!submittingRef.current) onClose();
  }

  const amountHelp = isCrypto
    ? `Number of ${values.asset} coins, not pounds. Up to ${MAX_QUANTITY_DECIMALS} decimal places.`
    : 'Up to £1,000,000.00, 2 decimal places max.';

  return (
    <dialog className="transaction-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); requestClose(); }} aria-labelledby="dialog-title" aria-describedby="dialog-intro">
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">New entry</p>
          <h2 id="dialog-title">Add transaction</h2>
          <p id="dialog-intro">Record an income or an expense in GBP or crypto.</p>
        </div>
        <button className="dialog-close" type="button" aria-label="Close dialog" onClick={requestClose} disabled={isSubmitting}>×</button>
      </div>

      <form className="transaction-form" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="field-type">Type</label>
            <select id="field-type" value={values.type} onChange={(event) => updateType(event.target.value === 'income' ? 'income' : 'expense')}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="field-asset">Asset</label>
            <select id="field-asset" value={values.asset} onChange={(event) => updateAsset(event.target.value as Asset)} aria-invalid={Boolean(errors.asset)} aria-describedby={errors.asset ? 'asset-help asset-error' : 'asset-help'}>
              {assetOptions.map((asset) => <option value={asset} key={asset}>{asset}</option>)}
            </select>
            <p className="field-help" id="asset-help">{values.type === 'income' ? 'Income is recorded in GBP.' : 'GBP or one of five crypto assets.'}</p>
            {errors.asset && <p className="field-error" id="asset-error" role="alert">{errors.asset}</p>}
          </div>

          <div className="form-field">
            <label htmlFor="field-amount">Amount <span className="field-unit">{values.asset}</span></label>
            <input id="field-amount" type="text" inputMode="decimal" autoComplete="off" placeholder={isCrypto ? '0.1' : '0.00'} value={values.amount} onChange={(event) => updateField('amount', event.target.value)} onBlur={requestQuoteNow} aria-invalid={Boolean(errors.amount)} aria-describedby={['amount-help', isCrypto && 'amount-estimate', errors.amount && 'amount-error'].filter(Boolean).join(' ')} />
            <p className="field-help" id="amount-help">{amountHelp}</p>
            {errors.amount && <p className="field-error" id="amount-error" role="alert">{errors.amount}</p>}
          </div>

          <div className="form-field">
            <label htmlFor="field-account">Account</label>
            <select id="field-account" value={values.account} onChange={(event) => updateField('account', event.target.value)} aria-invalid={Boolean(errors.account)} aria-describedby={isCrypto ? 'account-help' : errors.account ? 'account-error' : undefined}>
              {!isCrypto && <option value="">Select account</option>}
              {accountOptions.map((account) => <option value={account} key={account}>{account}</option>)}
            </select>
            {isCrypto && <p className="field-help" id="account-help">Crypto is always paid from {CRYPTO_ACCOUNT}.</p>}
            {errors.account && <p className="field-error" id="account-error" role="alert">{errors.account}</p>}
          </div>

          {isCrypto && (
            <div className="form-field form-field-wide">
              <div className={`estimate estimate-${quote.status}`} id="amount-estimate" aria-live="polite">
                {quote.status === 'idle' && <p>Enter a quantity to see the estimated value in GBP.</p>}
                {quote.status === 'loading' && <p>Getting an estimate…</p>}
                {quote.status === 'ready' && (
                  <>
                    <p className="estimate-value">Estimated {formatGBP(quote.quote.amountPence)}</p>
                    <p>
                      {quote.quote.quantity} {quote.quote.asset} at {formatRate(quote.quote.rateGbp)} per coin, quoted {formatDateTime(quote.quote.quotedAt)}.
                      {' '}The final amount is fixed with a fresh rate when you save.
                    </p>
                  </>
                )}
                {quote.status === 'error' && <p>{quote.message} You can still try to save; the rate is checked again then.</p>}
              </div>
            </div>
          )}

          <div className="form-field">
            <label htmlFor="field-category">Category</label>
            <select id="field-category" value={values.category} onChange={(event) => updateField('category', event.target.value)} aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? 'category-error' : undefined}>
              <option value="">Select category</option>
              {categories.map((category) => <option value={category} key={category}>{category}</option>)}
            </select>
            {errors.category && <p className="field-error" id="category-error" role="alert">{errors.category}</p>}
          </div>

          <div className="form-field">
            {isCrypto ? (
              <>
                <label htmlFor="field-date">Date</label>
                <input id="field-date" type="text" readOnly value={`Today, ${formatDate(today)}`} aria-describedby="date-help" />
                <p className="field-help" id="date-help">Crypto is recorded today at the rate when you save.</p>
              </>
            ) : (
              <>
                <label htmlFor="field-date">Date</label>
                <input id="field-date" type="date" min={MIN_DATE} max={today} value={values.date} onChange={(event) => updateField('date', event.target.value)} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? 'date-help date-error' : 'date-help'} />
                <p className="field-help" id="date-help">From {formatDate(MIN_DATE)} to today.</p>
                {errors.date && <p className="field-error" id="date-error" role="alert">{errors.date}</p>}
              </>
            )}
          </div>

          <div className="form-field form-field-wide">
            <label htmlFor="field-description">Description</label>
            <input id="field-description" type="text" autoComplete="off" placeholder="What was it for?" value={values.description} onChange={(event) => updateField('description', event.target.value)} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'description-error' : undefined} />
            {errors.description && <p className="field-error" id="description-error" role="alert">{errors.description}</p>}
          </div>
        </div>

        {formError && <p className="form-error" role="alert">{formError}</p>}

        <div className="dialog-actions">
          <button className="cancel-button" type="button" onClick={requestClose} disabled={isSubmitting}>Cancel</button>
          <button className="save-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Add transaction'}</button>
        </div>
      </form>
    </dialog>
  );
}

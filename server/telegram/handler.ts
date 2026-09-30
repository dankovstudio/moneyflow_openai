// Turns one text message from the allowed chat into a reply. All writes go through
// createTransaction(…, { source: 'telegram', externalId }) in server/service.ts.
import {
  CRYPTO_ACCOUNT,
  CRYPTO_ASSETS,
  EXPENSE_CATEGORIES,
  GBP_ACCOUNTS,
  TIME_ZONE,
  type CreateTransactionRequest,
  type Transaction,
} from '../../shared/contract.ts';
import { ServiceError, createTransaction, formatGbp, londonDate } from '../service.ts';
import { CRYPTO_EXAMPLE, GBP_EXAMPLE, parseMessage } from './parse.ts';

export const HELP_TEXT = [
  'MoneyFlow bot — add an expense with one message.',
  '',
  'GBP expense: amount description / account / category',
  `  ${GBP_EXAMPLE}`,
  '  Date: the day you send the message (London time).',
  '',
  'Crypto expense: quantity coin description',
  `  ${CRYPTO_EXAMPLE}`,
  '  20 USDT Netflix',
  '  15 USDC Hosting',
  '  0.001 BTC Service',
  '  0.5 SOL, Coffee',
  `  Priced in GBP by CoinGecko right now, saved today to ${CRYPTO_ACCOUNT}, category Other.`,
  '',
  `Accounts: ${GBP_ACCOUNTS.join(', ')}`,
  `Categories: ${EXPENSE_CATEGORIES.join(', ')}`,
  `Coins: ${CRYPTO_ASSETS.join(', ')}`,
  'Upper or lower case does not matter.',
].join('\n');

export type MessageContext = {
  /** Chat part of the idempotency key: telegram:<chatKey>:<messageId>. */
  chatKey: string;
  messageId: number;
  /** When Telegram received the message; GBP expenses are dated by it. */
  sentAt: Date;
};

export type Reply = { text: string; outcome: 'saved' | 'duplicate' | 'rejected' | 'help' };

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
const rateFormat = (rate: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    ...(rate < 1 && { maximumSignificantDigits: 4 }),
  }).format(rate);

/** "2026-09-30" → "Wed, 30 Sept 2026" (the date is already a London calendar day). */
const formatDay = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));

export function formatTransaction(transaction: Transaction): string {
  const lines = [
    `Date: ${formatDay(transaction.date)}`,
    `Description: ${transaction.description}`,
    `Account: ${transaction.account} · Category: ${transaction.category}`,
  ];
  if (transaction.asset === 'GBP') {
    lines.push(`Amount: ${formatGbp(transaction.amountPence)}`);
  } else {
    const quotedAt = timeFormat.format(new Date(transaction.quotedAt));
    lines.push(
      `Spent: ${transaction.quantity} ${transaction.asset}`,
      `Rate: ${rateFormat(Number(transaction.rateGbp))} per ${transaction.asset} (CoinGecko, ${quotedAt} London)`,
      `Total: ${formatGbp(transaction.amountPence)}`,
    );
  }
  return lines.join('\n');
}

export async function replyToText(text: string | undefined, context: MessageContext): Promise<Reply> {
  if (text === undefined) {
    return { text: 'Send the expense as a text message. Send /start for examples.', outcome: 'rejected' };
  }

  const parsed = parseMessage(text);
  let request: CreateTransactionRequest;
  let example: string;
  switch (parsed.kind) {
    case 'help':
      return { text: HELP_TEXT, outcome: 'help' };
    case 'unknown_command':
      return { text: `Unknown command ${parsed.command}. Send /start for examples.`, outcome: 'rejected' };
    case 'invalid':
      return { text: `❌ Not saved.\n${parsed.message}`, outcome: 'rejected' };
    case 'gbp':
      example = GBP_EXAMPLE;
      request = {
        asset: 'GBP',
        type: 'expense',
        amount: parsed.amount,
        description: parsed.description,
        account: parsed.account,
        category: parsed.category,
        date: londonDate(context.sentAt),
      };
      break;
    case 'crypto':
      example = CRYPTO_EXAMPLE;
      request = {
        asset: parsed.asset,
        type: 'expense',
        quantity: parsed.quantity,
        category: 'Other',
        description: parsed.description,
      };
      break;
  }

  try {
    const { transaction, created } = await createTransaction(request, {
      source: 'telegram',
      externalId: `telegram:${context.chatKey}:${context.messageId}`,
    });
    return created
      ? { text: `✅ Saved\n${formatTransaction(transaction)}`, outcome: 'saved' }
      : {
          text: `↩️ This message is already saved — nothing new was added.\n${formatTransaction(transaction)}`,
          outcome: 'duplicate',
        };
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    const hint = error.code === 'validation_failed' ? `\nExample: ${example}` : '';
    return { text: `❌ Not saved.\n${error.message}${hint}`, outcome: 'rejected' };
  }
}

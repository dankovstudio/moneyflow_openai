// Text formats the bot understands (no AI parsing):
//   GBP expense:    "12.50 Tesco / NatWest / Groceries"
//   crypto expense: "0.1 ETH Helius" or "0.1 ETH, Helius" (USDT, USDC, ETH, BTC, SOL)
// Amounts, quantities and descriptions are validated by server/service.ts; this file only
// splits the text and maps account/category/ticker to their canonical spelling.
import {
  CRYPTO_ACCOUNT,
  CRYPTO_ASSETS,
  EXPENSE_CATEGORIES,
  GBP_ACCOUNTS,
  isCryptoAsset,
  type CryptoAsset,
  type ExpenseCategory,
  type GbpAccount,
} from '../../shared/contract.ts';

export const GBP_EXAMPLE = '12.50 Tesco / NatWest / Groceries';
export const CRYPTO_EXAMPLE = '0.1 ETH Helius';

export type ParsedMessage =
  | { kind: 'help' }
  | { kind: 'unknown_command'; command: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'gbp'; amount: string; description: string; account: GbpAccount; category: ExpenseCategory }
  | { kind: 'crypto'; asset: CryptoAsset; quantity: string; description: string };

const COMMAND = /^\/([a-z0-9_]+)(?:@\w+)?(?:\s|$)/i;
// quantity, optional space, ticker, optional comma, description
const CRYPTO = /^(\d[\d.,]*|[.,]\d[\d.,]*)\s*([a-z]+)\b\s*,?\s*(.*)$/is;
const GBP_HEAD = /^£?\s*(\S+)(?:\s+(.*))?$/s;

const squash = (value: string) => value.toLowerCase().replace(/\s+/g, '');
const findIn = <T extends string>(list: readonly T[], value: string) =>
  list.find((item) => squash(item) === squash(value));
const listOr = (items: readonly string[]) => `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

export function parseMessage(input: string): ParsedMessage {
  const text = input.trim();

  const command = text.match(COMMAND);
  if (command) {
    const name = command[1].toLowerCase();
    return name === 'start' || name === 'help' ? { kind: 'help' } : { kind: 'unknown_command', command: `/${name}` };
  }

  const crypto = text.match(CRYPTO);
  const ticker = crypto?.[2] ?? '';
  if (crypto && isCryptoAsset(ticker.toUpperCase())) {
    return {
      kind: 'crypto',
      asset: ticker.toUpperCase() as CryptoAsset,
      quantity: crypto[1].replace(/,+$/, ''),
      description: crypto[3].trim(),
    };
  }

  if (text.includes('/')) return parseGbp(text);

  if (crypto) {
    const reason =
      ticker.toUpperCase() === 'GBP'
        ? 'A GBP expense needs an account and a category.'
        : `"${ticker}" is not a supported coin. Use one of: ${CRYPTO_ASSETS.join(', ')} — e.g. ${CRYPTO_EXAMPLE}.`;
    return { kind: 'invalid', message: `${reason}\nFor a GBP expense: ${GBP_EXAMPLE}` };
  }

  return {
    kind: 'invalid',
    message: `I didn't understand that. Send an expense like:\n${GBP_EXAMPLE}\n${CRYPTO_EXAMPLE}\n\nSend /start for all options.`,
  };
}

function parseGbp(text: string): ParsedMessage {
  const parts = text.split('/').map((part) => part.trim());
  if (parts.length < 3) {
    return {
      kind: 'invalid',
      message: `A GBP expense has three parts separated by "/": amount and description / account / category.\nExample: ${GBP_EXAMPLE}`,
    };
  }

  // The last two parts are account and category, so a description may itself contain "/".
  const categoryText = parts.pop()!;
  const accountText = parts.pop()!;
  const head = parts.join(' / ').match(GBP_HEAD);

  const problems: string[] = [];
  const account = findIn(GBP_ACCOUNTS, accountText);
  if (!account) {
    problems.push(
      squash(accountText) === squash(CRYPTO_ACCOUNT)
        ? `${CRYPTO_ACCOUNT} is only for crypto: send e.g. ${CRYPTO_EXAMPLE}.`
        : `${accountText ? `Unknown account "${accountText}".` : 'Add an account.'} Use ${listOr(GBP_ACCOUNTS)}.`,
    );
  }
  const category = findIn(EXPENSE_CATEGORIES, categoryText);
  if (!category) {
    problems.push(
      `${categoryText ? `Unknown category "${categoryText}".` : 'Add a category.'} Use ${listOr(EXPENSE_CATEGORIES)}.`,
    );
  }
  if (problems.length > 0) return { kind: 'invalid', message: `${problems.join('\n')}\nExample: ${GBP_EXAMPLE}` };

  return {
    kind: 'gbp',
    amount: head?.[1] ?? '',
    description: head?.[2]?.trim() ?? '',
    account: account!,
    category: category!,
  };
}

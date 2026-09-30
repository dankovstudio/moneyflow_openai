// CoinGecko Demo API: price of one coin directly in GBP, plus exact quantity × rate maths.
// The key is only sent in the request header; it never appears in responses or logs.
import {
  COINGECKO_IDS,
  MAX_GBP_AMOUNT_PENCE,
  MIN_AMOUNT_PENCE,
  type CryptoAsset,
  type QuoteResponse,
} from '../shared/contract.ts';
import { readEnv } from './env.ts';
import { ServiceError } from './errors.ts';

const PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

/** "0010.500" → "10.5" */
export function normalizeDecimal(value: string): string {
  const [integer, fraction = ''] = value.trim().split('.');
  const int = integer.replace(/^0+(?=\d)/, '');
  const frac = fraction.replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

function toScaled(value: string) {
  const [integer, fraction = ''] = value.split('.');
  return { digits: BigInt(integer + fraction), scale: fraction.length };
}

/** quantity × rate in pence using scaled integers (no floats), rounded half-up. */
export function toPence(quantity: string, rateGbp: string): bigint {
  const q = toScaled(quantity);
  const r = toScaled(rateGbp);
  const denominator = 10n ** BigInt(q.scale + r.scale);
  return (q.digits * r.digits * 100n * 2n + denominator) / (denominator * 2n);
}

/** Reads `{ "<coinId>": { "gbp": <price> } }`, keeping CoinGecko's exact digits. */
function extractRate(raw: string, coinId: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const price = (data as Record<string, { gbp?: unknown } | undefined> | null)?.[coinId]?.gbp;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;

  const literal = raw.match(/"gbp"\s*:\s*([-+0-9.eE]+)/)?.[1];
  const rate = literal && PLAIN_DECIMAL.test(literal) ? literal : price.toFixed(20);
  return normalizeDecimal(rate);
}

const unavailable = (asset: CryptoAsset, detail = 'try again in a moment') =>
  new ServiceError('quote_unavailable', `Couldn't get the ${asset} price from CoinGecko — ${detail}.`);

/** Live quote for `quantity` (a valid, normalized decimal string) of `asset`. Stores nothing. */
export async function fetchQuote(asset: CryptoAsset, quantity: string): Promise<QuoteResponse> {
  const apiKey = readEnv('COINGECKO_DEMO_API_KEY');
  if (!apiKey) {
    throw new ServiceError(
      'coingecko_key_missing',
      'CoinGecko API key is not configured: add COINGECKO_DEMO_API_KEY to .env (no restart needed).',
    );
  }

  const coinId = COINGECKO_IDS[asset];
  const url = `${PRICE_URL}?${new URLSearchParams({ ids: coinId, vs_currencies: 'gbp', precision: 'full' })}`;

  let response: Response;
  let raw: string;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'x-cg-demo-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    raw = await response.text();
  } catch (error) {
    console.warn(`[coingecko] ${coinId}: request failed (${(error as Error).name})`);
    throw unavailable(asset);
  }

  if (!response.ok) {
    console.warn(`[coingecko] ${coinId}: HTTP ${response.status}`);
    if (response.status === 401 || response.status === 403) {
      throw unavailable(asset, 'CoinGecko rejected the API key, check COINGECKO_DEMO_API_KEY in .env');
    }
    if (response.status === 429) throw unavailable(asset, 'rate limit reached, try again in a minute');
    throw unavailable(asset);
  }

  const rateGbp = extractRate(raw, coinId);
  if (!rateGbp) {
    console.warn(`[coingecko] ${coinId}: no GBP price in the response`);
    throw unavailable(asset, 'no GBP price was returned');
  }

  const pence = toPence(quantity, rateGbp);
  if (pence < BigInt(MIN_AMOUNT_PENCE)) {
    const message = `${quantity} ${asset} is worth less than £0.01. Enter a larger quantity.`;
    throw new ServiceError('amount_too_small', message, { quantity: message });
  }
  if (pence > BigInt(MAX_GBP_AMOUNT_PENCE)) {
    const message = `${quantity} ${asset} is worth more than £1,000,000.00. Enter a smaller quantity.`;
    throw new ServiceError('validation_failed', message, { quantity: message });
  }

  return { asset, coinId, quantity, rateGbp, amountPence: Number(pence), quotedAt: new Date().toISOString() };
}

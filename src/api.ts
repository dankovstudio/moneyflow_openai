import {
  API_PATHS,
  type ApiErrorResponse,
  type CreateTransactionRequest,
  type CreateTransactionResponse,
  type DashboardResponse,
  type ErrorCode,
  type QuoteQuery,
  type QuoteResponse,
  type TransactionField,
  type YearMonth,
} from '../shared/contract.ts';

/**
 * `unreachable`: no backend answered (network error, or the Vite proxy failing
 * to connect). `api`: the backend answered with a contract error.
 */
export class ApiError extends Error {
  readonly kind: 'unreachable' | 'api';
  readonly code?: ErrorCode;
  readonly fields?: Partial<Record<TransactionField, string>>;

  constructor(kind: 'unreachable' | 'api', message: string, body?: ApiErrorResponse['error']) {
    super(message);
    this.kind = kind;
    this.code = body?.code;
    this.fields = body?.fields;
  }
}

export const UNREACHABLE_MESSAGE = "Can't reach the MoneyFlow backend";

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  const error = (value as ApiErrorResponse | null)?.error;
  return typeof error?.code === 'string' && typeof error.message === 'string';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('unreachable', UNREACHABLE_MESSAGE);
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok && body !== undefined) return body as T;
  if (isApiErrorResponse(body)) throw new ApiError('api', body.error.message, body.error);
  throw new ApiError('unreachable', UNREACHABLE_MESSAGE);
}

export function getDashboard(month: YearMonth | undefined, signal?: AbortSignal) {
  const query = month ? `?${new URLSearchParams({ month })}` : '';
  return request<DashboardResponse>(`${API_PATHS.dashboard}${query}`, { signal });
}

export function getQuote(query: QuoteQuery, signal?: AbortSignal) {
  return request<QuoteResponse>(`${API_PATHS.quote}?${new URLSearchParams(query)}`, { signal });
}

export function createTransaction(body: CreateTransactionRequest) {
  return request<CreateTransactionResponse>(API_PATHS.transactions, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

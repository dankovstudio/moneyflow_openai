// Minimal Telegram Bot API client over the built-in fetch (no libraries, no webhook).
// The token is part of every request URL, so URLs are never logged.

const API_ROOT = 'https://api.telegram.org';
/** Long-polling wait inside getUpdates, seconds. */
export const POLL_TIMEOUT_SECONDS = 25;

export type TgChat = { id: number; type: string; title?: string; username?: string; first_name?: string };
export type TgUser = { id: number; is_bot: boolean; first_name: string; username?: string };
export type TgMessage = {
  message_id: number;
  /** Unix time, seconds. */
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
};
export type TgUpdate = { update_id: number; message?: TgMessage };

type TgResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error_code?: number; description?: string; parameters?: { retry_after?: number } };

/** An error answer from Telegram (`ok: false`), e.g. 401 bad token or 409 second poller. */
export class TelegramApiError extends Error {
  readonly method: string;
  readonly errorCode: number;
  readonly retryAfter?: number;

  constructor(method: string, errorCode: number, description: string, retryAfter?: number) {
    super(description);
    this.name = 'TelegramApiError';
    this.method = method;
    this.errorCode = errorCode;
    this.retryAfter = retryAfter;
  }
}

export function createTelegramApi(token: string) {
  async function call<T>(method: string, params: object, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(`${API_ROOT}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });

    let body: TgResponse<T>;
    try {
      body = (await response.json()) as TgResponse<T>;
    } catch {
      throw new TelegramApiError(method, response.status, `HTTP ${response.status} without a JSON body`);
    }
    if (!body.ok) {
      throw new TelegramApiError(
        method,
        body.error_code ?? response.status,
        body.description ?? `HTTP ${response.status}`,
        body.parameters?.retry_after,
      );
    }
    return body.result;
  }

  return {
    getMe: () => call<TgUser>('getMe', {}, 15_000),

    getUpdates: (offset: number, signal?: AbortSignal) =>
      call<TgUpdate[]>(
        'getUpdates',
        { offset, timeout: POLL_TIMEOUT_SECONDS, allowed_updates: ['message'] },
        (POLL_TIMEOUT_SECONDS + 10) * 1000,
        signal,
      ),

    sendMessage: (chatId: number, text: string, replyToMessageId?: number) =>
      call<TgMessage>(
        'sendMessage',
        {
          chat_id: chatId,
          text,
          link_preview_options: { is_disabled: true },
          ...(replyToMessageId && {
            reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true },
          }),
        },
        15_000,
      ),
  };
}

export type TelegramApi = ReturnType<typeof createTelegramApi>;

/** Short reason for a failed request without the URL (which contains the token). */
export function describeNetworkError(error: unknown): string {
  const failure = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (failure?.name === 'TimeoutError') return 'request timed out';
  return failure?.cause?.code ?? failure?.cause?.message ?? failure?.message ?? String(error);
}

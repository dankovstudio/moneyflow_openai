// MoneyFlow Telegram bot: one local process with long polling (`npm run bot`).
// Only TELEGRAM_ALLOWED_CHAT_ID may add expenses; every write goes through server/service.ts.
import { join } from 'node:path';
import { DB_PATH, ROOT_DIR, readEnv } from '../env.ts';
import { closeDb, getDb } from '../db.ts';
import {
  TelegramApiError,
  createTelegramApi,
  describeNetworkError,
  type TgMessage,
  type TgUpdate,
  type TgUser,
} from './api.ts';
import { HELP_TEXT, replyToText } from './handler.ts';

const ENV_PATH = join(ROOT_DIR, '.env');
const log = (message: string) => console.log(`[telegram] ${message}`);
const warn = (message: string) => console.warn(`[telegram] ${message}`);

const token = readEnv('TELEGRAM_BOT_TOKEN');
if (!token) {
  warn('TELEGRAM_BOT_TOKEN is not set, so the bot cannot start.');
  console.warn(`  1. Open https://t.me/BotFather, send /newbot and copy the token it gives you.`);
  console.warn(`  2. Put it into ${ENV_PATH} as TELEGRAM_BOT_TOKEN=<token>`);
  console.warn('  3. Run npm run bot again.');
  process.exit(1);
}

const api = createTelegramApi(token);
const stop = new AbortController();

/** Re-read on every message: editing .env applies without restarting the bot. */
const allowedChatIds = () =>
  (readEnv('TELEGRAM_ALLOWED_CHAT_ID') ?? '').split(/[\s,]+/).filter(Boolean);

const chatName = (message: TgMessage) =>
  message.chat.username ? `@${message.chat.username}` : (message.chat.title ?? message.chat.first_name ?? message.chat.type);

const setupText = (chatId: string, withHelp: boolean) =>
  [
    `👋 Your chat ID is ${chatId}.`,
    '',
    'This bot is not linked to a chat yet, so nothing is saved. To allow this chat, set',
    `TELEGRAM_ALLOWED_CHAT_ID=${chatId}`,
    "in the MoneyFlow project's .env file, save it and send /start again.",
    ...(withHelp ? ['', HELP_TEXT] : []),
  ].join('\n');

async function send(message: TgMessage, text: string) {
  try {
    await api.sendMessage(message.chat.id, text, message.message_id);
  } catch (error) {
    const reason = error instanceof TelegramApiError ? `${error.errorCode} ${error.message}` : describeNetworkError(error);
    warn(`could not reply to chat ${message.chat.id}: ${reason}`);
  }
}

async function handleUpdate(update: TgUpdate) {
  const message = update.message;
  if (!message || message.from?.is_bot) return;

  const chatId = String(message.chat.id);
  const preview = message.text === undefined ? '(not text)' : JSON.stringify(message.text.slice(0, 80));
  const allowed = allowedChatIds();

  if (allowed.length === 0) {
    warn(`chat ${chatId} (${chatName(message)}) wrote ${preview}, but TELEGRAM_ALLOWED_CHAT_ID is empty — nothing saved.`);
    console.warn(`  To allow this chat, put TELEGRAM_ALLOWED_CHAT_ID=${chatId} into ${ENV_PATH} and save the file.`);
    await send(message, setupText(chatId, /^\/(start|help)\b/i.test(message.text ?? '')));
    return;
  }
  if (!allowed.includes(chatId)) {
    warn(`ignored chat ${chatId} (${chatName(message)}): not TELEGRAM_ALLOWED_CHAT_ID — nothing saved.`);
    await send(message, 'This MoneyFlow bot is private. Nothing was saved.');
    return;
  }

  const reply = await replyToText(message.text, {
    chatKey: chatId,
    messageId: message.message_id,
    sentAt: new Date(message.date * 1000),
  });
  const reason = reply.outcome === 'rejected' ? `: ${reply.text.replace(/\s*\n\s*/g, ' ')}` : '';
  log(`chat ${chatId} #${message.message_id} ${preview} → ${reply.outcome}${reason}`);
  await send(message, reply.text);
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    stop.signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

function explainFatal(error: TelegramApiError): string | undefined {
  if (error.errorCode === 401 || error.errorCode === 404) {
    return `Telegram rejected TELEGRAM_BOT_TOKEN (${error.errorCode} ${error.message}). ` +
      `Copy the token from @BotFather again into ${ENV_PATH} and run npm run bot.`;
  }
  if (error.errorCode === 409 && /webhook/i.test(error.message)) {
    return 'This bot has a webhook set, so polling is blocked (409). Remove it once with ' +
      'curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook" and run npm run bot again.';
  }
  if (error.errorCode === 409) {
    return 'Another copy of this bot is already polling Telegram with the same token (409 Conflict). ' +
      'Keep only one: stop the other one (Ctrl+C in its terminal, or pkill -f server/telegram/index.ts) ' +
      'and run npm run bot again.';
  }
  return undefined;
}

async function poll() {
  let offset = 0;
  let failures = 0;
  while (!stop.signal.aborted) {
    let updates: TgUpdate[];
    try {
      updates = await api.getUpdates(offset, stop.signal);
      if (failures > 0) log('connection to Telegram restored.');
      failures = 0;
    } catch (error) {
      if (stop.signal.aborted) return;
      if (error instanceof TelegramApiError) {
        const fatal = explainFatal(error);
        if (fatal) {
          warn(fatal);
          process.exitCode = 1;
          return;
        }
        if (error.errorCode === 429) {
          const seconds = error.retryAfter ?? 5;
          warn(`Telegram asks to slow down, retrying in ${seconds} s.`);
          await wait(seconds * 1000);
          continue;
        }
      }
      failures += 1;
      const delay = Math.min(3000 * failures, 30_000);
      const reason = error instanceof TelegramApiError ? `${error.errorCode} ${error.message}` : describeNetworkError(error);
      warn(`cannot reach Telegram (${reason}), retrying in ${delay / 1000} s.`);
      await wait(delay);
      continue;
    }

    for (const update of updates) {
      try {
        await handleUpdate(update);
      } catch (error) {
        // Unexpected (not a ServiceError): tell the chat nothing was saved and keep polling.
        console.error('[telegram] unexpected error while handling a message:', error);
        if (update.message) await send(update.message, '❌ Not saved: something went wrong in MoneyFlow. Try again.');
      }
      // Confirmed with the next getUpdates call; a redelivered message is caught by externalId.
      offset = update.update_id + 1;
    }
  }
}

async function main() {
  let me: TgUser;
  try {
    me = await api.getMe();
  } catch (error) {
    const fatal = error instanceof TelegramApiError ? explainFatal(error) : undefined;
    warn(fatal ?? `cannot reach Telegram (${describeNetworkError(error)}). Check the internet connection and run npm run bot again.`);
    process.exit(1);
  }

  getDb(); // same SQLite file as the site; fails early if it cannot be opened
  const allowed = allowedChatIds();
  log(`@${me.username} is running: https://t.me/${me.username}  ·  database ${DB_PATH}`);
  log(
    allowed.length > 0
      ? `allowed chat ID: ${allowed.join(', ')}`
      : 'TELEGRAM_ALLOWED_CHAT_ID is empty: nothing will be saved. Send /start to the bot to see your chat ID.',
  );
  log(`CoinGecko key ${readEnv('COINGECKO_DEMO_API_KEY') ? 'configured' : 'missing (crypto expenses will fail)'}. Ctrl+C to stop.`);

  await poll();
  closeDb();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log('stopping.');
    stop.abort();
    closeDb();
    process.exit(0);
  });
}

await main();

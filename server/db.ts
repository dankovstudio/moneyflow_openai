// SQLite storage (built-in node:sqlite). The schema already covers phase 2:
// Telegram passes `external_id`, so a redelivered message never creates a second row.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ACCOUNTS } from '../shared/contract.ts';
import { INITIAL_BALANCES_PENCE, INITIAL_TRANSACTIONS } from '../src/data.ts';
import { DB_PATH } from './env.ts';

const SCHEMA_VERSION = 1;

const SCHEMA = `
  CREATE TABLE accounts (
    name                  TEXT PRIMARY KEY,
    position              INTEGER NOT NULL,
    opening_balance_pence INTEGER NOT NULL
  );

  CREATE TABLE transactions (
    id           TEXT PRIMARY KEY,
    date         TEXT NOT NULL,                  -- YYYY-MM-DD, Europe/London
    type         TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    asset        TEXT NOT NULL,                  -- GBP | USDT | USDC | ETH | BTC | SOL
    account      TEXT NOT NULL REFERENCES accounts (name),
    category     TEXT NOT NULL,
    description  TEXT NOT NULL,
    amount_pence INTEGER NOT NULL CHECK (amount_pence >= 1), -- final GBP amount, always positive
    quantity     TEXT,                           -- crypto only: exact coin quantity, e.g. '0.1'
    coin_id      TEXT,                           -- crypto only: CoinGecko ID, e.g. 'ethereum'
    rate_gbp     TEXT,                           -- crypto only: GBP per coin at save time
    quoted_at    TEXT,                           -- crypto only: UTC ISO time of the quote
    source       TEXT NOT NULL CHECK (source IN ('seed', 'web', 'telegram')),
    external_id  TEXT UNIQUE,                    -- NULL for the site; e.g. 'telegram:<chat_id>:<message_id>'
    created_at   TEXT NOT NULL                   -- UTC ISO time the row was stored
  );

  CREATE INDEX transactions_by_date ON transactions (date, created_at);
`;

let db: DatabaseSync | undefined;

/** Opens the database, creating the schema and importing lesson 1 data exactly once. */
export function getDb(): DatabaseSync {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const connection = new DatabaseSync(DB_PATH);
  // The API and the Telegram bot are separate processes sharing this file.
  connection.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

  connection.exec('BEGIN IMMEDIATE');
  try {
    const { user_version: version } = connection.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version === 0) {
      connection.exec(SCHEMA);
      seed(connection);
      connection.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    connection.close();
    throw error;
  }

  db = connection;
  return db;
}

function seed(connection: DatabaseSync) {
  const insertAccount = connection.prepare(
    'INSERT INTO accounts (name, position, opening_balance_pence) VALUES (?, ?, ?)',
  );
  ACCOUNTS.forEach((account, position) => insertAccount.run(account, position, INITIAL_BALANCES_PENCE[account]));

  const createdAt = new Date().toISOString();
  const insertTransaction = connection.prepare(`
    INSERT INTO transactions (id, date, type, asset, account, category, description, amount_pence, source, created_at)
    VALUES (?, ?, ?, 'GBP', ?, ?, ?, ?, 'seed', ?)
  `);
  for (const t of INITIAL_TRANSACTIONS) {
    insertTransaction.run(t.id, t.date, t.type, t.account, t.category, t.description, t.amountPence, createdAt);
  }
}

/** Closes the connection so the WAL is checkpointed into moneyflow.sqlite. */
export function closeDb() {
  db?.close();
  db = undefined;
}

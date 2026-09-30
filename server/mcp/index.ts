// Phase 2 (sub-thread "mcp"): MoneyFlow MCP over Streamable HTTP at /mcp.
// Read-only tools must use server/service.ts (listExpenses, spendingSummary), never SQL.
import type { Express } from 'express';

/** Called by server/index.ts before the 404 handler. Does nothing until phase 2. */
export function mountMcp(_app: Express): void {}

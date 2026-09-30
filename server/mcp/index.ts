// Phase 2 (sub-thread "mcp"): MoneyFlow MCP over Streamable HTTP at /mcp.
// Read-only tools must use server/service.ts (listExpenses, spendingSummary), never SQL.
import { localhostHostValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Express, NextFunction, Request, Response } from 'express';
import { createMcpServer } from './tools.ts';

const MCP_PATH = '/mcp';

const rpcError = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

/** Stateless: a new server and transport per POST, closed when the response ends. */
async function handlePost(req: Request, res: Response) {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[moneyflow] MCP request failed:', error);
    if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
  }
}

/** Called by server/index.ts before the 404 handler. */
export function mountMcp(app: Express): void {
  // DNS rebinding protection: only Host 127.0.0.1, localhost or [::1] may reach /mcp.
  const localOnly = localhostHostValidation();

  app.post(MCP_PATH, localOnly, handlePost);
  app.all(MCP_PATH, localOnly, (_req, res) => {
    res.set('Allow', 'POST');
    rpcError(res, 405, -32000, 'Method not allowed. MoneyFlow MCP is stateless: send JSON-RPC with POST.');
  });

  // Body errors from the global express.json() answer as JSON-RPC here, not as a transaction error.
  app.use(MCP_PATH, (error: { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (error?.type === 'entity.parse.failed') return void rpcError(res, 400, -32700, 'Parse error: send valid JSON.');
    if (error?.type === 'entity.too.large') return void rpcError(res, 413, -32600, 'Request body is too large.');
    next(error);
  });
}

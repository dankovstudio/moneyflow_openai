# MoneyFlow MCP on Vercel

The same MoneyFlow MCP as the local `/mcp` of lesson 2 (`list_expenses`, `spending_summary`, read-only),
deployed as one Vercel Function. It stores nothing: every tool call reads
`GET /internal/mcp/expenses` or `/internal/mcp/summary` on the MoneyFlow server with a bearer token.

- Vercel project: Root Directory `mcp-vercel`, framework "Other", region `fra1`, Node 22.
- MCP URL: `https://<project>.vercel.app/<MCP_PATH_SECRET>/mcp` (Streamable HTTP, stateless, POST only).
  Without the right secret every request is a 404.

## Environment (Vercel → Settings → Environment Variables)

| Name | Value |
|---|---|
| `MONEYFLOW_API_URL` | `https://moneyflow.lifestyle` (https, no trailing path) |
| `MCP_READ_TOKEN` | the same value as `MCP_READ_TOKEN` of the `app` service in Dokploy |
| `MCP_PATH_SECRET` | a URL-safe random string, e.g. `openssl rand -hex 24` |

## Check

```sh
npm install && npx tsc --noEmit
curl -s -X POST "https://<project>.vercel.app/$MCP_PATH_SECRET/mcp" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

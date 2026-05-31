# ledger-mcp

A small **remote [MCP](https://modelcontextprotocol.io) server** that gives
Claude (or any MCP client) read-only visibility into a
[Supabase](https://supabase.com)-backed "ops ledger" — what you're building,
whether your scheduled jobs are healthy, and how much you're spending on the
Anthropic API this week.

Built with [`mcp-handler`](https://www.npmjs.com/package/mcp-handler) on Next.js,
deployable to Vercel in one command. Connect it to Claude as a custom connector
and ask: _"What am I building right now? Are any of my agents stale? How's my
spend this week?"_

## Tools

| Tool | What it returns | Table |
|---|---|---|
| `whats_being_built` | Open work-threads (title, domain, area, priority, last movement) | `threads` |
| `agent_health` | Last run + staleness verdict for each scheduled agent | `agent_health` |
| `weekly_spend` | Week-to-date API spend by project vs. a budget | `spend_log` |

All three are **read-only** (every query is a `SELECT`). The server expects
these tables in one or two Supabase projects — see `.env.example`.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in your Supabase creds + a random MCP_SECRET
npm run build && npm start    # http://localhost:3000/api/mcp
```

Smoke-test the handshake:

```bash
SECRET=...   # your MCP_SECRET
curl -s -X POST "http://localhost:3000/api/mcp?key=$SECRET" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Deploy

```bash
vercel --prod
```

Set `LEDGER_SUPABASE_URL`, `LEDGER_SUPABASE_SERVICE_KEY`, `SPEND_SUPABASE_URL`,
`SPEND_SUPABASE_SERVICE_KEY`, and `MCP_SECRET` in the Vercel project's
environment, then connect the deployed `…/api/mcp?key=<MCP_SECRET>` URL as a
custom connector in your MCP client.

## Auth

MCP clients that add connectors by URL don't always expose a static-token field,
so the access secret rides in the URL (`?key=…`) **or** an
`Authorization: Bearer <secret>` header. Keep the data low-sensitivity (this
server intentionally omits any encrypted columns), use a long random
`MCP_SECRET`, and treat the URL as a credential. For stronger guarantees, put it
behind an OAuth proxy.

## License

MIT

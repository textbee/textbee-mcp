# @textbee/mcp

[![npm version](https://img.shields.io/npm/v/%40textbee%2Fmcp)](https://www.npmjs.com/package/@textbee/mcp)
[![CI](https://github.com/textbee/textbee-mcp/actions/workflows/ci.yaml/badge.svg)](https://github.com/textbee/textbee-mcp/actions/workflows/ci.yaml)
[![license](https://img.shields.io/npm/l/%40textbee%2Fmcp)](./LICENSE)

MCP server for [textbee.dev](https://textbee.dev), the open source SMS gateway that turns an Android phone into an SMS API. Gives Claude Desktop, Claude Code, Cursor, and any MCP client the ability to send and read SMS through your own phone and your own number.

Three tools, no per-message markup, works with self-hosted textbee instances.

## Setup

You need a textbee account with a paired Android device and an API key from the [dashboard](https://app.textbee.dev/dashboard). The key has full account access; treat it like a password.

### Claude Code

```bash
claude mcp add textbee -s user -e TEXTBEE_API_KEY=your-key -- npx -y @textbee/mcp
```

### Claude Desktop

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "textbee": {
      "command": "npx",
      "args": ["-y", "@textbee/mcp"],
      "env": { "TEXTBEE_API_KEY": "your-key" }
    }
  }
}
```

### Cursor

The same object in `~/.cursor/mcp.json`.

### Slow first start

`npx` downloads the package on first run. If your client times out waiting, install globally once and point the config at the binary:

```bash
npm install -g @textbee/mcp
```

```json
{ "mcpServers": { "textbee": { "command": "textbee-mcp", "env": { "TEXTBEE_API_KEY": "your-key" } } } }
```

## Tools

### send_sms

Send an SMS to one or more recipients (E.164 format, for example `+15550100123`). The sending phone is chosen automatically: your default device, otherwise the enabled device with the most recent heartbeat. Optional `device_id`, `sim_subscription_id`, and `scheduled_at`. Returns an `sms_batch_id` for delivery checks when the account uses the SMS queue.

### get_messages

Read messages across every device on the account. Defaults to received messages, newest first. Filter by `direction` (`received`, `sent`, `all`), free-text `search`, `sms_batch_id` (per-recipient delivery status of a send), `device_ids`, and a `from`/`to` time window. Supports cursor pagination for polling without duplicates or gaps.

### list_devices

The phones on the account: ids, enabled state, which one sends by default, last check-in, and message counts.

## Self-hosted textbee

Point the server at your own instance:

```json
"env": {
  "TEXTBEE_API_KEY": "your-key",
  "TEXTBEE_BASE_URL": "https://sms.example.com"
}
```

The `/api/v1` suffix is optional and added automatically. Subpath deployments like `https://example.com/textbee` work too. An invalid URL is an error rather than a silent fallback, so a typo never sends your key to the public API.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `TEXTBEE_API_KEY` | yes | none | API key from the textbee dashboard |
| `TEXTBEE_BASE_URL` | no | `https://api.textbee.dev` | Your instance's URL when self-hosting |
| `TEXTBEE_TIMEOUT_MS` | no | `30000` | Per-request timeout in milliseconds |

## Notes

- Your key stays on your machine: this server talks only to the textbee API at the base URL above.
- Sends count against your textbee plan quota, and the plan's rate limits apply server-side.
- All diagnostics go to stderr; stdout is reserved for the MCP protocol.

## Using it as a library

The package also exports its tool definitions for embedding in another MCP host (this is how the hosted remote endpoint reuses them):

```js
import { createTextbeeMcpServer, staticCredentials, loadConfig } from '@textbee/mcp'

const server = createTextbeeMcpServer({
  credentials: staticCredentials(loadConfig(process.env)),
})
```

Credentials are resolved per tool call, so a multi-tenant host can inject a different key per request. See `credentialsFromAuthInfoExtra`.

## License

MIT. Part of the [textbee](https://github.com/textbee/textbee) project.

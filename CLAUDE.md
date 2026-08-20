# CLAUDE.md

Project instructions for Claude when working in the textbee-mcp repo.

## What this is

`@textbee/mcp`: a stdio MCP server that lets Claude Desktop, Claude Code, Cursor, and
any MCP client send and read SMS through a textbee.dev account. A thin wrapper over
`@textbee/sdk`; the SDK is the only HTTP client, there is no code generation.

## Hard rules

- NEVER use em dashes or en dashes anywhere: code, comments, docs, commit messages.
- Branding is lowercase "textbee" / "textbee.dev"; PascalCase identifiers use Textbee.
- Acronyms are words in identifiers: `sendSms`, never `sendSMS`.
- stdout is the MCP JSON-RPC channel. No `console.log` in `src/`; diagnostics go to
  stderr via `stderrLogger`.
- Never log, echo, or embed API key values, phone numbers, or message bodies in errors.
- Nothing throws across the MCP boundary: every handler returns `isError: true` with an
  actionable message via `errorResult`.
- Never expose or document the deprecated device-scoped routes (send or history).
  Agent-facing surfaces show only account-level `POST /gateway/send-sms` and
  `GET /gateway/messages`.
- The library entry (`src/index.ts`) must stay side-effect free: no process globals, no
  transport, no fetch patching. Only `src/bin.ts` touches `process`.
- Tool handlers never close over a process-global API key; credentials come from the
  per-call `CredentialResolver`.

## Commands

- `pnpm build` compiles to `dist/`.
- `pnpm test` runs vitest (capped at 2 workers).
- `pnpm run typecheck` checks src and tests.
- `pnpm run check:hygiene` enforces the dash, casing, and console.log rules.
- `pnpm inspect` lists the tools through the MCP Inspector CLI.

## Architecture (one bullet per src file)

- `bin.ts` stdio bootstrap: loads env config, installs the fetch timeout, connects.
- `index.ts` library entry, re-exports only.
- `tools.ts` the 3 tool definitions, descriptions, zod shapes, and the McpServer factory.
- `config.ts` env parsing, `normalizeBaseUrl`, VERSION, stderr logger.
- `credentials.ts` static (stdio) and authInfo-extra (remote host) credential resolvers.
- `errors.ts` the single error-to-text mapper, including the two distinct 429s.
- `format.ts` message and device rendering; `messageDirection` is the only place that
  reads a message's direction.
- `dedupe.ts` cross-request duplicate-send store for HTTP hosts.
- `fetch-timeout.ts` opt-in process-wide fetch timeout, entrypoints only.

## Verification before claiming done

1. `pnpm build` exits 0.
2. `pnpm test`, `pnpm run typecheck`, `pnpm run check:hygiene` all pass.
3. `node -e "import('./dist/index.js').then(()=>console.error('ok'))"` prints ok and
   exits; if it hangs, the library entry gained a side effect.
4. `pnpm inspect` shows exactly 3 tools: send_sms, get_messages, list_devices.
5. Keyless `node dist/bin.js` prints one stderr ready line and nothing on stdout.

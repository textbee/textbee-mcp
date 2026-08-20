import { TextbeeConfigError } from './errors.js'
import type { CredentialResolver } from './types.js'
import type { StdioConfig } from './config.js'

/**
 * Field names for per-request credentials in `authInfo.extra`, shared with
 * hosts (the hosted remote) so the two sides cannot drift.
 */
export const TEXTBEE_AUTH_EXTRA_API_KEY = 'textbeeApiKey'
export const TEXTBEE_AUTH_EXTRA_BASE_URL = 'textbeeBaseUrl'

/** One key for the process lifetime, from the environment. The stdio path. */
export function staticCredentials(config: StdioConfig): CredentialResolver {
  return () => {
    if (!config.apiKey) {
      throw new TextbeeConfigError(
        'TEXTBEE_API_KEY is not set. Add it to the env block of your MCP client config ' +
          '(Claude Desktop claude_desktop_config.json, Claude Code .mcp.json, or Cursor mcp.json) ' +
          'and restart the client. Create a key at https://textbee.dev/dashboard.',
      )
    }
    return { apiKey: config.apiKey, baseUrl: config.baseUrl }
  }
}

/**
 * Per-request credentials read from `authInfo.extra`, as injected by an HTTP
 * host via `req.auth`. Fails closed: no env fallback of any kind.
 */
export function credentialsFromAuthInfoExtra(
  fallbackBaseUrl?: string,
): CredentialResolver {
  return (ctx) => {
    const extra = ctx.authInfo?.extra
    const apiKey =
      typeof extra?.[TEXTBEE_AUTH_EXTRA_API_KEY] === 'string'
        ? (extra[TEXTBEE_AUTH_EXTRA_API_KEY] as string)
        : ''
    if (!apiKey) {
      throw new TextbeeConfigError(
        'No textbee API key on this request. Send it as the x-textbee-api-key header ' +
          'or as Authorization: Bearer <key>. Create a key at https://textbee.dev/dashboard.',
      )
    }
    const baseUrl =
      typeof extra?.[TEXTBEE_AUTH_EXTRA_BASE_URL] === 'string'
        ? (extra[TEXTBEE_AUTH_EXTRA_BASE_URL] as string)
        : fallbackBaseUrl
    if (!baseUrl) {
      throw new TextbeeConfigError('No textbee base URL configured for this request.')
    }
    return { apiKey, baseUrl }
  }
}

import { createRequire } from 'node:module'
import { TextbeeConfigError } from './errors.js'
import type { Logger } from './types.js'

const require = createRequire(import.meta.url)
export const VERSION: string = require('../package.json').version

export const TEXTBEE_DEFAULT_BASE_URL = 'https://api.textbee.dev/api/v1'
const DEFAULT_TIMEOUT_MS = 30_000

// stdout is the MCP JSON-RPC channel, so every diagnostic goes to stderr.
export const stderrLogger: Logger = {
  info: (...args) => console.error('[textbee-mcp]', ...args),
  warn: (...args) => console.error('[textbee-mcp] warning:', ...args),
  error: (...args) => console.error('[textbee-mcp] error:', ...args),
}

export interface StdioConfig {
  apiKey?: string | undefined
  baseUrl: string
  timeoutMs: number
}

/**
 * Pure. A missing TEXTBEE_API_KEY does not fail here: the server boots and
 * every tool call explains what to set. An unusable TEXTBEE_BASE_URL throws,
 * because it would make every call meaningless and must never silently fall
 * back to the public API.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  logger: Logger = stderrLogger,
): StdioConfig {
  const rawTimeout = Number(env.TEXTBEE_TIMEOUT_MS)
  return {
    apiKey: env.TEXTBEE_API_KEY?.trim() || undefined,
    baseUrl: normalizeBaseUrl(env.TEXTBEE_BASE_URL, (m) => logger.warn(m)),
    timeoutMs:
      Number.isFinite(rawTimeout) && rawTimeout > 0
        ? rawTimeout
        : DEFAULT_TIMEOUT_MS,
  }
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  )
}

/**
 * Normalize a base URL to origin + path ending in /api/v1. The docs print the
 * origin (https://api.textbee.dev) while the SDK expects the /api/v1 suffix,
 * so self-hosters set this both ways; both must work. Malformed values throw
 * rather than falling back, so a typo never sends a self-hoster's API key to
 * the public API.
 */
export function normalizeBaseUrl(
  raw: string | undefined,
  warn: (message: string) => void = () => {},
): string {
  const value = raw?.trim()
  if (!value) return TEXTBEE_DEFAULT_BASE_URL

  let withScheme = value
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    warn('TEXTBEE_BASE_URL had no scheme, assuming https://')
    withScheme = `https://${value}`
  }

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new TextbeeConfigError(
      `TEXTBEE_BASE_URL is not a valid URL: "${value}". Use the origin of your textbee api, ` +
        `for example https://sms.example.com. The /api/v1 suffix is added for you.`,
    )
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TextbeeConfigError(
      `TEXTBEE_BASE_URL must be http or https, got "${url.protocol}".`,
    )
  }
  if (url.search || url.hash) {
    warn('TEXTBEE_BASE_URL query string and fragment are ignored.')
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    warn(
      `TEXTBEE_BASE_URL uses http, so the API key travels in cleartext to ${url.hostname}. ` +
        `Use https unless this is a trusted private network.`,
    )
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const lower = segments.map((s) => s.toLowerCase())
  let cut = -1
  for (let i = lower.length - 2; i >= 0; i--) {
    if (lower[i] === 'api' && lower[i + 1] === 'v1') {
      cut = i + 2
      break
    }
  }

  let out: string[]
  if (cut === -1) {
    out = [...segments, 'api', 'v1']
  } else {
    out = segments.slice(0, cut)
    out[cut - 2] = 'api'
    out[cut - 1] = 'v1'
    if (cut !== segments.length) {
      warn(
        `TEXTBEE_BASE_URL pointed at a specific endpoint. Using the api root ` +
          `${url.origin}/${out.join('/')} instead. Set it to the api root, not a route.`,
      )
    }
  }

  return `${url.origin}/${out.join('/')}`
}

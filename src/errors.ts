import { TextbeeError } from '@textbee/sdk'
import type { Logger, ToolResult } from './types.js'

/** Configuration problem the caller can fix. The message is shown verbatim. */
export class TextbeeConfigError extends Error {
  override name = 'TextbeeConfigError'
}

/**
 * instanceof alone is unreliable when a dependency tree carries two copies of
 * the SDK, so the brand on `name` is checked as well.
 */
export function isTextbeeError(err: unknown): err is TextbeeError {
  if (err instanceof TextbeeError) return true
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'TextbeeError'
  )
}

interface ErrorContext {
  baseUrl: string
  logger: Logger
}

export function errorResult(err: unknown, ctx: ErrorContext): ToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: describeError(err, ctx) }],
  }
}

function describeError(err: unknown, ctx: ErrorContext): string {
  if (err instanceof TextbeeConfigError) {
    return err.message
  }

  if (isTextbeeError(err)) {
    return describeApiError(err, ctx)
  }

  if (err instanceof Error) {
    // AbortSignal.timeout rejects fetch with a DOMException named TimeoutError;
    // an explicit abort is named AbortError.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return (
        `The request to textbee timed out. The API may be slow or unreachable. ` +
        `Base URL in use: ${ctx.baseUrl}. Try again; raise TEXTBEE_TIMEOUT_MS if this keeps happening.`
      )
    }
    // Global fetch wraps network failures in a TypeError. The SDK does not
    // wrap them further.
    if (err.name === 'TypeError') {
      return (
        `Could not reach the textbee API. Base URL in use: ${ctx.baseUrl}. ` +
        `Check the network and, if self-hosting, that TEXTBEE_BASE_URL points at your instance.`
      )
    }
  }

  ctx.logger.error(
    'unexpected error:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  )
  return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`
}

function describeApiError(err: TextbeeError, ctx: ErrorContext): string {
  const body =
    typeof err.body === 'object' && err.body !== null
      ? (err.body as Record<string, unknown>)
      : {}

  if (err.status === 401) {
    return (
      `textbee rejected the API key (401). Check that TEXTBEE_API_KEY is a current key ` +
      `from https://textbee.dev/dashboard and has not been revoked. Base URL in use: ${ctx.baseUrl}.`
    )
  }

  if (err.status === 429) {
    // The plan quota carries hasReachedLimit plus the numeric limits; the
    // separate IP throttle carries neither.
    if (body.hasReachedLimit === true) {
      const parts: string[] = [`textbee plan limit reached: ${err.message}`]
      if (typeof body.dailyRemaining === 'number' && typeof body.dailyLimit === 'number') {
        parts.push(`Remaining today: ${body.dailyRemaining} of ${body.dailyLimit}.`)
      }
      if (typeof body.monthlyRemaining === 'number' && typeof body.monthlyLimit === 'number') {
        parts.push(`Remaining this month: ${body.monthlyRemaining} of ${body.monthlyLimit}.`)
      }
      if (typeof body.bulkSendLimit === 'number') {
        parts.push(`Max recipients per send: ${body.bulkSendLimit}.`)
      }
      parts.push(
        'Do not retry this send automatically. The user can upgrade at https://textbee.dev/#pricing or wait for the window to reset.',
      )
      return parts.join(' ')
    }
    return (
      `textbee is rate limiting this client (429). This is a request-rate throttle, ` +
      `not a plan limit. Wait a few seconds and retry.`
    )
  }

  if (err.status === 404) {
    return `textbee returned 404: ${err.message}. The id may be wrong, or it may belong to a different account.`
  }

  if (err.status === 400) {
    if (err.message.includes('No enabled device found')) {
      return (
        `${err.message} Call list_devices to see the account's phones, or enable one ` +
        `in the textbee Android app or at https://textbee.dev/dashboard.`
      )
    }
    return `textbee rejected the request (400): ${err.message}`
  }

  if (err.status >= 500) {
    return (
      `The textbee API returned ${err.status}: ${err.message}. This is a server-side ` +
      `problem; wait a moment and retry. Base URL in use: ${ctx.baseUrl}.`
    )
  }

  return `textbee API error (${err.status}): ${err.message}`
}

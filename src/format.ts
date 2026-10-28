import type { Device, Message, MessageList } from '@textbee/sdk'

const BODY_PREVIEW_CHARS = 300

/** Statuses that rarely change. failed and unknown can still change. */
export const FINAL_STATUSES = ['delivered'] as const

// Local shape until the published SDK types carry errorHistory.
type WithErrorHistory = { errorHistory?: Array<{ deliveryReport?: boolean }> }

/**
 * Direction of a message. Prefer the lowercase `direction` field; fall back to
 * the deprecated uppercase `type` for rows serialized by older API versions.
 * No sender-based guessing: an honest `unknown` beats a guess the calling
 * agent cannot audit.
 */
export function messageDirection(m: Message): 'sent' | 'received' | 'unknown' {
  if (m.direction === 'sent' || m.direction === 'received') return m.direction
  const legacy = String(m.type ?? '').toLowerCase()
  return legacy === 'sent' || legacy === 'received' ? legacy : 'unknown'
}

export function truncate(text: string, max = BODY_PREVIEW_CHARS): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}... [truncated, ${text.length} chars total]`
}

function messageBody(m: Message): string {
  if (typeof m.message === 'string' && m.message.length > 0) {
    return truncate(m.message)
  }
  if ((m as { encrypted?: boolean }).encrypted) {
    return '[end-to-end encrypted, body not readable here]'
  }
  return '[no text]'
}

function formatMessageLine(m: Message, index: number): string {
  const direction = messageDirection(m)
  const when = m.createdAt ?? m.receivedAt ?? m.requestedAt ?? 'unknown time'
  const party =
    direction === 'received'
      ? `from ${m.sender ?? 'unknown number'}`
      : `to ${m.recipient ?? 'unknown number'}`
  const status = m.status ?? 'unknown'
  const header = `[${index}] ${when}  ${direction} ${party}  status=${status}  id=${m._id}`
  const lines = [header, `    ${messageBody(m)}`]
  const state = String(m.status ?? '').toLowerCase()
  if (state === 'failed' && (m.errorCode || m.errorMessage)) {
    const code = m.errorCode ?? ''
    const text = m.errorMessage ?? ''
    const detail = code && text && !text.startsWith(`${code}:`) ? `${code} - ${text}` : text || code
    lines.push(`    error: ${detail}`)
  } else if (state === 'unknown') {
    lines.push('    no report from the phone within 20 minutes (not a failure)')
  }
  const history = (m as WithErrorHistory).errorHistory ?? []
  const failures = history.filter((e) => !e?.deliveryReport).length
  if (failures > 0) {
    lines.push(`    ${failures >= 15 ? '15 or more' : failures} failure${failures === 1 ? '' : 's'} recorded`)
  }
  if (history.length > failures) {
    lines.push('    delivery report not confirmed (the message was sent)')
  }
  return lines.join('\n')
}

export interface FormatMessagesContext {
  direction: 'received' | 'sent' | 'all'
  usedCursor: boolean
  order: 'desc' | 'asc'
}

export function formatMessages(list: MessageList, ctx: FormatMessagesContext): string {
  const { data, meta } = list
  const lines: string[] = []

  if (data.length === 0) {
    lines.push(
      ctx.usedCursor
        ? 'No new messages after the given cursor.'
        : `No ${ctx.direction === 'all' ? '' : `${ctx.direction} `}messages matched.`,
    )
  } else {
    const scope = ctx.direction === 'all' ? 'messages' : `${ctx.direction} messages`
    const orderNote = ctx.order === 'asc' ? 'oldest first' : 'newest first'
    const totalNote = typeof meta.total === 'number' ? ` of ${meta.total} total` : ''
    lines.push(`${data.length} ${scope}${totalNote}, ${orderNote}.`)
    lines.push('')
    data.forEach((m, i) => lines.push(formatMessageLine(m, i + 1)))
  }

  lines.push('')
  lines.push(
    'Status delivered rarely changes. failed and unknown can still change (a late phone report or a recovery). pending, dispatched, and sent are in progress. The user can ask to check again later.',
  )

  if (meta.nextCursor) {
    lines.push(`next_cursor: ${meta.nextCursor}`)
    lines.push(
      meta.hasMore
        ? 'More messages available: call get_messages again with this cursor to continue.'
        : 'Keep this cursor to resume the next poll from here without repeats or gaps.',
    )
  } else if (
    typeof meta.totalPages === 'number' &&
    typeof meta.page === 'number' &&
    meta.page < meta.totalPages
  ) {
    lines.push(
      `Showing page ${meta.page} of ${meta.totalPages}. To walk further, poll with order="asc" and a from bound, then follow next_cursor.`,
    )
  }

  return lines.join('\n')
}

function relativeAge(iso: string | undefined, now: Date): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return iso
  const seconds = Math.round((now.getTime() - then) / 1000)
  if (seconds < 90) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

export function formatDevices(devices: Device[], now: Date = new Date()): string {
  if (devices.length === 0) {
    return (
      'This textbee account has no registered devices. Install the textbee Android app on ' +
      'the phone that should send and receive, pair it via the QR code at ' +
      'https://textbee.dev/dashboard, then retry.'
    )
  }

  const lines: string[] = [
    `${devices.length} device${devices.length === 1 ? '' : 's'} on this textbee account.`,
    '',
  ]
  for (const d of devices) {
    const label = d.name || [d.brand, d.model].filter(Boolean).join(' ') || 'unnamed device'
    const flags = [d.enabled ? 'enabled' : 'DISABLED', d.isDefault ? 'default sender' : null]
      .filter(Boolean)
      .join(', ')
    lines.push(`- ${d._id}  ${label}`)
    lines.push(
      `  ${flags}, last seen ${relativeAge(d.lastHeartbeat, now)}, sent ${d.sentSMSCount}, received ${d.receivedSMSCount}`,
    )
  }

  const enabled = devices.filter((d) => d.enabled)
  const defaultDevice = enabled.find((d) => d.isDefault)
  lines.push('')
  if (enabled.length === 0) {
    lines.push(
      'No device is enabled, so nothing can send or receive. Enable one in the textbee ' +
        'Android app or at https://textbee.dev/dashboard.',
    )
  } else if (defaultDevice) {
    lines.push(
      `send_sms without device_id sends from the default: ${defaultDevice.name || defaultDevice._id} (${defaultDevice._id}).`,
    )
  } else {
    lines.push(
      'No default device is set: send_sms without device_id uses the enabled device with ' +
        'the most recent heartbeat. Set a default at https://textbee.dev/dashboard for a ' +
        'predictable sender.',
    )
  }
  return lines.join('\n')
}

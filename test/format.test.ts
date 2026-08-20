import { describe, expect, it } from 'vitest'
import type { Device, Message, MessageList } from '@textbee/sdk'
import { formatDevices, formatMessages, messageDirection } from '../src/format.js'

function message(overrides: Partial<Message>): Message {
  return {
    _id: '66b0000000000000000001aa',
    message: 'hello',
    type: 'RECEIVED',
    ...overrides,
  } as Message
}

describe('messageDirection', () => {
  it('prefers the lowercase direction field', () => {
    expect(messageDirection(message({ direction: 'sent', type: 'RECEIVED' }))).toBe('sent')
  })

  it('falls back to the deprecated uppercase type', () => {
    expect(messageDirection(message({ type: 'RECEIVED' }))).toBe('received')
    expect(messageDirection(message({ type: 'SENT' }))).toBe('sent')
  })

  it('reports unknown rather than guessing', () => {
    expect(messageDirection(message({ type: undefined as never }))).toBe('unknown')
    expect(messageDirection(message({ type: 'MMS' as never }))).toBe('unknown')
  })
})

describe('formatMessages', () => {
  const baseMeta = { limit: 25 }

  it('renders rows with direction, status, and body', () => {
    const list: MessageList = {
      data: [
        message({
          direction: 'received',
          sender: '+15550100123',
          status: 'received',
          createdAt: '2026-08-20T10:00:00.000Z',
        }),
      ],
      meta: { ...baseMeta, page: 1, total: 1, totalPages: 1 },
    }
    const text = formatMessages(list, { direction: 'received', usedCursor: false, order: 'desc' })
    expect(text).toContain('received from +15550100123')
    expect(text).toContain('status=received')
    expect(text).toContain('66b0000000000000000001aa')
  })

  it('renders missing status and missing body as unknown, never undefined', () => {
    const list: MessageList = {
      data: [message({ message: undefined, status: undefined } as unknown as Partial<Message>)],
      meta: baseMeta,
    }
    const text = formatMessages(list, { direction: 'all', usedCursor: false, order: 'desc' })
    expect(text).toContain('status=unknown')
    expect(text).not.toContain('undefined')
  })

  it('labels an encrypted body instead of showing nothing', () => {
    const list: MessageList = {
      data: [message({ message: '', encrypted: true } as Partial<Message>)],
      meta: baseMeta,
    }
    const text = formatMessages(list, { direction: 'all', usedCursor: false, order: 'desc' })
    expect(text).toContain('encrypted')
  })

  it('surfaces the cursor and tells the agent how to continue', () => {
    const list: MessageList = {
      data: [message({})],
      meta: { ...baseMeta, nextCursor: 'abc123', hasMore: true },
    }
    const text = formatMessages(list, { direction: 'received', usedCursor: true, order: 'asc' })
    expect(text).toContain('next_cursor: abc123')
    expect(text).toContain('call get_messages again with this cursor')
  })

  it('says no new messages for an empty cursor page', () => {
    const list: MessageList = { data: [], meta: { ...baseMeta, nextCursor: null } }
    const text = formatMessages(list, { direction: 'received', usedCursor: true, order: 'asc' })
    expect(text).toContain('No new messages')
  })

  it('truncates long bodies', () => {
    const list: MessageList = {
      data: [message({ message: 'x'.repeat(500) })],
      meta: baseMeta,
    }
    const text = formatMessages(list, { direction: 'all', usedCursor: false, order: 'desc' })
    expect(text).toContain('[truncated, 500 chars total]')
    expect(text).not.toContain('x'.repeat(301))
  })
})

function device(overrides: Partial<Device>): Device {
  return {
    _id: '65f0000000000000000000aa',
    enabled: true,
    isDefault: false,
    sentSMSCount: 0,
    receivedSMSCount: 0,
    ...overrides,
  } as Device
}

describe('formatDevices', () => {
  it('explains the empty account', () => {
    expect(formatDevices([])).toContain('no registered devices')
  })

  it('names the default sender', () => {
    const text = formatDevices([
      device({ name: 'Pixel 7', isDefault: true, lastHeartbeat: new Date().toISOString() }),
    ])
    expect(text).toContain('default sender')
    expect(text).toContain('send_sms without device_id sends from the default: Pixel 7')
  })

  it('states the fallback rule when no default exists', () => {
    const text = formatDevices([device({}), device({ _id: '65f0000000000000000000bb' })])
    expect(text).toContain('most recent heartbeat')
  })

  it('warns when every device is disabled', () => {
    const text = formatDevices([device({ enabled: false })])
    expect(text).toContain('No device is enabled')
  })
})

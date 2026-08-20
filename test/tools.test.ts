import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildToolDefinitions } from '../src/tools.js'
import { createMemorySendDedupe } from '../src/dedupe.js'
import { staticCredentials } from '../src/credentials.js'
import type { BuildOptions, ToolResult } from '../src/types.js'

const SENTINEL_KEY = 'sk-super-secret-sentinel-key-000'
const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function buildOptions(overrides?: Partial<BuildOptions>): BuildOptions {
  return {
    credentials: staticCredentials({
      apiKey: SENTINEL_KEY,
      baseUrl: 'https://sms.example.com/api/v1',
      timeoutMs: 30_000,
    }),
    logger: silentLogger,
    ...overrides,
  }
}

function tool(name: string, opts?: Partial<BuildOptions>) {
  const def = buildToolDefinitions(buildOptions(opts)).find((t) => t.name === name)
  if (!def) throw new Error(`no tool ${name}`)
  return def
}

function resultText(result: ToolResult): string {
  return result.content.map((c) => c.text).join('\n')
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('tool surface', () => {
  it('exposes exactly three tools', () => {
    const names = buildToolDefinitions(buildOptions()).map((t) => t.name)
    expect(names).toEqual(['send_sms', 'get_messages', 'list_devices'])
  })

  it('marks the reads read-only and the send not', () => {
    expect(tool('get_messages').annotations.readOnlyHint).toBe(true)
    expect(tool('list_devices').annotations.readOnlyHint).toBe(true)
    expect(tool('send_sms').annotations.readOnlyHint).toBe(false)
  })

  it('never names an unregistered tool in send_sms output text', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: { success: true, message: 'queued', smsBatchId: 'b1', recipientCount: 1 },
      }),
    )
    const result = await tool('send_sms').handler(
      { message: 'hi', recipients: ['+15550100123'] },
      {},
    )
    const registered = buildToolDefinitions(buildOptions()).map((t) => t.name)
    const mentioned = resultText(result).match(/\b(get_sms_status|get_received_sms)\b/g)
    expect(mentioned).toBeNull()
    for (const name of resultText(result).match(/\b(send_sms|get_messages|list_devices)\b/g) ?? []) {
      expect(registered).toContain(name)
    }
  })
})

describe('send_sms', () => {
  it('sends the account-level request and reports the batch id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: { success: true, message: 'queued', smsBatchId: 'b123', recipientCount: 2 },
      }),
    )
    const result = await tool('send_sms').handler(
      { message: 'hello there', recipients: ['+15550100123', '+15550100124'] },
      {},
    )

    expect(result.isError).toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://sms.example.com/api/v1/gateway/send-sms')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      message: 'hello there',
      recipients: ['+15550100123', '+15550100124'],
    })
    const text = resultText(result)
    expect(text).toContain('sms_batch_id: b123')
    expect(text).toContain('get_messages sms_batch_id="b123"')
    expect(text).toContain('2 recipients')
    expect(text).toMatch(/1 SMS segment/)
  })

  it('handles the immediate branch without inventing a batch id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { successCount: 1, failureCount: 0, responses: [] } }),
    )
    const result = await tool('send_sms').handler(
      { message: 'hi', recipients: ['+15550100123'] },
      {},
    )
    const text = resultText(result)
    expect(text).toContain('1 accepted, 0 failed')
    expect(text).toContain('no sms_batch_id')
    expect(text).not.toContain('sms_batch_id: ')
  })

  it('rejects invalid E.164 before any network call', async () => {
    const result = await tool('send_sms').handler(
      { message: 'hi', recipients: ['+15550100123', '0912345678'] },
      {},
    )
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('0912345678')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('strips a whitespace-only device_id instead of sending an empty string', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { successCount: 1, failureCount: 0 } }),
    )
    await tool('send_sms').handler(
      { message: 'hi', recipients: ['+15550100123'], device_id: '  ' },
      {},
    )
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('deviceId')
  })

  it('suppresses an identical send inside the dedupe window', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: { success: true, message: 'queued', smsBatchId: 'b9', recipientCount: 1 },
      }),
    )
    const dedupe = createMemorySendDedupe({ windowMs: 60_000 })
    const def = tool('send_sms', { sendDedupe: dedupe })
    const input = { message: 'again', recipients: ['+15550100123'] }

    const first = await def.handler(input, {})
    const second = await def.handler(input, {})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(resultText(second)).toContain('did not send again')
    expect(resultText(first)).not.toContain('did not send again')
  })
})

describe('get_messages', () => {
  function messagesResponse(meta: Record<string, unknown> = {}) {
    return jsonResponse(200, {
      data: [
        {
          _id: 'm1',
          message: 'code 4481',
          type: 'RECEIVED',
          direction: 'received',
          status: 'received',
          sender: '+15550100123',
          createdAt: '2026-08-20T10:00:00.000Z',
        },
      ],
      meta: { limit: 25, ...meta },
    })
  }

  it('defaults direction to received and applies the default limit', async () => {
    fetchMock.mockResolvedValue(messagesResponse({ page: 1, total: 1, totalPages: 1 }))
    await tool('get_messages').handler({}, {})
    const [url] = fetchMock.mock.calls[0] as [URL]
    const params = new URL(String(url)).searchParams
    expect(new URL(String(url)).pathname).toBe('/api/v1/gateway/messages')
    expect(params.get('direction')).toBe('received')
    expect(params.get('limit')).toBe('25')
    expect(params.get('page')).toBeNull()
  })

  it('switches the direction default to all for a batch lookup', async () => {
    fetchMock.mockResolvedValue(messagesResponse())
    await tool('get_messages').handler({ sms_batch_id: 'b123' }, {})
    const params = new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams
    expect(params.get('smsBatchId')).toBe('b123')
    expect(params.get('direction')).toBe('all')
  })

  it('honors an explicit direction alongside a batch id', async () => {
    fetchMock.mockResolvedValue(messagesResponse())
    await tool('get_messages').handler({ sms_batch_id: 'b123', direction: 'sent' }, {})
    const params = new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams
    expect(params.get('direction')).toBe('sent')
  })

  it('passes filters through: cursor, bounds, order, devices, search', async () => {
    fetchMock.mockResolvedValue(messagesResponse({ nextCursor: 'c2', hasMore: true }))
    const result = await tool('get_messages').handler(
      {
        cursor: 'c1',
        from: '2026-08-20T00:00:00Z',
        to: '2026-08-21T00:00:00Z',
        order: 'asc',
        device_ids: ['d1', 'd2'],
        search: 'code',
        limit: 50,
      },
      {},
    )
    const params = new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams
    expect(params.get('cursor')).toBe('c1')
    expect(params.get('from')).toBe('2026-08-20T00:00:00Z')
    expect(params.get('to')).toBe('2026-08-21T00:00:00Z')
    expect(params.get('order')).toBe('asc')
    expect(params.get('deviceIds')).toBe('d1,d2')
    expect(params.get('search')).toBe('code')
    expect(params.get('limit')).toBe('50')
    expect(resultText(result)).toContain('next_cursor: c2')
  })
})

describe('error mapping', () => {
  it('maps a 401 to an isError result, not a thrown error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: 'Unauthorized', code: 'AUTH_INVALID' }),
    )
    const result = await tool('list_devices').handler(undefined, {})
    expect(result.isError).toBe(true)
    const text = resultText(result)
    expect(text).toContain('rejected the API key (401)')
    expect(text).toContain('https://sms.example.com/api/v1')
  })

  it('distinguishes the plan quota 429 from the throttle 429', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, {
        message: 'Daily SMS limit reached',
        hasReachedLimit: true,
        dailyLimit: 50,
        dailyRemaining: 0,
        monthlyLimit: 500,
        monthlyRemaining: 372,
        bulkSendLimit: 50,
      }),
    )
    const quota = await tool('send_sms').handler(
      { message: 'hi', recipients: ['+15550100123'] },
      {},
    )
    expect(resultText(quota)).toContain('plan limit reached')
    expect(resultText(quota)).toContain('0 of 50')
    expect(resultText(quota)).toContain('Do not retry')

    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }),
    )
    const throttle = await tool('send_sms').handler(
      { message: 'hi', recipients: ['+15550100123'] },
      {},
    )
    expect(resultText(throttle)).toContain('request-rate throttle')
    expect(resultText(throttle)).not.toContain('plan limit reached')
  })

  it('reports a missing API key with setup guidance and no network call', async () => {
    const def = buildToolDefinitions({
      credentials: staticCredentials({
        apiKey: undefined,
        baseUrl: 'https://api.textbee.dev/api/v1',
        timeoutMs: 30_000,
      }),
      logger: silentLogger,
    }).find((t) => t.name === 'list_devices')
    const result = await def!.handler(undefined, {})
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('TEXTBEE_API_KEY is not set')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a network failure to an actionable message naming the base url', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const result = await tool('list_devices').handler(undefined, {})
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('Could not reach the textbee API')
    expect(resultText(result)).toContain('https://sms.example.com/api/v1')
  })

  it('never leaks the API key into any error message', async () => {
    const scenarios: Array<() => void> = [
      () => fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' })),
      () => fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' })),
      () => fetchMock.mockRejectedValue(new TypeError('fetch failed')),
      () => fetchMock.mockRejectedValue(new Error(`echo ${SENTINEL_KEY}`)),
    ]
    for (const arm of scenarios) {
      fetchMock.mockReset()
      arm()
      const result = await tool('list_devices').handler(undefined, {})
      const text = resultText(result)
      if (!text.includes('Unexpected error')) {
        expect(text).not.toContain(SENTINEL_KEY)
      }
    }
  })

  it('sends per-call credentials, isolating two keys in one process', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    const keys: string[] = []
    const defs = buildToolDefinitions({
      credentials: (ctx) => ({
        apiKey: String(ctx.authInfo?.extra?.textbeeApiKey),
        baseUrl: 'https://api.textbee.dev/api/v1',
      }),
      logger: silentLogger,
    })
    const listDevices = defs.find((t) => t.name === 'list_devices')!
    await listDevices.handler(undefined, { authInfo: { token: 't1', extra: { textbeeApiKey: 'key-a' } } })
    await listDevices.handler(undefined, { authInfo: { token: 't2', extra: { textbeeApiKey: 'key-b' } } })
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit
      keys.push((init.headers as Record<string, string>)['x-api-key'] ?? '')
    }
    expect(keys).toEqual(['key-a', 'key-b'])
  })
})

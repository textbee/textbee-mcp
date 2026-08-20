import { describe, expect, it, vi } from 'vitest'
import {
  TEXTBEE_DEFAULT_BASE_URL,
  loadConfig,
  normalizeBaseUrl,
} from '../src/config.js'
import { TextbeeConfigError } from '../src/errors.js'

describe('normalizeBaseUrl', () => {
  const cases: Array<[input: string | undefined, expected: string, warns: boolean]> = [
    [undefined, 'https://api.textbee.dev/api/v1', false],
    ['', 'https://api.textbee.dev/api/v1', false],
    ['https://sms.example.com', 'https://sms.example.com/api/v1', false],
    ['https://sms.example.com/', 'https://sms.example.com/api/v1', false],
    ['https://sms.example.com/api/v1', 'https://sms.example.com/api/v1', false],
    ['https://sms.example.com/api/v1/', 'https://sms.example.com/api/v1', false],
    ['https://sms.example.com/textbee/api/v1', 'https://sms.example.com/textbee/api/v1', false],
    ['https://sms.example.com/textbee', 'https://sms.example.com/textbee/api/v1', false],
    ['https://api.textbee.dev/api/v1/gateway/send-sms', 'https://api.textbee.dev/api/v1', true],
    ['api.textbee.dev', 'https://api.textbee.dev/api/v1', true],
    ['http://localhost:3001', 'http://localhost:3001/api/v1', false],
    ['http://127.0.0.1:3001/api/v1', 'http://127.0.0.1:3001/api/v1', false],
    ['http://sms.example.com', 'http://sms.example.com/api/v1', true],
    ['https://sms.example.com/API/V1', 'https://sms.example.com/api/v1', false],
    ['https://sms.example.com/v1', 'https://sms.example.com/v1/api/v1', false],
  ]

  it.each(cases)('normalizes %j to %j', (input, expected, warns) => {
    const warn = vi.fn()
    expect(normalizeBaseUrl(input, warn)).toBe(expected)
    if (warns) {
      expect(warn).toHaveBeenCalled()
    } else {
      expect(warn).not.toHaveBeenCalled()
    }
  })

  it('throws on garbage instead of falling back to the public API', () => {
    expect(() => normalizeBaseUrl('not a url')).toThrow(TextbeeConfigError)
    expect(() => normalizeBaseUrl('ftp://sms.example.com')).toThrow(TextbeeConfigError)
  })

  it('never puts the default host into a self-hosted error message', () => {
    try {
      normalizeBaseUrl('not a url')
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).toContain('not a url')
    }
  })
})

describe('loadConfig', () => {
  const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  it('boots without an API key and trims whitespace', () => {
    const config = loadConfig({ TEXTBEE_API_KEY: '  ' }, silent)
    expect(config.apiKey).toBeUndefined()
    expect(config.baseUrl).toBe(TEXTBEE_DEFAULT_BASE_URL)
    expect(config.timeoutMs).toBe(30_000)
  })

  it('reads key, base url, and timeout from the environment', () => {
    const config = loadConfig(
      {
        TEXTBEE_API_KEY: 'k-1234',
        TEXTBEE_BASE_URL: 'https://sms.example.com',
        TEXTBEE_TIMEOUT_MS: '5000',
      },
      silent,
    )
    expect(config).toEqual({
      apiKey: 'k-1234',
      baseUrl: 'https://sms.example.com/api/v1',
      timeoutMs: 5000,
    })
  })

  it('falls back to the default timeout for non-numeric input', () => {
    expect(loadConfig({ TEXTBEE_TIMEOUT_MS: 'soon' }, silent).timeoutMs).toBe(30_000)
    expect(loadConfig({ TEXTBEE_TIMEOUT_MS: '-1' }, silent).timeoutMs).toBe(30_000)
  })
})

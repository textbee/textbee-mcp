import { createHash } from 'node:crypto'
import type { SendDedupe } from './types.js'

/**
 * Key an attempted send by who is sending what to whom. The API key is
 * fingerprinted, never stored raw, since this string can appear in a heap dump.
 */
export function sendDedupeKey(
  apiKey: string,
  message: string,
  recipients: string[],
): string {
  return createHash('sha256')
    .update(apiKey)
    .update('|')
    .update(message)
    .update('|')
    .update([...recipients].sort().join(','))
    .digest('hex')
}

/**
 * In-memory duplicate-send store for a host that serves many requests in one
 * process. Bounded so a flood of distinct sends cannot grow memory.
 */
export function createMemorySendDedupe(opts?: {
  windowMs?: number
  maxEntries?: number
}): SendDedupe {
  const windowMs = opts?.windowMs ?? 20_000
  const maxEntries = opts?.maxEntries ?? 5_000
  const entries = new Map<string, { at: number; text: string }>()

  function sweep(now: number): void {
    for (const [key, entry] of entries) {
      if (now - entry.at > windowMs) entries.delete(key)
    }
    // FIFO eviction beyond the bound; Map iterates in insertion order.
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  return {
    check(key) {
      const now = Date.now()
      sweep(now)
      const entry = entries.get(key)
      if (!entry) return undefined
      return { text: entry.text, ageMs: now - entry.at }
    },
    put(key, text) {
      const now = Date.now()
      sweep(now)
      entries.set(key, { at: now, text })
    },
  }
}

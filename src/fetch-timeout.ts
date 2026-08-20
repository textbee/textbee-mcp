const MARK = Symbol.for('textbee-mcp.fetchTimeout')

/**
 * The SDK exposes no timeout, no AbortSignal, and no fetch injection, so a
 * hung request would hang a tool call forever. This process-wide wrapper is
 * the only available lever. Entrypoints only: library code never calls it, so
 * importing @textbee/mcp patches nothing. Idempotent.
 */
export function installFetchTimeout(ms: number): void {
  const g = globalThis as { fetch: typeof fetch } & { [MARK]?: boolean }
  if (g[MARK] || !(ms > 0)) return
  const original = g.fetch
  g.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const timeout = AbortSignal.timeout(ms)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return original(input, { ...init, signal })
  }) as typeof fetch
  g[MARK] = true
}

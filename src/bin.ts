#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { VERSION, loadConfig, stderrLogger } from './config.js'
import { staticCredentials } from './credentials.js'
import { installFetchTimeout } from './fetch-timeout.js'
import { createTextbeeMcpServer } from './tools.js'
import type { StdioConfig } from './config.js'

let config: StdioConfig
try {
  config = loadConfig(process.env)
} catch (err) {
  stderrLogger.error(err instanceof Error ? err.message : err)
  process.exit(1)
}

installFetchTimeout(config.timeoutMs)

const server = createTextbeeMcpServer({
  credentials: staticCredentials(config),
  logger: stderrLogger,
})
await server.connect(new StdioServerTransport())

stderrLogger.info(
  `ready v${VERSION}: base=${config.baseUrl} key=${
    config.apiKey ? 'set' : 'MISSING, set TEXTBEE_API_KEY'
  } timeout=${config.timeoutMs}ms`,
)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().finally(() => process.exit(0))
  })
}
process.on('uncaughtException', (err) => {
  stderrLogger.error('uncaught exception:', err)
  process.exit(1)
})

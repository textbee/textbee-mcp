// Library entry. No side effects: importing this never connects a transport,
// reads process.env, or patches globals.

export {
  buildToolDefinitions,
  createTextbeeMcpServer,
  registerTextbeeTools,
} from './tools.js'
export type {
  BuildOptions,
  CredentialResolver,
  Logger,
  ResolvedCredentials,
  SendDedupe,
  TextbeeToolDefinition,
  ToolAnnotations,
  ToolCallContext,
  ToolResult,
} from './types.js'

export {
  TEXTBEE_AUTH_EXTRA_API_KEY,
  TEXTBEE_AUTH_EXTRA_BASE_URL,
  credentialsFromAuthInfoExtra,
  staticCredentials,
} from './credentials.js'

export {
  TEXTBEE_DEFAULT_BASE_URL,
  VERSION,
  loadConfig,
  normalizeBaseUrl,
  stderrLogger,
} from './config.js'
export type { StdioConfig } from './config.js'

export { createMemorySendDedupe, sendDedupeKey } from './dedupe.js'
export { installFetchTimeout } from './fetch-timeout.js'
export { TextbeeConfigError, isTextbeeError } from './errors.js'
export { FINAL_STATUSES, formatDevices, formatMessages, messageDirection } from './format.js'

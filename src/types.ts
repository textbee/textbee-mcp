export interface Logger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface TextContent {
  type: 'text'
  text: string
}

export interface ToolResult {
  content: TextContent[]
  isError?: boolean
}

/**
 * Structural slice of the MCP SDK's RequestHandlerExtra, so no SDK type
 * crosses this package's boundary. The stdio bin ignores most of it; the
 * remote host injects per-request credentials through `authInfo.extra`.
 */
export interface ToolCallContext {
  signal?: AbortSignal | undefined
  sessionId?: string | undefined
  authInfo?:
    | {
        token: string
        clientId?: string | undefined
        extra?: Record<string, unknown> | undefined
      }
    | undefined
  requestInfo?:
    | { headers: Record<string, string | string[] | undefined> }
    | undefined
}

export interface ResolvedCredentials {
  apiKey: string
  baseUrl: string
}

/** Called once per tool call. Must throw when credentials are absent, never fall back. */
export type CredentialResolver = (
  ctx: ToolCallContext,
) => ResolvedCredentials | Promise<ResolvedCredentials>

/** Cross-request duplicate-send store. See createMemorySendDedupe. */
export interface SendDedupe {
  /** Returns the earlier result and its age when an identical send is inside the window. */
  check(key: string): { text: string; ageMs: number } | undefined
  put(key: string, text: string): void
}

export interface BuildOptions {
  credentials: CredentialResolver
  logger?: Logger | undefined
  serverInfo?: { name?: string; version?: string } | undefined
  /**
   * Suppress an identical send repeated within the store's window. Intended
   * for the hosted remote, where HTTP clients retry timed-out calls and would
   * double-send. Omit for stdio.
   */
  sendDedupe?: SendDedupe | undefined
}

export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface TextbeeToolDefinition {
  name: string
  title: string
  description: string
  /** Raw zod shape (field name to validator), or undefined for a no-argument tool. */
  inputSchema: Record<string, unknown> | undefined
  annotations: ToolAnnotations
  handler: (input: unknown, ctx: ToolCallContext) => Promise<ToolResult>
}

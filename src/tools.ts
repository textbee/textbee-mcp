import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Textbee, countSmsSegments, isValidE164 } from '@textbee/sdk'
import { z } from 'zod'
import { TEXTBEE_DEFAULT_BASE_URL, VERSION, stderrLogger } from './config.js'
import { sendDedupeKey } from './dedupe.js'
import { errorResult } from './errors.js'
import { formatDevices, formatMessages } from './format.js'
import type {
  BuildOptions,
  Logger,
  TextbeeToolDefinition,
  ToolCallContext,
  ToolResult,
} from './types.js'

const INSTRUCTIONS =
  'textbee sends and reads SMS through the user\'s own Android phone. Sends cost the user ' +
  'real messages against their plan quota, so confirm the recipient before sending to a ' +
  'number the user has not named, and never retry a send that may have already succeeded. ' +
  'Reads are account-wide and need no device id.'

const SEND_SMS_DESCRIPTION =
  'Send an SMS through the user\'s own textbee account and Android phone. Recipients must ' +
  'be in international E.164 format such as +15550100123. The sending phone is chosen ' +
  'automatically: the account default device, otherwise the enabled device with the most ' +
  'recent heartbeat. Only pass device_id when the user explicitly names a phone; ids come ' +
  'from list_devices. Sending costs the user a real message against their textbee plan ' +
  'quota, so do not send speculatively and do not retry a send that may already have gone ' +
  'out. When the account has SMS queueing enabled the result includes an sms_batch_id; ' +
  'pass it to get_messages as sms_batch_id to check per-recipient delivery status.'

const GET_MESSAGES_DESCRIPTION =
  'Read the SMS messages on the user\'s textbee account, covering every device, no device ' +
  'id needed. direction defaults to "received": checking for a reply or a one-time code is ' +
  'the usual case. Pass direction "sent" to review what went out (each row carries its ' +
  'delivery status), or "all" for a conversation in order. Pass the sms_batch_id from a ' +
  'send to see that send\'s per-recipient delivery status. To poll for new messages ' +
  'without missing or repeating any: use order "asc" with a from bound, then keep calling ' +
  'with the next_cursor each result prints. from is inclusive and to is exclusive, so ' +
  'consecutive windows tile exactly. Reading does not consume the plan send quota. ' +
  'Messages reach textbee within a few seconds of arriving on the phone, so when waiting ' +
  'for a code, wait briefly and call again rather than tight-polling.'

const LIST_DEVICES_DESCRIPTION =
  'List the Android phones registered to this textbee account: id, name, enabled state, ' +
  'which one is the default sender, when each last checked in, and message counts. Call ' +
  'this when a send fails with a device error, when the user asks which phone will be ' +
  'used, or when you need a device_id. Takes no arguments and sends no SMS.'

const sendSmsShape = {
  message: z
    .string()
    .min(1)
    .max(1600)
    .describe(
      'The SMS body, plain text. Long messages are split into segments by the carrier ' +
        'and each segment counts against the quota; the result reports the segment count.',
    ),
  recipients: z
    .array(z.string().min(3))
    .min(1)
    .max(1000)
    .describe(
      'Phone numbers in international E.164 format including the country code, for ' +
        'example ["+15550100123"]. Each recipient counts as one message. The plan caps ' +
        'how many recipients one send may have; the server rejects the send beyond it.',
    ),
  device_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Which registered phone sends the message. Omit in almost every case and let ' +
        'textbee choose. Pass it only when the user asks for a specific phone. Ids come ' +
        'from list_devices.',
    ),
  sim_subscription_id: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Which SIM sends on a dual-SIM phone. The server does not validate this: a wrong ' +
        'value is silently ignored and the phone default SIM is used. The id is shown in ' +
        'the textbee Android app.',
    ),
  scheduled_at: z
    .string()
    .min(1)
    .optional()
    .describe(
      'ISO 8601 timestamp to send later instead of now, for example ' +
        '2026-09-01T14:30:00Z. Must be in the future, and requires the account\'s server ' +
        'to have queueing enabled. Omit to send immediately.',
    ),
}

const getMessagesShape = {
  direction: z
    .enum(['received', 'sent', 'all'])
    .optional()
    .describe(
      'Which direction to return. Defaults to "received" ("all" when sms_batch_id is ' +
        'set, since a batch\'s messages are outbound). "sent" reviews outgoing messages ' +
        'and their delivery status.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Messages per call, 1 to 100. Default 25.'),
  search: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Free text match across the message body and the other party\'s number. Use this ' +
        'instead of paging when looking for a specific code or keyword. Encrypted ' +
        'messages cannot be searched.',
    ),
  sms_batch_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Only messages from this batch, using the sms_batch_id a send returned. This is ' +
        'how to check a send\'s delivery: each row carries its status.',
    ),
  device_ids: z
    .array(z.string().min(1))
    .optional()
    .describe('Only messages from these devices. Ids come from list_devices. Omit for every device.'),
  cursor: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Opaque position from a previous result\'s next_cursor. Returns messages after ' +
        'that position, with no repeats and no gaps.',
    ),
  from: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Inclusive lower bound on when textbee stored the message. ISO 8601 with an ' +
        'explicit timezone, for example 2026-08-20T00:00:00Z.',
    ),
  to: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Exclusive upper bound, same format as from. Exclusive so consecutive windows ' +
        'never double-count a boundary message.',
    ),
  order: z
    .enum(['desc', 'asc'])
    .optional()
    .describe('desc (default) for newest first; asc to walk forward in time when polling.'),
}

interface CallEnv {
  client: Textbee
  apiKey: string
  baseUrl: string
  logger: Logger
}

export function buildToolDefinitions(opts: BuildOptions): TextbeeToolDefinition[] {
  const logger = opts.logger ?? stderrLogger

  const withClient = (
    body: (env: CallEnv, input: unknown) => Promise<ToolResult>,
  ): TextbeeToolDefinition['handler'] => {
    return async (input, ctx: ToolCallContext) => {
      let baseUrl = TEXTBEE_DEFAULT_BASE_URL
      try {
        const creds = await opts.credentials(ctx)
        baseUrl = creds.baseUrl
        const client = new Textbee({ apiKey: creds.apiKey, baseUrl: creds.baseUrl })
        return await body({ client, apiKey: creds.apiKey, baseUrl, logger }, input)
      } catch (err) {
        return errorResult(err, { baseUrl, logger })
      }
    }
  }

  const sendSmsBody = async (env: CallEnv, rawInput: unknown): Promise<ToolResult> => {
    const input = rawInput as {
      message: string
      recipients: string[]
      device_id?: string
      sim_subscription_id?: number
      scheduled_at?: string
    }

    const invalid = input.recipients.filter((r) => !isValidE164(r.trim()))
    if (invalid.length > 0) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              `Not sent. These recipients are not valid E.164 numbers: ${invalid.join(', ')}. ` +
              'Use the international format with a country code and no spaces, for example +15550100123.',
          },
        ],
      }
    }

    const recipients = input.recipients.map((r) => r.trim())
    const deviceId = input.device_id?.trim() || undefined

    const dedupeKey = opts.sendDedupe
      ? sendDedupeKey(env.apiKey, input.message, recipients)
      : undefined
    if (opts.sendDedupe && dedupeKey) {
      const earlier = opts.sendDedupe.check(dedupeKey)
      if (earlier) {
        const ageSeconds = Math.max(1, Math.round(earlier.ageMs / 1000))
        return {
          content: [
            {
              type: 'text',
              text:
                `${earlier.text}\n\nNote: an identical send to the same recipients was accepted ` +
                `${ageSeconds} seconds ago, so this call did not send again. Wait and retry ` +
                'only if you genuinely need the same text delivered twice.',
            },
          ],
        }
      }
    }

    const result = await env.client.sendSms({
      message: input.message,
      recipients,
      ...(deviceId !== undefined ? { deviceId } : {}),
      ...(input.sim_subscription_id !== undefined
        ? { simSubscriptionId: input.sim_subscription_id }
        : {}),
      ...(input.scheduled_at !== undefined ? { scheduledAt: input.scheduled_at } : {}),
    })

    const segments = countSmsSegments(input.message)
    const segmentNote = `Message is ${input.message.length} chars, ${segments.segments} SMS segment${
      segments.segments === 1 ? '' : 's'
    } (${segments.encoding}).`

    const lines: string[] = []
    if ('smsBatchId' in result && typeof result.smsBatchId === 'string') {
      lines.push(
        `Accepted for delivery to ${result.recipientCount} recipient${
          result.recipientCount === 1 ? '' : 's'
        }.${input.scheduled_at ? ` Scheduled for ${input.scheduled_at}.` : ''}`,
      )
      lines.push(segmentNote)
      lines.push(`sms_batch_id: ${result.smsBatchId}`)
      lines.push(
        `Check per-recipient delivery with get_messages sms_batch_id="${result.smsBatchId}". ` +
          'Statuses delivered, failed, and unknown are final.',
      )
    } else {
      const immediate = result as { successCount?: number; failureCount?: number }
      const success = immediate.successCount ?? 0
      const failure = immediate.failureCount ?? 0
      lines.push(`Dispatched to the phone: ${success} accepted, ${failure} failed.`)
      lines.push(segmentNote)
      lines.push(
        'This textbee server is not using the SMS queue, so there is no sms_batch_id to ' +
          'look up. Confirm delivery with get_messages direction="sent" or on the receiving phone.',
      )
    }

    const text = lines.join('\n')
    if (opts.sendDedupe && dedupeKey) {
      opts.sendDedupe.put(dedupeKey, text)
    }
    return { content: [{ type: 'text', text }] }
  }

  const getMessagesBody = async (env: CallEnv, rawInput: unknown): Promise<ToolResult> => {
    const input = (rawInput ?? {}) as {
      direction?: 'received' | 'sent' | 'all'
      limit?: number
      search?: string
      sms_batch_id?: string
      device_ids?: string[]
      cursor?: string
      from?: string
      to?: string
      order?: 'desc' | 'asc'
    }

    // A batch's messages are outbound, so a batch lookup with the "received"
    // default would always return zero rows.
    const direction = input.direction ?? (input.sms_batch_id ? 'all' : 'received')
    const order = input.order ?? 'desc'

    const list = await env.client.getMessages({
      direction,
      limit: input.limit ?? 25,
      ...(input.search !== undefined ? { search: input.search } : {}),
      ...(input.sms_batch_id !== undefined ? { smsBatchId: input.sms_batch_id } : {}),
      ...(input.device_ids !== undefined && input.device_ids.length > 0
        ? { deviceIds: input.device_ids }
        : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.from !== undefined ? { from: input.from } : {}),
      ...(input.to !== undefined ? { to: input.to } : {}),
      order,
    })

    return {
      content: [
        {
          type: 'text',
          text: formatMessages(list, {
            direction,
            usedCursor: input.cursor !== undefined,
            order,
          }),
        },
      ],
    }
  }

  const listDevicesBody = async (env: CallEnv): Promise<ToolResult> => {
    const devices = await env.client.getDevices()
    return { content: [{ type: 'text', text: formatDevices(devices) }] }
  }

  return [
    {
      name: 'send_sms',
      title: 'Send SMS',
      description: SEND_SMS_DESCRIPTION,
      inputSchema: sendSmsShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      handler: withClient(sendSmsBody),
    },
    {
      name: 'get_messages',
      title: 'Read messages',
      description: GET_MESSAGES_DESCRIPTION,
      inputSchema: getMessagesShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: withClient(getMessagesBody),
    },
    {
      name: 'list_devices',
      title: 'List devices',
      description: LIST_DEVICES_DESCRIPTION,
      inputSchema: undefined,
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: withClient((env) => listDevicesBody(env)),
    },
  ]
}

export function registerTextbeeTools(server: McpServer, opts: BuildOptions): void {
  for (const tool of buildToolDefinitions(opts)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
        annotations: tool.annotations,
      } as never,
      ((input: unknown, extra: unknown) =>
        tool.handler(
          tool.inputSchema ? input : undefined,
          (tool.inputSchema ? extra : input) as ToolCallContext,
        )) as never,
    )
  }
}

export function createTextbeeMcpServer(opts: BuildOptions): McpServer {
  const server = new McpServer(
    {
      name: opts.serverInfo?.name ?? 'textbee',
      version: opts.serverInfo?.version ?? VERSION,
    },
    { instructions: INSTRUCTIONS },
  )
  registerTextbeeTools(server, opts)
  return server
}

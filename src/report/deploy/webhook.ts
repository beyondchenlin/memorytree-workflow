/**
 * Webhook notification: sends a POST to configurable endpoints.
 * Supports Feishu, Telegram, Discord, Slack, and generic webhooks.
 * Never throws — failures are logged as warnings.
 */

import { getLogger } from '../../heartbeat/log.js'

export interface WebhookOptions {
  url: string
  sessionCount: number
  newSessionIds?: string[]
  reportUrl?: string
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

type Platform = 'feishu' | 'telegram' | 'discord' | 'slack' | 'generic'

/**
 * Detect platform from a parsed URL.
 * Uses exact hostname matching to prevent subdomain-spoofing attacks like
 * https://my-open.feishu.cn.attacker.com being mistaken for Feishu.
 */
function detectPlatform(parsedUrl: URL): Platform {
  const h = parsedUrl.hostname.toLowerCase()
  if (h === 'open.feishu.cn' || h === 'open.larksuite.com') return 'feishu'
  if (h === 'api.telegram.org') return 'telegram'
  if (h === 'discord.com' || h === 'discordapp.com') return 'discord'
  if (h === 'hooks.slack.com') return 'slack'
  return 'generic'
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

function buildFeishuPayload(options: WebhookOptions): Record<string, unknown> {
  const { sessionCount, newSessionIds = [], reportUrl } = options
  const newCount = newSessionIds.length
  const actionBtn = reportUrl
    ? [{
        tag: 'button',
        text: { content: 'View Report', tag: 'plain_text' },
        url: reportUrl,
        type: 'primary',
      }]
    : []

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { content: 'MemoryTree Report Updated', tag: 'plain_text' },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**Sessions:** ${sessionCount} total${newCount ? `, ${newCount} new` : ''}`,
          },
        },
        ...(actionBtn.length > 0 ? [{ tag: 'action', actions: actionBtn }] : []),
      ],
    },
  }
}

function buildTelegramPayload(options: WebhookOptions): Record<string, unknown> {
  const { sessionCount, newSessionIds = [], reportUrl } = options
  const newCount = newSessionIds.length
  let text = `📊 *MemoryTree Report Updated*\n\nSessions: ${sessionCount} total`
  if (newCount > 0) text += `, ${newCount} new`
  if (reportUrl) text += `\n[View Report](${reportUrl})`
  return { text, parse_mode: 'Markdown' }
}

function buildDiscordPayload(options: WebhookOptions): Record<string, unknown> {
  const { sessionCount, newSessionIds = [], reportUrl } = options
  const newCount = newSessionIds.length
  let content = `📊 **MemoryTree Report Updated** — ${sessionCount} sessions total`
  if (newCount > 0) content += `, ${newCount} new`
  if (reportUrl) content += ` · [View Report](${reportUrl})`
  return { content }
}

function buildSlackPayload(options: WebhookOptions): Record<string, unknown> {
  const { sessionCount, newSessionIds = [], reportUrl } = options
  const newCount = newSessionIds.length
  let text = `📊 MemoryTree Report Updated — ${sessionCount} sessions total`
  if (newCount > 0) text += `, ${newCount} new`
  if (reportUrl) text += ` · <${reportUrl}|View Report>`
  return { text }
}

function buildGenericPayload(options: WebhookOptions): Record<string, unknown> {
  return {
    event: 'memorytree.report.updated',
    session_count: options.sessionCount,
    new_session_count: options.newSessionIds?.length ?? 0,
    new_session_ids: options.newSessionIds ?? [],
    report_url: options.reportUrl ?? '',
  }
}

// ---------------------------------------------------------------------------
// URL safety validation
// ---------------------------------------------------------------------------

/** Private / loopback IPv4 ranges. */
const PRIVATE_IPV4_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/i

/**
 * Returns true for all private / loopback IPv6 addresses.
 * Node.js URL.hostname may return IPv6 with or without surrounding brackets,
 * so we strip them before checking.
 *   ::1           loopback
 *   fe80::/10     link-local (fe80 – febf)
 *   fc00::/7      ULA (fc and fd)
 *   ::ffff:0:0/96 IPv4-mapped
 */
function isPrivateIPv6(hostname: string): boolean {
  // Strip optional surrounding brackets added by some URL implementations
  const h = hostname.toLowerCase().replace(/^\[|]$/g, '')
  if (h === '::1') return true
  if (/^fe[89ab]/i.test(h)) return true       // fe80::/10 link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true  // fc00::/7 ULA
  if (h.startsWith('::ffff:')) return true    // IPv4-mapped
  return false
}

function validateWebhookUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid webhook URL: ${raw}`)
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Webhook URL must use https: (got ${url.protocol})`)
  }
  if (PRIVATE_IPV4_RE.test(url.hostname) || isPrivateIPv6(url.hostname)) {
    throw new Error(`Webhook URL hostname is private/loopback: ${url.hostname}`)
  }
  return url
}

// ---------------------------------------------------------------------------
// Main send function
// ---------------------------------------------------------------------------

export async function sendWebhook(options: WebhookOptions): Promise<void> {
  if (!options.url) return
  const logger = getLogger()

  let parsedUrl: URL
  try {
    parsedUrl = validateWebhookUrl(options.url)
  } catch (err) {
    logger.warn(`[webhook] Rejected URL: ${String(err)}`)
    return
  }

  const platform = detectPlatform(parsedUrl)

  const payloadMap: Record<Platform, (o: WebhookOptions) => Record<string, unknown>> = {
    feishu: buildFeishuPayload,
    telegram: buildTelegramPayload,
    discord: buildDiscordPayload,
    slack: buildSlackPayload,
    generic: buildGenericPayload,
  }

  const payload = payloadMap[platform](options)

  try {
    const { default: https } = await import('node:https')
    const body = JSON.stringify(payload)

    await new Promise<void>((resolve, reject) => {
      const url = parsedUrl
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        res => {
          // Consume response to avoid socket leak
          res.resume()
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`))
          } else {
            resolve()
          }
        },
      )
      req.on('error', reject)
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
      req.write(body)
      req.end()
    })

    logger.info(`[webhook] Sent ${platform} notification`)
  } catch (err: unknown) {
    logger.warn(`[webhook] Failed to send notification: ${String(err)}`)
    // Never throw
  }
}

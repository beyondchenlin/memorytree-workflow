import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ClientRequest, IncomingMessage } from 'node:https'

// Mock getLogger
vi.mock('../../../src/heartbeat/log.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Mock node:https so no real network calls are made
// ---------------------------------------------------------------------------

type RequestCallback = (res: Partial<IncomingMessage>) => void

const mockRequest = {
  write: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
  setTimeout: vi.fn(),
}

const mockHttpsRequest = vi.fn()

vi.mock('node:https', () => ({
  default: { request: mockHttpsRequest },
}))

import { sendWebhook } from '../../../src/report/deploy/webhook.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make mockHttpsRequest resolve immediately with the given status code. */
function mockSuccess(statusCode = 200) {
  mockHttpsRequest.mockImplementation((opts: unknown, cb: RequestCallback) => {
    cb({ statusCode, resume: vi.fn() })
    return mockRequest as unknown as ClientRequest
  })
}

/** Make mockHttpsRequest trigger the 'error' event. */
function mockNetworkError() {
  mockHttpsRequest.mockImplementation((_opts: unknown, _cb: RequestCallback) => {
    const req = {
      ...mockRequest,
      on: vi.fn().mockImplementation((event: string, handler: (e: Error) => void) => {
        if (event === 'error') handler(new Error('network failure'))
        return req
      }),
    }
    return req as unknown as ClientRequest
  })
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockRequest.on.mockReturnValue(mockRequest)
  mockRequest.setTimeout.mockReturnValue(mockRequest)
})

// ---------------------------------------------------------------------------
// No-op on empty URL
// ---------------------------------------------------------------------------

describe('sendWebhook — no-op on empty URL', () => {
  it('resolves immediately when url is empty', async () => {
    await expect(sendWebhook({ url: '', sessionCount: 10 })).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------

describe('sendWebhook — SSRF protection', () => {
  it('rejects http:// URLs (only https allowed)', async () => {
    await expect(
      sendWebhook({ url: 'http://example.com/webhook', sessionCount: 5 })
    ).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('rejects localhost', async () => {
    await expect(
      sendWebhook({ url: 'https://localhost/webhook', sessionCount: 5 })
    ).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('rejects 127.x.x.x', async () => {
    await expect(
      sendWebhook({ url: 'https://127.0.0.1/webhook', sessionCount: 5 })
    ).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('rejects 169.254.x.x (link-local / metadata endpoint)', async () => {
    await expect(
      sendWebhook({ url: 'https://169.254.169.254/latest/meta-data/', sessionCount: 5 })
    ).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('rejects 10.x.x.x (RFC 1918)', async () => {
    await expect(
      sendWebhook({ url: 'https://10.0.0.1/webhook', sessionCount: 5 })
    ).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('rejects IPv6 loopback ::1', async () => {
    await expect(
      sendWebhook({ url: 'https://[::1]/webhook', sessionCount: 5 })
    ).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('rejects IPv6 ULA fc00::/7 (fc range)', async () => {
    await expect(
      sendWebhook({ url: 'https://[fc00::1]/webhook', sessionCount: 5 })
    ).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('rejects IPv6 ULA fc00::/7 (fd range)', async () => {
    await expect(
      sendWebhook({ url: 'https://[fd12:3456::1]/webhook', sessionCount: 5 })
    ).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('rejects IPv6 link-local fe80::/10', async () => {
    await expect(
      sendWebhook({ url: 'https://[fe80::1]/webhook', sessionCount: 5 })
    ).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('rejects IPv4-mapped IPv6 ::ffff:127.0.0.1', async () => {
    await expect(
      sendWebhook({ url: 'https://[::ffff:127.0.0.1]/webhook', sessionCount: 5 })
    ).resolves.not.toThrow()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Platform detection — hostname spoofing resistance
// ---------------------------------------------------------------------------

describe('sendWebhook — platform detection spoofing resistance', () => {
  it('treats subdomain-spoof feishu URL as generic, not feishu', async () => {
    mockSuccess()
    await sendWebhook({
      url: 'https://my-open.feishu.cn.attacker.com/hook/test',
      sessionCount: 3,
    })

    const writtenBody = mockRequest.write.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(writtenBody) as { event?: string; msg_type?: string }
    // Generic payload has 'event' field; Feishu has 'msg_type'
    expect(parsed.event).toBe('memorytree.report.updated')
    expect(parsed.msg_type).toBeUndefined()
  })

  it('treats path-spoof telegram URL as generic', async () => {
    mockSuccess()
    await sendWebhook({
      url: 'https://evil.com/api.telegram.org/botTEST/sendMessage',
      sessionCount: 1,
    })

    const writtenBody = mockRequest.write.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(writtenBody) as { event?: string; text?: string }
    expect(parsed.event).toBe('memorytree.report.updated')
    expect(parsed.text).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Network failure does not throw
// ---------------------------------------------------------------------------

describe('sendWebhook — network failure does not throw', () => {
  it('resolves even when HTTP request triggers error event', async () => {
    mockNetworkError()
    await expect(
      sendWebhook({ url: 'https://hooks.slack.com/services/test', sessionCount: 5 })
    ).resolves.not.toThrow()
  })

  it('resolves on HTTP 4xx response', async () => {
    mockSuccess(400)
    await expect(
      sendWebhook({ url: 'https://hooks.slack.com/services/test', sessionCount: 5 })
    ).resolves.not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Payload assertions
// ---------------------------------------------------------------------------

describe('sendWebhook — payload structure', () => {
  it('sends correct JSON body for slack', async () => {
    mockSuccess()
    await sendWebhook({ url: 'https://hooks.slack.com/services/test', sessionCount: 7 })

    expect(mockHttpsRequest).toHaveBeenCalled()
    const writtenBody = mockRequest.write.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(writtenBody) as { text: string }
    expect(parsed.text).toContain('7')
    expect(parsed.text).toContain('MemoryTree')
  })

  it('sends correct JSON body for discord', async () => {
    mockSuccess()
    await sendWebhook({
      url: 'https://discord.com/api/webhooks/123/test',
      sessionCount: 5,
      reportUrl: 'https://example.com/report',
    })

    const writtenBody = mockRequest.write.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(writtenBody) as { content: string }
    expect(parsed.content).toContain('5')
    expect(parsed.content).toContain('MemoryTree')
  })

  it('includes new session count in feishu payload', async () => {
    mockSuccess()
    await sendWebhook({
      url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      sessionCount: 42,
      newSessionIds: ['s1', 's2'],
    })

    const writtenBody = mockRequest.write.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(writtenBody) as Record<string, unknown>
    // Feishu sends interactive card
    expect(parsed.msg_type).toBe('interactive')
  })

  it('sends generic payload for unknown URL', async () => {
    mockSuccess()
    await sendWebhook({
      url: 'https://my-server.example.com/webhook',
      sessionCount: 3,
      newSessionIds: ['s1'],
    })

    const writtenBody = mockRequest.write.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(writtenBody) as {
      event: string
      session_count: number
      new_session_count: number
    }
    expect(parsed.event).toBe('memorytree.report.updated')
    expect(parsed.session_count).toBe(3)
    expect(parsed.new_session_count).toBe(1)
  })

  it('sends correct hostname in request options', async () => {
    mockSuccess()
    await sendWebhook({ url: 'https://hooks.slack.com/services/test', sessionCount: 1 })

    const reqOpts = mockHttpsRequest.mock.calls[0]?.[0] as { hostname: string }
    expect(reqOpts.hostname).toBe('hooks.slack.com')
  })

  it('sets Content-Type: application/json and Content-Length headers', async () => {
    mockSuccess()
    await sendWebhook({ url: 'https://hooks.slack.com/services/test', sessionCount: 1 })

    const reqOpts = mockHttpsRequest.mock.calls[0]?.[0] as {
      headers: Record<string, string | number>
    }
    expect(reqOpts.headers['Content-Type']).toBe('application/json')
    expect(typeof reqOpts.headers['Content-Length']).toBe('number')
    expect(reqOpts.headers['Content-Length'] as number).toBeGreaterThan(0)
  })

  it('sets request timeout to 5000 ms', async () => {
    mockSuccess()
    await sendWebhook({ url: 'https://hooks.slack.com/services/test', sessionCount: 1 })

    expect(mockRequest.setTimeout).toHaveBeenCalledWith(5000, expect.any(Function))
  })
})

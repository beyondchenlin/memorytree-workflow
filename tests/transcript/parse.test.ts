import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  inferClient,
  parseTranscript,
  parseCodexTranscript,
  parseClaudeTranscript,
  parseGeminiTranscript,
  parseDoubaoTranscript,
  isCodexSystemInjection,
} from '../../src/transcript/parse.js'

// ---------------------------------------------------------------------------
// inferClient
// ---------------------------------------------------------------------------

describe('inferClient', () => {
  it('returns explicit client unchanged', () => {
    expect(inferClient('codex', '/any/path/file.jsonl')).toBe('codex')
  })

  it('infers codex from /.codex/ in path', () => {
    expect(inferClient('auto', '/home/user/.codex/sessions/abc.jsonl')).toBe('codex')
  })

  it('infers codex from rollout- filename', () => {
    expect(inferClient('auto', '/tmp/rollout-1234.jsonl')).toBe('codex')
  })

  it('infers claude from /.claude/ in path', () => {
    expect(inferClient('auto', '/home/user/.claude/projects/abc.jsonl')).toBe('claude')
  })

  it('infers claude from /projects/ in path', () => {
    expect(inferClient('auto', '/home/user/projects/session.jsonl')).toBe('claude')
  })

  it('infers gemini from /.gemini/ in path', () => {
    expect(inferClient('auto', '/home/user/.gemini/sessions/abc.jsonl')).toBe('gemini')
  })

  it('infers gemini from checkpoint in path', () => {
    expect(inferClient('auto', '/tmp/checkpoint_session.json')).toBe('gemini')
  })

  it('is case-insensitive for path matching', () => {
    expect(inferClient('auto', '/home/user/.CODEX/sessions/abc.jsonl')).toBe('codex')
  })

  it('throws for unrecognized path', () => {
    expect(() => inferClient('auto', '/tmp/unknown/file.jsonl')).toThrow(
      /could not infer transcript client/
    )
  })
})

// ---------------------------------------------------------------------------
// parseCodexTranscript
// ---------------------------------------------------------------------------

describe('parseCodexTranscript', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'codex-parse-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses session_meta and message records', () => {
    const filePath = join(tmpDir, 'test-session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'ses-123',
          thread_name: 'My Thread',
          timestamp: '2024-06-01T10:00:00Z',
          cwd: '/home/user/project',
          git: { branch: 'main' },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:05Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'text', text: 'Hello from user' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:10Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello from assistant' }],
        },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseCodexTranscript(filePath)
    expect(result.client).toBe('codex')
    expect(result.session_id).toBe('ses-123')
    expect(result.title).toBe('My Thread')
    expect(result.cwd).toBe('/home/user/project')
    expect(result.branch).toBe('main')
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]!.role).toBe('user')
    expect(result.messages[0]!.text).toBe('Hello from user')
    expect(result.messages[1]!.role).toBe('assistant')
    expect(result.messages[1]!.text).toBe('Hello from assistant')
  })

  it('uses user_message / agent_message as fallback when no message records exist', () => {
    // Simulates older Codex versions that emit only streaming event_msg records.
    const filePath = join(tmpDir, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2024-06-01T10:00:00Z',
        payload: { type: 'user_message', message: 'User says hi' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2024-06-01T10:00:05Z',
        payload: { type: 'agent_message', message: 'Agent responds' },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseCodexTranscript(filePath)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]!.role).toBe('user')
    expect(result.messages[0]!.text).toBe('User says hi')
    expect(result.messages[1]!.role).toBe('assistant')
    expect(result.messages[1]!.text).toBe('Agent responds')
  })

  it('prefers canonical message records over streaming agent_message / user_message', () => {
    // The Codex CLI double-encodes every message: each turn appears as both an
    // event_msg (streaming) and a response_item (canonical). The canonical form
    // must win and streaming events must be ignored entirely, even when their
    // timestamps differ by a millisecond from the canonical record.
    const filePath = join(tmpDir, 'dual-encoding.jsonl')
    const lines = [
      // Streaming event fires first at T=264ms
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2024-06-01T10:00:00.264Z',
        payload: { type: 'user_message', message: 'Hello from user' },
      }),
      // Canonical record arrives at T=265ms (1 ms later)
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:00.265Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello from user' }],
        },
      }),
      // Streaming assistant event
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2024-06-01T10:00:05.100Z',
        payload: { type: 'agent_message', message: 'Hello from assistant' },
      }),
      // Canonical assistant record (same ms — dedup would catch this too, but
      // the streaming path should not run at all when canonical records exist)
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:05.100Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello from assistant' }],
        },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseCodexTranscript(filePath)
    // Must have exactly 2 messages — no duplicates from streaming events.
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]!.role).toBe('user')
    expect(result.messages[0]!.text).toBe('Hello from user')
    expect(result.messages[1]!.role).toBe('assistant')
    expect(result.messages[1]!.text).toBe('Hello from assistant')
  })

  it('filters Codex system context injections from user messages', () => {
    // The Codex CLI injects AGENTS.md instructions, skill definitions, and
    // environment metadata as the first message(role=user) record. These must
    // not appear in the clean transcript.
    const filePath = join(tmpDir, 'injection.jsonl')
    const injectionText =
      '# AGENTS.md instructions for D:\\demo1\\project\n<INSTRUCTIONS>\n## Skills\n...</INSTRUCTIONS>'
    const lines = [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:00Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: injectionText }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:01Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '如何安装这个skill' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:05Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '使用 skill-installer' }],
        },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseCodexTranscript(filePath)
    // Injection must be filtered; only the real user question and answer remain.
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]!.role).toBe('user')
    expect(result.messages[0]!.text).toBe('如何安装这个skill')
    expect(result.messages[1]!.role).toBe('assistant')
    expect(result.messages[1]!.text).toBe('使用 skill-installer')
  })

  it('also filters injections from streaming fallback messages', () => {
    // Same injection filter applies when only streaming events exist.
    const filePath = join(tmpDir, 'stream-injection.jsonl')
    const lines = [
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2024-06-01T10:00:00Z',
        payload: {
          type: 'user_message',
          message: '<environment_context><cwd>/home/user</cwd></environment_context>',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2024-06-01T10:00:01Z',
        payload: { type: 'user_message', message: 'Real user question' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2024-06-01T10:00:05Z',
        payload: { type: 'agent_message', message: 'Real assistant answer' },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseCodexTranscript(filePath)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]!.text).toBe('Real user question')
    expect(result.messages[1]!.text).toBe('Real assistant answer')
  })

  it('keeps later user turns that legitimately mention injection markers', () => {
    const filePath = join(tmpDir, 'late-marker.jsonl')
    const lines = [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:00Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<INSTRUCTIONS>\ninternal bootstrap' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:01Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Please explain how Codex uses AGENTS.md.' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:05Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'It injects AGENTS.md at session start.' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:10Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Show me the literal tag <environment_context> in the payload.' }],
        },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseCodexTranscript(filePath)
    expect(result.messages).toHaveLength(3)
    expect(result.messages[0]!.text).toBe('Please explain how Codex uses AGENTS.md.')
    expect(result.messages[1]!.text).toBe('It injects AGENTS.md at session start.')
    expect(result.messages[2]!.text).toBe('Show me the literal tag <environment_context> in the payload.')
  })

  it('parses function_call and function_call_output', () => {
    const filePath = join(tmpDir, 'tools.jsonl')
    const lines = [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:00Z',
        payload: {
          type: 'function_call',
          name: 'readFile',
          arguments: '/tmp/test.txt',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:05Z',
        payload: {
          type: 'function_call_output',
          name: 'readFile',
          output: 'file contents here',
        },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseCodexTranscript(filePath)
    expect(result.tool_events).toHaveLength(2)
    expect(result.tool_events[0]!.summary).toContain('readFile input=')
    expect(result.tool_events[1]!.summary).toContain('readFile output=')
  })

  it('parses custom_tool_call and custom_tool_call_output', () => {
    const filePath = join(tmpDir, 'custom-tools.jsonl')
    const lines = [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:00Z',
        payload: {
          type: 'custom_tool_call',
          name: 'myTool',
          input: { key: 'value' },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2024-06-01T10:00:05Z',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'myTool-1',
          output: 'result data',
        },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseCodexTranscript(filePath)
    expect(result.tool_events).toHaveLength(2)
    expect(result.tool_events[0]!.summary).toContain('myTool input=')
    expect(result.tool_events[1]!.summary).toContain('myTool-1 output=')
  })

  it('deduplicates identical messages', () => {
    const filePath = join(tmpDir, 'dedup.jsonl')
    const record = JSON.stringify({
      type: 'response_item',
      timestamp: '2024-06-01T10:00:00Z',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
    })
    writeFileSync(filePath, `${record}\n${record}\n`)

    const result = parseCodexTranscript(filePath)
    expect(result.messages).toHaveLength(1)
  })

  it('uses filename stem as fallback session_id and title', () => {
    const filePath = join(tmpDir, 'my-session.jsonl')
    writeFileSync(filePath, '')

    const result = parseCodexTranscript(filePath)
    expect(result.session_id).toBe('my-session')
    expect(result.title).toBe('my-session')
  })

  it('skips records with unknown record type', () => {
    const filePath = join(tmpDir, 'skip.jsonl')
    const lines = [
      JSON.stringify({ type: 'unknown_type', payload: { type: 'message', role: 'user', content: [{ type: 'text', text: 'skip me' }] } }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseCodexTranscript(filePath)
    expect(result.messages).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// parseClaudeTranscript
// ---------------------------------------------------------------------------

describe('parseClaudeTranscript', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'claude-parse-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses user and assistant records with text content blocks', () => {
    const filePath = join(tmpDir, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'user',
        timestamp: '2024-06-01T10:00:00Z',
        sessionId: 'claude-ses-1',
        cwd: '/home/user/proj',
        gitBranch: 'feature',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'User question' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2024-06-01T10:00:10Z',
        sessionId: 'claude-ses-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Assistant answer' }],
        },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseClaudeTranscript(filePath)
    expect(result.client).toBe('claude')
    expect(result.session_id).toBe('claude-ses-1')
    expect(result.cwd).toBe('/home/user/proj')
    expect(result.branch).toBe('feature')
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]!.role).toBe('user')
    expect(result.messages[0]!.text).toBe('User question')
    expect(result.messages[1]!.role).toBe('assistant')
    expect(result.messages[1]!.text).toBe('Assistant answer')
  })

  it('handles string content in message', () => {
    const filePath = join(tmpDir, 'string-content.jsonl')
    const lines = [
      JSON.stringify({
        type: 'user',
        timestamp: '2024-06-01T10:00:00Z',
        message: { role: 'user', content: 'Simple string content' },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseClaudeTranscript(filePath)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.text).toBe('Simple string content')
  })

  it('extracts tool_use and tool_result blocks', () => {
    const filePath = join(tmpDir, 'tools.jsonl')
    const lines = [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2024-06-01T10:00:00Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check that' },
            { type: 'tool_use', name: 'readFile', input: { path: '/tmp/f.txt' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2024-06-01T10:00:05Z',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_123', content: 'file contents' },
          ],
        },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseClaudeTranscript(filePath)
    expect(result.tool_events).toHaveLength(2)
    expect(result.tool_events[0]!.summary).toContain('readFile input=')
    expect(result.tool_events[1]!.summary).toContain('toolu_123 output=')
    // The assistant message should also contain the text part
    expect(result.messages.some(m => m.text === 'Let me check that')).toBe(true)
  })

  it('skips thinking blocks', () => {
    const filePath = join(tmpDir, 'thinking.jsonl')
    const lines = [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2024-06-01T10:00:00Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'internal reasoning...' },
            { type: 'text', text: 'visible response' },
          ],
        },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseClaudeTranscript(filePath)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.text).toBe('visible response')
  })

  it('skips non-user/assistant record types', () => {
    const filePath = join(tmpDir, 'skip.jsonl')
    const lines = [
      JSON.stringify({
        type: 'system',
        timestamp: '2024-06-01T10:00:00Z',
        message: { role: 'system', content: 'System prompt' },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseClaudeTranscript(filePath)
    expect(result.messages).toHaveLength(0)
  })

  it('deduplicates messages', () => {
    const filePath = join(tmpDir, 'dedup.jsonl')
    const record = JSON.stringify({
      type: 'user',
      timestamp: '2024-06-01T10:00:00Z',
      message: { role: 'user', content: 'Hello' },
    })
    writeFileSync(filePath, `${record}\n${record}\n`)

    const result = parseClaudeTranscript(filePath)
    expect(result.messages).toHaveLength(1)
  })

  it('handles string blocks in content array', () => {
    const filePath = join(tmpDir, 'string-blocks.jsonl')
    const lines = [
      JSON.stringify({
        type: 'user',
        timestamp: '2024-06-01T10:00:00Z',
        message: { role: 'user', content: ['First part', 'Second part'] },
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseClaudeTranscript(filePath)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.text).toBe('First part\n\nSecond part')
  })
})

// ---------------------------------------------------------------------------
// parseGeminiTranscript
// ---------------------------------------------------------------------------

describe('parseGeminiTranscript', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gemini-parse-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses JSON file with user and model roles', () => {
    const filePath = join(tmpDir, 'session.json')
    const data = {
      sessionId: 'gem-123',
      timestamp: '2024-06-01T10:00:00Z',
      cwd: '/home/user/proj',
      branch: 'dev',
      turns: [
        { role: 'user', text: 'User message', timestamp: '2024-06-01T10:00:00Z' },
        { role: 'model', text: 'Model response', timestamp: '2024-06-01T10:00:05Z' },
      ],
    }
    writeFileSync(filePath, JSON.stringify(data))

    const result = parseGeminiTranscript(filePath)
    expect(result.client).toBe('gemini')
    expect(result.session_id).toBe('gem-123')
    expect(result.cwd).toBe('/home/user/proj')
    expect(result.branch).toBe('dev')
    expect(result.messages.length).toBeGreaterThanOrEqual(2)
    // model role is normalized to assistant
    expect(result.messages.some(m => m.role === 'assistant')).toBe(true)
    expect(result.messages.some(m => m.role === 'user')).toBe(true)
  })

  it('parses JSONL file', () => {
    const filePath = join(tmpDir, 'session.jsonl')
    const lines = [
      JSON.stringify({
        sessionId: 'gem-jsonl',
        timestamp: '2024-06-01T10:00:00Z',
        role: 'user',
        text: 'JSONL user message',
      }),
      JSON.stringify({
        role: 'assistant',
        text: 'JSONL assistant response',
        timestamp: '2024-06-01T10:00:05Z',
      }),
    ]
    writeFileSync(filePath, lines.join('\n'))

    const result = parseGeminiTranscript(filePath)
    expect(result.session_id).toBe('gem-jsonl')
    expect(result.messages.length).toBeGreaterThanOrEqual(2)
  })

  it('extracts tool events from toolUse.name', () => {
    const filePath = join(tmpDir, 'tools.json')
    const data = [
      {
        role: 'assistant',
        text: 'Using a tool',
        timestamp: '2024-06-01T10:00:00Z',
        toolUse: { name: 'readFile' },
        args: { path: '/tmp/file.txt' },
      },
    ]
    writeFileSync(filePath, JSON.stringify(data))

    const result = parseGeminiTranscript(filePath)
    expect(result.tool_events.length).toBeGreaterThanOrEqual(1)
    expect(result.tool_events[0]!.summary).toContain('readFile input=')
  })

  it('extracts tool events from toolName', () => {
    const filePath = join(tmpDir, 'toolname.json')
    const data = [
      {
        role: 'assistant',
        text: 'Tool call',
        timestamp: '2024-06-01T10:00:00Z',
        toolName: 'writeFile',
        input: { path: '/tmp/out.txt' },
      },
    ]
    writeFileSync(filePath, JSON.stringify(data))

    const result = parseGeminiTranscript(filePath)
    expect(result.tool_events.some(e => e.summary.includes('writeFile'))).toBe(true)
  })

  it('extracts metadata from first mapping with keys', () => {
    const filePath = join(tmpDir, 'meta.json')
    const data = {
      wrapper: {
        chatId: 'chat-456',
        timestamp: '2024-01-01T00:00:00Z',
        cwd: '/deep/path',
        branch: 'staging',
      },
      turns: [
        { role: 'user', text: 'Hello', timestamp: '2024-06-01T10:00:00Z' },
      ],
    }
    writeFileSync(filePath, JSON.stringify(data))

    const result = parseGeminiTranscript(filePath)
    expect(result.session_id).toBe('chat-456')
    expect(result.cwd).toBe('/deep/path')
    expect(result.branch).toBe('staging')
  })

  it('deduplicates messages', () => {
    const filePath = join(tmpDir, 'dedup.json')
    const entry = { role: 'user', text: 'Same message', timestamp: '2024-06-01T10:00:00Z' }
    writeFileSync(filePath, JSON.stringify([entry, entry]))

    const result = parseGeminiTranscript(filePath)
    // After dedup, should have only 1
    expect(result.messages).toHaveLength(1)
  })

  it('uses filename stem as fallback session_id', () => {
    const filePath = join(tmpDir, 'my-gemini-session.json')
    writeFileSync(filePath, JSON.stringify([{ role: 'user', text: 'Hi', timestamp: '2024-06-01T10:00:00Z' }]))

    const result = parseGeminiTranscript(filePath)
    // session_id comes from the records (they have no sessionId), so falls back to stem
    expect(result.session_id).toBe('my-gemini-session')
  })

  it('uses author field for role detection', () => {
    const filePath = join(tmpDir, 'author.json')
    const data = [
      { author: 'user', text: 'Author user', timestamp: '2024-06-01T10:00:00Z' },
    ]
    writeFileSync(filePath, JSON.stringify(data))

    const result = parseGeminiTranscript(filePath)
    expect(result.messages.some(m => m.role === 'user' && m.text === 'Author user')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// parseTranscript dispatch
// ---------------------------------------------------------------------------

describe('parseTranscript', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dispatch-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('dispatches to codex parser', () => {
    const filePath = join(tmpDir, 'session.jsonl')
    writeFileSync(filePath, JSON.stringify({
      type: 'response_item',
      timestamp: '2024-06-01T10:00:00Z',
      payload: { type: 'user_message', message: 'hello' },
    }) + '\n')

    const result = parseTranscript('codex', filePath)
    expect(result.client).toBe('codex')
    expect(result.messages).toHaveLength(1)
  })

  it('dispatches to claude parser', () => {
    const filePath = join(tmpDir, 'session.jsonl')
    writeFileSync(filePath, JSON.stringify({
      type: 'user',
      timestamp: '2024-06-01T10:00:00Z',
      message: { role: 'user', content: 'hello' },
    }) + '\n')

    const result = parseTranscript('claude', filePath)
    expect(result.client).toBe('claude')
  })

  it('dispatches to gemini parser', () => {
    const filePath = join(tmpDir, 'session.json')
    writeFileSync(filePath, JSON.stringify([
      { role: 'user', text: 'hello', timestamp: '2024-06-01T10:00:00Z' },
    ]))

    const result = parseTranscript('gemini', filePath)
    expect(result.client).toBe('gemini')
  })

  it('auto-infers client from path and dispatches', () => {
    // Create a file in a .codex subdirectory
    const codexDir = join(tmpDir, '.codex')
    mkdirSync(codexDir, { recursive: true })
    const filePath = join(codexDir, 'session.jsonl')
    writeFileSync(filePath, JSON.stringify({
      type: 'event_msg',
      timestamp: '2024-06-01T10:00:00Z',
      payload: { type: 'user_message', message: 'auto-detected' },
    }) + '\n')

    const result = parseTranscript('auto', filePath)
    expect(result.client).toBe('codex')
    expect(result.messages[0]!.text).toBe('auto-detected')
  })
})

// ---------------------------------------------------------------------------
// isCodexSystemInjection
// ---------------------------------------------------------------------------

describe('isCodexSystemInjection', () => {
  it('returns true for AGENTS.md header', () => {
    expect(isCodexSystemInjection('# AGENTS.md instructions for D:\\project\n...')).toBe(true)
  })

  it('returns true for <INSTRUCTIONS> block', () => {
    expect(isCodexSystemInjection('<INSTRUCTIONS>\n## Skills\n...</INSTRUCTIONS>')).toBe(true)
  })

  it('returns true for <environment_context> block', () => {
    expect(isCodexSystemInjection('<environment_context><cwd>/home/user</cwd></environment_context>')).toBe(true)
  })

  it('returns true for <permissions instructions> block', () => {
    expect(isCodexSystemInjection('<permissions instructions>\nFilesystem sandboxing...')).toBe(true)
  })

  it('returns true for <collaboration_mode> block', () => {
    expect(isCodexSystemInjection('<collaboration_mode># Collaboration Mode: Default\n...')).toBe(true)
  })

  it('returns false for normal user messages', () => {
    expect(isCodexSystemInjection('如何安装这个skill')).toBe(false)
    expect(isCodexSystemInjection('Hello, can you help me?')).toBe(false)
    expect(isCodexSystemInjection('Please review my code')).toBe(false)
  })

  it('returns false for assistant messages that mention instructions', () => {
    // Should not accidentally filter assistant responses that quote markers
    expect(isCodexSystemInjection('The AGENTS.md file contains project rules')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseDoubaoTranscript
// ---------------------------------------------------------------------------

/** Build a minimal valid Doubao TXT file content */
function makeDoubaoTxt(overrides: {
  title?: string
  url?: string
  created?: string
  messages?: Array<{ role: 'User' | 'AI'; time: string; text: string }>
}): string {
  const title = overrides.title ?? '测试对话'
  const url = overrides.url ?? 'https://www.doubao.com/chat/12345678901234567'
  const created = overrides.created ?? '2026-03-16 10:22:17'
  const messages = overrides.messages ?? [
    { role: 'User', time: '2026-03-16 10:22:17', text: '你好' },
    { role: 'AI', time: '2026-03-16 10:22:20', text: '你好！有什么可以帮你的？' },
  ]

  const header = [
    `Title: ${title}`,
    `URL: ${url}`,
    `Platform: 豆包`,
    `Created: ${created}`,
    `Messages: ${messages.length}`,
  ].join('\n')

  const body = messages
    .map(m => `${m.role}: [${m.time}]\n${m.text}`)
    .join('\n\n')

  return `${header}\n\n${body}\n`
}

describe('parseDoubaoTranscript', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doubao-parse-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses header fields: title, session_id (from URL), started_at', () => {
    const filePath = join(tmpDir, 'doubao_20260316_test.txt')
    writeFileSync(filePath, makeDoubaoTxt({
      title: '小说创作平台调研',
      url: 'https://www.doubao.com/chat/38416801786598914',
      created: '2026-03-16 10:22:17',
    }))

    const result = parseDoubaoTranscript(filePath)
    expect(result.client).toBe('doubao')
    expect(result.title).toBe('小说创作平台调研')
    expect(result.session_id).toBe('38416801786598914')
    expect(result.started_at).toBe('2026-03-16T10:22:17')
  })

  it('parses user and AI message turns with correct roles', () => {
    const filePath = join(tmpDir, 'doubao_test.txt')
    writeFileSync(filePath, makeDoubaoTxt({
      messages: [
        { role: 'User', time: '2026-03-16 10:22:17', text: '你好，请介绍一下自己' },
        { role: 'AI',   time: '2026-03-16 10:22:20', text: '我是豆包，字节跳动推出的 AI 助手。' },
        { role: 'User', time: '2026-03-16 10:22:25', text: '你能做什么？' },
        { role: 'AI',   time: '2026-03-16 10:22:28', text: '我可以回答问题、写作、编程等。' },
      ],
    }))

    const result = parseDoubaoTranscript(filePath)
    expect(result.messages).toHaveLength(4)
    expect(result.messages[0]!.role).toBe('user')
    expect(result.messages[0]!.text).toBe('你好，请介绍一下自己')
    expect(result.messages[1]!.role).toBe('assistant')
    expect(result.messages[1]!.text).toBe('我是豆包，字节跳动推出的 AI 助手。')
    expect(result.messages[2]!.role).toBe('user')
    expect(result.messages[3]!.role).toBe('assistant')
  })

  it('parses multi-line AI responses correctly', () => {
    const filePath = join(tmpDir, 'doubao_multiline.txt')
    const content = makeDoubaoTxt({
      messages: [
        { role: 'User', time: '2026-03-16 10:00:00', text: '列一个清单' },
        {
          role: 'AI',
          time: '2026-03-16 10:00:05',
          text: '当然：\n1. 第一项\n2. 第二项\n3. 第三项',
        },
      ],
    })
    writeFileSync(filePath, content)

    const result = parseDoubaoTranscript(filePath)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1]!.text).toContain('1. 第一项')
    expect(result.messages[1]!.text).toContain('3. 第三项')
  })

  it('extracts correct timestamps from turn headers', () => {
    const filePath = join(tmpDir, 'doubao_ts.txt')
    writeFileSync(filePath, makeDoubaoTxt({
      messages: [
        { role: 'User', time: '2026-03-05 22:45:10', text: '早上好' },
        { role: 'AI',   time: '2026-03-05 22:45:15', text: '早上好！' },
      ],
    }))

    const result = parseDoubaoTranscript(filePath)
    expect(result.messages[0]!.timestamp).toBe('2026-03-05T22:45:10')
    expect(result.messages[1]!.timestamp).toBe('2026-03-05T22:45:15')
  })

  it('returns empty tool_events (doubao has no tool calls)', () => {
    const filePath = join(tmpDir, 'doubao_tools.txt')
    writeFileSync(filePath, makeDoubaoTxt({}))

    const result = parseDoubaoTranscript(filePath)
    expect(result.tool_events).toHaveLength(0)
  })

  it('returns empty cwd and branch (external platform has no local context)', () => {
    const filePath = join(tmpDir, 'doubao_ctx.txt')
    writeFileSync(filePath, makeDoubaoTxt({}))

    const result = parseDoubaoTranscript(filePath)
    expect(result.cwd).toBe('')
    expect(result.branch).toBe('')
  })

  it('falls back to filename stem as session_id when URL is missing', () => {
    const filePath = join(tmpDir, 'doubao_20260316_fallback.txt')
    // Omit URL line
    const content = 'Title: 无URL对话\nPlatform: 豆包\nCreated: 2026-03-16 10:00:00\nMessages: 1\n\nUser: [2026-03-16 10:00:00]\n问题\n\nAI: [2026-03-16 10:00:05]\n回答\n'
    writeFileSync(filePath, content)

    const result = parseDoubaoTranscript(filePath)
    expect(result.session_id).toBe('doubao_20260316_fallback')
  })

  it('deduplicates identical consecutive messages', () => {
    const filePath = join(tmpDir, 'doubao_dedup.txt')
    // Same timestamp + role + text = duplicate
    const content = makeDoubaoTxt({
      messages: [
        { role: 'User', time: '2026-03-16 10:00:00', text: '重复消息' },
        { role: 'User', time: '2026-03-16 10:00:00', text: '重复消息' },
        { role: 'AI',   time: '2026-03-16 10:00:05', text: '回答' },
      ],
    })
    writeFileSync(filePath, content)

    const result = parseDoubaoTranscript(filePath)
    // Deduplication should collapse the two identical user messages
    expect(result.messages.length).toBeLessThan(3)
  })
})

// ---------------------------------------------------------------------------
// inferClient — doubao additions
// ---------------------------------------------------------------------------

describe('inferClient — doubao', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'infer-doubao-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('infers doubao from filename starting with doubao_', () => {
    expect(inferClient('auto', '/tmp/doubao_20260316_test.txt')).toBe('doubao')
  })

  it('infers doubao from path containing /doubao/', () => {
    expect(inferClient('auto', '/exports/doubao/session.txt')).toBe('doubao')
  })

  it('returns explicit doubao client unchanged', () => {
    expect(inferClient('doubao', '/any/path/file.txt')).toBe('doubao')
  })
})

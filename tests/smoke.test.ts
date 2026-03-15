import { describe, it, expect } from 'vitest'
import { toPosixPath } from '../src/utils/path.js'

describe('toPosixPath', () => {
  it('converts Windows backslashes to forward slashes', () => {
    expect(toPosixPath('C:\\Users\\ai')).toBe('C:/Users/ai')
  })

  it('preserves already-posix paths', () => {
    expect(toPosixPath('/home/user/project')).toBe('/home/user/project')
  })

  it('normalizes redundant separators', () => {
    expect(toPosixPath('C:\\Users\\\\ai\\\\project')).toBe('C:/Users/ai/project')
  })

  it('handles empty string', () => {
    expect(toPosixPath('')).toBe('.')
  })

  it('normalizes dot segments', () => {
    expect(toPosixPath('a/b/../c')).toBe('a/c')
  })
})

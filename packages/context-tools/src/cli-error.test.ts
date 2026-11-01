import { expect, it } from 'vitest'
import { formatCliError } from './cli-error.js'
it('keeps normal diagnostics and escapes terminal controls in error paths', () => {
  expect(formatCliError(new Error('not found'))).toBe('encrypted-context: not found\n')
  const text=formatCliError(new Error('/missing/\u001b[31m\nFAKE\u202e'))
  expect(text).not.toMatch(/[\u001b\u202e]/u)
  expect(text.trimEnd().split('\n')).toHaveLength(1)
  expect(text).toContain('\\nFAKE')
})
it('bounds encoded diagnostic bytes, including Unicode and control expansion', () => {
 for(const value of ['界'.repeat(10000),'\u001b'.repeat(10000),'💡'.repeat(10000)]){
  const text=formatCliError(new Error(value))
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4096)
  expect(text).toMatch(/…\n$/u)
 }
})

import { expect, it } from 'vitest'
import { PacketReferences } from './repository-packet-references.js'

it('expires references and rejects another root or generation', () => {
  let now = 100
  const cache = new PacketReferences('/repo', () => now)
  cache.put('one', 'generation', { source: 'selected' })
  expect(cache.resolve('one', '/repo', 'generation')).toEqual({ source: 'selected' })
  expect(() => cache.resolve('one', '/other', 'generation')).toThrow()
  expect(() => cache.resolve('one', '/repo', 'other-generation')).toThrow()
  now += 600_000
  expect(() => cache.resolve('one', '/repo', 'generation')).toThrow()
})

it('retains at most four packets and makes independent copies on write and read', () => {
  const cache = new PacketReferences('/repo')
  const packet = { source: { text: 'original' } }
  cache.put('one', 'generation', packet)
  packet.source.text = 'changed by producer'
  const returned = cache.resolve('one', '/repo', 'generation') as typeof packet
  returned.source.text = 'changed by consumer'
  expect(cache.resolve('one', '/repo', 'generation')).toEqual({ source: { text: 'original' } })
  for (let i = 2; i <= 5; i++) cache.put(String(i), 'generation', { source: i })
  expect(() => cache.resolve('one', '/repo', 'generation')).toThrow()
  expect(cache.resolve('5', '/repo', 'generation')).toEqual({ source: 5 })
  cache.clear()
  expect(() => cache.resolve('5', '/repo', 'generation')).toThrow()
})

it('rejects an oversized packet without evicting a retained valid reference', () => {
  const cache = new PacketReferences('/repo')
  for (let i = 0; i < 4; i++) cache.put(String(i), 'generation', { source: i })
  expect(() => cache.put('oversized', 'generation', { source: 'x'.repeat(65_536) })).toThrow()
  expect(cache.resolve('0', '/repo', 'generation')).toEqual({ source: 0 })
})

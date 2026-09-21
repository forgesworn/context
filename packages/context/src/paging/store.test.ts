import { describe, expect, it } from 'vitest'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { Buffer } from 'node:buffer'
import { MemoryBlobStore, MemoryRootStore } from './store.js'

describe('MemoryBlobStore', () => {
  it('stores immutable bytes at their SHA-256 digest and is idempotent', async () => {
    const store = new MemoryBlobStore()
    const input = new Uint8Array([1, 2, 3, 4])
    const expected = bytesToHex(sha256(input))
    const digest = await store.put(input)
    expect(digest).toBe(expected)
    expect(await store.put(new Uint8Array([1, 2, 3, 4]))).toBe(expected)

    input[0] = 99
    const firstRead = await store.get(digest)
    expect(firstRead).toEqual(new Uint8Array([1, 2, 3, 4]))
    firstRead![1] = 88
    expect(await store.get(digest)).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('returns undefined only for a valid missing digest', async () => {
    const store = new MemoryBlobStore()
    expect(await store.get('00'.repeat(32))).toBeUndefined()
    await expect(store.get('abc')).rejects.toThrow('lowercase SHA-256')
    await expect(store.get('AA'.repeat(32))).rejects.toThrow('lowercase SHA-256')
  })

  it('rejects empty and non-byte input', async () => {
    const store = new MemoryBlobStore()
    await expect(store.put(new Uint8Array())).rejects.toThrow('non-empty Uint8Array')
    await expect(store.put('bytes' as unknown as Uint8Array)).rejects.toThrow('non-empty Uint8Array')
  })

  it('isolates the stored bytes from a Buffer that is mutated after put', async () => {
    const store = new MemoryBlobStore()
    const buf = Buffer.from([1, 2, 3, 4])
    const digest = await store.put(buf)
    buf[0] = 99
    expect(await store.get(digest)).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('rejects a coercible object passed as a digest', async () => {
    const store = new MemoryBlobStore()
    await expect(store.get({ toString: () => '00'.repeat(32) } as unknown as string))
      .rejects.toThrow('lowercase SHA-256')
  })
})

describe('MemoryRootStore', () => {
  it('commits the first root and rejects a stale expected head', async () => {
    const store = new MemoryRootStore()
    const first = '11'.repeat(32), second = '22'.repeat(32)
    expect(await store.readHead()).toBeNull()
    expect(await store.compareAndSwap(null, first)).toBe(true)
    expect(await store.compareAndSwap(null, second)).toBe(false)
    expect(await store.readHead()).toBe(first)
    expect(await store.compareAndSwap(first, second)).toBe(true)
    expect(await store.readHead()).toBe(second)
  })

  it('allows exactly one concurrent writer for the same expected head', async () => {
    const store = new MemoryRootStore()
    const left = '33'.repeat(32), right = '44'.repeat(32)
    const results = await Promise.all([
      store.compareAndSwap(null, left),
      store.compareAndSwap(null, right),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await store.readHead()).toBe(results[0] ? left : right)
  })

  it('rejects malformed expected and next digests without changing the head', async () => {
    const store = new MemoryRootStore()
    const valid = '55'.repeat(32)
    await expect(store.compareAndSwap(null, 'bad')).rejects.toThrow('lowercase SHA-256')
    await expect(store.compareAndSwap('GG'.repeat(32), valid)).rejects.toThrow('lowercase SHA-256')
    expect(await store.readHead()).toBeNull()
  })
})

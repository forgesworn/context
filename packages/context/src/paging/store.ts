import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

export interface BlobStore {
  put(bytes: Uint8Array): Promise<string>
  get(digest: string): Promise<Uint8Array | undefined>
}

export interface RootStore {
  readHead(): Promise<string | null>
  compareAndSwap(expectedHead: string | null, nextHead: string): Promise<boolean>
}

const digestPattern = /^[0-9a-f]{64}$/

function checkDigest(value: string, name: string): void {
  if (typeof value !== 'string') throw new Error(`${name} must be a lowercase SHA-256 digest.`)
  if (!digestPattern.test(value)) throw new Error(`${name} must be a lowercase SHA-256 digest.`)
}

export class MemoryBlobStore implements BlobStore {
  readonly #blobs = new Map<string, Uint8Array>()

  async put(bytes: Uint8Array): Promise<string> {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error('Blob bytes must be a non-empty Uint8Array.')
    const copy = new Uint8Array(bytes)
    const digest = bytesToHex(sha256(copy))
    if (!this.#blobs.has(digest)) this.#blobs.set(digest, copy)
    return digest
  }

  async get(digest: string): Promise<Uint8Array | undefined> {
    checkDigest(digest, 'Blob digest')
    return this.#blobs.get(digest)?.slice()
  }
}

/** Test foundation for the future persistent head store. Comparison and update
 * are synchronous within one JavaScript turn; no sequence chooses a sibling. */
export class MemoryRootStore implements RootStore {
  #head: string | null = null

  async readHead(): Promise<string | null> {
    return this.#head
  }

  async compareAndSwap(expectedHead: string | null, nextHead: string): Promise<boolean> {
    if (expectedHead !== null) checkDigest(expectedHead, 'Expected head')
    checkDigest(nextHead, 'Next head')
    if (expectedHead !== this.#head) return false
    this.#head = nextHead
    return true
  }
}

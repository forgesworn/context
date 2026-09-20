import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanBroadSourceGraph } from './broad-source-scan.js'
import { ContextVault } from '@forgesworn/context'
import { createNostrIdentity } from '@forgesworn/context/nostr'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'context-broad-source-')); roots.push(root); return root }
async function source(root: string, path: string, text: string | Uint8Array): Promise<void> {
  const file = join(root, path); await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, text)
}
function bySource(result: Awaited<ReturnType<typeof scanBroadSourceGraph>>, expected: string) {
  return result.records.find(record => record.source === expected)!
}

describe('bounded broad-language source graph scan', () => {
  it('finds representative declarations across every supported language family', async () => {
    const root = await fixture()
    const samples: Record<string, string> = {
      'a.py': 'def python_fn():\n    pass', 'a.rs': 'pub struct RustType {}', 'a.go': 'func GoFunc() {}',
      'A.java': 'public class JavaType {}', 'A.kt': 'data class KotlinType(val x: Int)', 'A.swift': 'struct SwiftType {}',
      'a.c': 'struct CType { int x; };', 'a.cpp': 'class CppType {};', 'A.cs': 'public class CSharpType {}',
      'a.rb': 'module RubyType\nend', 'a.php': '<?php class PhpType {}',
    }
    for (const [path, text] of Object.entries(samples)) await source(root, path, text)
    const result = await scanBroadSourceGraph(root, { observedAt: 123 })
    expect(result.languages).toEqual(['c', 'cpp', 'csharp', 'go', 'java', 'kotlin', 'php', 'python', 'ruby', 'rust', 'swift'])
    for (const name of ['python_fn', 'RustType', 'GoFunc', 'JavaType', 'KotlinType', 'SwiftType', 'CType', 'CppType', 'CSharpType', 'RubyType', 'PhpType']) {
      expect(result.records.some(record => record.text.includes(name) && record.provenance?.derivation === 'inferred')).toBe(true)
    }
  })

  it('ignores declarations inside comments and strings', async () => {
    const root = await fixture()
    await source(root, 'fake.py', '# def comment_fake():\nvalue = "class StringFake:"\n"""def triple_fake():\n pass"""\ndef real():\n pass')
    await source(root, 'fake.cpp', '// class CommentFake {};\nconst char* x = "class StringFake {};";\nclass RealType {};')
    const result = await scanBroadSourceGraph(root, { observedAt: 123 })
    expect(result.records.some(record => /comment_fake|StringFake|triple_fake|CommentFake/u.test(record.text))).toBe(false)
    expect(result.records.some(record => record.text.includes('real'))).toBe(true)
    expect(result.records.some(record => record.text.includes('RealType'))).toBe(true)
  })

  it('links only conservative local imports and marks importing files ambiguous', async () => {
    const root = await fixture()
    await source(root, 'py/helper.py', 'def helper(): pass'); await source(root, 'py/main.py', 'from .helper import helper\nimport os')
    await source(root, 'rust/helper.rs', 'pub fn helper() {}'); await source(root, 'rust/main.rs', 'mod helper;\nuse external::Thing;')
    await source(root, 'c/helper.h', 'struct Helper {};'); await source(root, 'c/main.c', '#include "helper.h"\n#include <stdio.h>')
    await source(root, 'ruby/helper.rb', 'def helper\nend'); await source(root, 'ruby/main.rb', "require_relative './helper'\nrequire 'json'")
    const result = await scanBroadSourceGraph(root, { observedAt: 123 })
    expect(result.importsFound).toBe(4)
    for (const path of ['py/main.py', 'rust/main.rs', 'c/main.c', 'ruby/main.rb']) {
      const record = bySource(result, `repo://${path}`)
      expect(record.relations?.filter(link => link.kind === 'imports')).toHaveLength(1)
      expect(record.provenance).toEqual({ derivation: 'ambiguous', method: 'language-regex', confidence: 30 })
    }
  })

  it('is deterministic, append-safe and never emits dangling links', async () => {
    const root = await fixture()
    await source(root, 'helper.py', 'def helper(): pass'); await source(root, 'main.py', 'from .helper import helper\ndef main(): pass')
    const first = await scanBroadSourceGraph(root, { observedAt: 123 }), second = await scanBroadSourceGraph(root, { observedAt: 123 })
    expect(first).toEqual(second)
    const ids = new Set(first.records.map(record => record.id))
    expect(first.records.flatMap(record => record.relations ?? []).every(link => ids.has(link.to))).toBe(true)
    const vault = new ContextVault({ identity: createNostrIdentity(new Uint8Array(32).fill(45)), now: () => 123 })
    const view = await vault.create({ title: 'Broad source', scope: 'personal' })
    await expect(vault.appendBatch(view.id, view.head, first.records)).resolves.toBeDefined()
  })

  it('ignores generated, hidden and symlinked trees, skips invalid UTF-8 and enforces bounds', async () => {
    const root = await fixture(), outside = await fixture()
    await source(root, 'valid.py', 'def valid(): pass'); await source(root, 'node_modules/no.py', 'def generated(): pass')
    await source(root, '.hidden/no.rs', 'fn hidden() {}'); await source(root, 'invalid.py', Uint8Array.from([0xc3, 0x28]))
    await source(outside, 'external.py', 'def external(): pass'); await symlink(outside, join(root, 'linked'))
    const result = await scanBroadSourceGraph(root, { observedAt: 123 })
    expect(result.records.some(record => /generated|hidden|external/u.test(record.text))).toBe(false)
    expect(result.filesSkipped).toBeGreaterThan(0)
    await expect(scanBroadSourceGraph(root, { maxFiles: 129 })).rejects.toThrow('1 to 128')
    await expect(scanBroadSourceGraph(root, { maxFileBytes: 2048, maxBytes: 1024 })).rejects.toThrow('no larger')
    await expect(scanBroadSourceGraph(root, { maxRecords: 0 })).rejects.toThrow('1 to 128')
  })

  it('retains file coverage before symbols under the record cap', async () => {
    const root = await fixture()
    await source(root, 'a.py', 'def a(): pass'); await source(root, 'b.rs', 'fn b() {}')
    const result = await scanBroadSourceGraph(root, { observedAt: 123, maxRecords: 2 })
    expect(result.records.map(record => record.source)).toEqual(['repo://a.py', 'repo://b.rs'])
    expect(result.records.every(record => !record.source.includes('#'))).toBe(true)
  })
})

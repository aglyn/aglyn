/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * A partial write to a version document must not destroy its nodes
 * (AGL-1250).
 *
 * All three version converters compress `nodes` at rest. They used to do it
 * unconditionally — `compress(rest?.nodes || {})` — so a `setDoc(…, {merge:
 * true})` that carried only some OTHER field still emitted a `nodes` key
 * holding an empty compressed map, and merge faithfully merged that
 * emptiness over the real tree.
 *
 * This is not theoretical: the component Properties dialog (AGL-1247) is the
 * first caller to write a version field on its own, and it wiped a real
 * 222-node component on its first save. The published parent doc was the
 * only reason the content was recoverable.
 *
 * The converters are inline in `withConverter(...)` and not exported, so the
 * assertion is on the shape they are built from: each `toFirestore` must
 * return early, WITHOUT a `nodes` key, when the payload has no nodes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const HOOKS_DIR = join(__dirname)

/**
 * Every converter that compresses `nodes`, by path from this directory.
 *
 * `use-form-version.tsx`, `use-host-template.tsx` and the shared
 * `besigner-nodes-converter.ts` joined the original three as compression
 * reached the rest of the besigner kinds (AGL-1151). The list is the point:
 * the guard below is what each of them has to carry, and a converter added
 * without it is exactly the document AGL-1250 destroyed.
 */
const VERSION_HOOKS = [
  'use-screen-version.tsx',
  'use-layout-version.tsx',
  'use-component-version.tsx',
  'use-form-version.tsx',
  'use-host-template.tsx',
  'helpers/besigner-nodes-converter.ts',
]

describe('version converters: a partial write keeps the nodes (AGL-1250)', () => {
  it.each(VERSION_HOOKS)('%s guards toFirestore on undefined nodes', (file) => {
    const source = readFileSync(join(HOOKS_DIR, file), 'utf8')
    // The guard must come before any encoding, so a payload without nodes
    // never reaches the encoder.
    expect(source).toContain('rest?.nodes === undefined')
    const guardAt = source.indexOf('rest?.nodes === undefined')
    // Either name for the encoder: the older converters call `compress`
    // directly, the newer ones go through `encodeStoredNodes`, and both are
    // the thing that must not run before the guard.
    const encodeAt = Math.min(
      ...[source.indexOf('compress('), source.indexOf('encodeStoredNodes(')]
        .filter((at) => at > -1)
        .concat(Number.MAX_SAFE_INTEGER),
    )
    expect(guardAt).toBeGreaterThan(-1)
    expect(encodeAt).toBeGreaterThan(guardAt)
    expect(encodeAt).toBeLessThan(Number.MAX_SAFE_INTEGER)
  })

  it.each(VERSION_HOOKS)(
    '%s never compresses a defaulted empty map',
    (file) => {
      const source = readFileSync(join(HOOKS_DIR, file), 'utf8')
      // `compress(rest?.nodes || {})` is the exact bug: the `|| {}` is what
      // turned "no nodes in this write" into "the tree is now empty".
      expect(source).not.toMatch(/compress\(\s*rest\??\.?\??nodes\s*\|\|\s*\{\}\s*\)/)
      expect(source).not.toMatch(
        /encodeStoredNodes\(\s*rest\??\.?\??nodes\s*\|\|\s*\{\}\s*\)/,
      )
      expect(source).not.toContain('|| {}))')
    },
  )

  /**
   * The READ half, which the original three did not need stating because
   * they were the only compressed kinds. Now that every besigner document is
   * compressed, a converter that encodes on write and does NOT decode on
   * read is the worse half of the pair: the editor seeds its canvas and its
   * conflict baseline from this value, so the stored form would reach four
   * comparisons that expect a node map.
   */
  it.each(VERSION_HOOKS)('%s decodes on the way back out', (file) => {
    const source = readFileSync(join(HOOKS_DIR, file), 'utf8')
    expect(source).toMatch(/decompress\(|decodeStoredNodes\(/)
  })
})

/**
 * The behavioural half: a converter built the fixed way drops `nodes` from a
 * partial payload and still compresses a full one. Mirrors the real
 * converters rather than importing them (they are closed over `useFirestore`
 * and a live `DocumentReference`).
 */
describe('the fixed converter shape', () => {
  class FakeBytes {
    constructor(readonly bytes: Uint8Array) {}
    static fromUint8Array(bytes: Uint8Array) {
      return new FakeBytes(bytes)
    }
  }
  const compress = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value))

  const toFirestore = (data: Record<string, unknown>) => {
    const { $id, ...rest } = data
    if (rest?.nodes === undefined) return { ...rest, updatedAt: 'stamp' }
    const nodes =
      rest.nodes instanceof FakeBytes
        ? rest.nodes
        : FakeBytes.fromUint8Array(compress(rest.nodes))
    return { ...rest, nodes, updatedAt: 'stamp' }
  }

  it('omits nodes entirely from a props-only write', () => {
    const out = toFirestore({ $id: 'v1', props: [{ name: 'headline' }] })
    // The key must be ABSENT, not empty: Firestore merge only leaves a
    // field alone when the payload does not mention it.
    expect('nodes' in out).toBe(false)
    expect(out).toMatchObject({ props: [{ name: 'headline' }] })
  })

  it('still compresses a real node map', () => {
    const out = toFirestore({ $id: 'v1', nodes: { a: { $id: 'a' } } }) as {
      nodes: FakeBytes
    }
    expect(out.nodes).toBeInstanceOf(FakeBytes)
    expect(JSON.parse(new TextDecoder().decode(out.nodes.bytes))).toEqual({
      a: { $id: 'a' },
    })
  })

  it('passes an already-compressed value through untouched', () => {
    const already = FakeBytes.fromUint8Array(new Uint8Array([1, 2, 3]))
    const out = toFirestore({ $id: 'v1', nodes: already }) as {
      nodes: FakeBytes
    }
    expect(out.nodes).toBe(already)
  })

  it('negative control: an explicitly empty map is still written', () => {
    // Clearing a document is a legitimate operation and must survive — the
    // fix distinguishes "no nodes in this write" from "no nodes at all".
    const out = toFirestore({ $id: 'v1', nodes: {} }) as { nodes: FakeBytes }
    expect('nodes' in out).toBe(true)
    expect(JSON.parse(new TextDecoder().decode(out.nodes.bytes))).toEqual({})
  })
})

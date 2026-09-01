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

import { compress, decodeStoredNodes } from '@aglyn/aglyn'
import { decodeEmailNodes } from '@aglyn/shared-util-email'

/**
 * Drift guard (AGL-1223), the same device `email-media-src-drift.spec.ts`
 * uses one file over.
 *
 * `libs/shared/util/email/src/lib/stored-email-nodes.ts` carries a COPY of
 * `decodeStoredNodes`. It has to: `shared-util-email` is tagged
 * `scope:shared`, and the module-boundary rule makes shared libs leaves, so
 * it cannot import `@aglyn/aglyn` — the arrow points the other way so every
 * send site can pull the email renderer without the framework.
 *
 * This spec lives in the console because the console may import BOTH, and it
 * runs the two implementations over one table of inputs. A divergence means
 * the send path and the rest of the platform disagree about what a stored
 * design contains, and the failure is silent in the worst direction: a
 * `Buffer` walked as a map yields byte indices, so an emptiness guard passes
 * and the recipient gets a blank email instead of the built-in fallback.
 */

const NODES = {
  '_@_': { $id: '_@_', componentId: 'div', nodes: ['t1'] },
  t1: {
    $id: 't1',
    componentId: 'emailText',
    pluginId: 'email',
    parentId: '_@_',
    props: { children: 'Hi {{name}}', variant: 'body' },
  },
}

/**
 * What firebase-admin hands back for a bytes field: a `Buffer` carved from
 * the shared pool, so `byteOffset` is non-zero and the backing `ArrayBuffer`
 * is the whole pool. Built from a dedicated slab rather than `Buffer.from`,
 * so the offset is deterministic instead of whatever the process left behind.
 */
function pooledBuffer() {
  const bytes = compress(NODES)
  const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
  const packed = pool.subarray(64, 64 + bytes.byteLength)
  packed.set(bytes)
  return packed
}

describe('email node decoding does not drift from @aglyn/aglyn', () => {
  /** Every form the platform stores, plus the shapes that must pass through. */
  const CASES: Array<[string, unknown]> = [
    ['a plain node map', NODES],
    ['an empty map', {}],
    ['a pooled admin Buffer', pooledBuffer()],
    ['a bare Uint8Array', compress(NODES)],
    ['a client SDK Bytes', { toUint8Array: () => compress(NODES) }],
    ['a JSON Buffer envelope', JSON.parse(JSON.stringify(pooledBuffer()))],
    ['absent', undefined],
    ['null', null],
    // Shapes that merely RESEMBLE the envelope must survive as maps, or a
    // legitimate design gets swallowed.
    ['an envelope with an extra key', { type: 'Buffer', data: [1], x: {} }],
    ['a map with a type node', { type: { componentId: 'text' } }],
    ['a map with a toUint8Array node', { toUint8Array: { componentId: 'x' } }],
  ]

  it.each(CASES)('agrees on %s', (_name, input) => {
    expect(decodeEmailNodes(input)).toEqual(decodeStoredNodes(input))
  })

  it('agrees that undecodable bytes are not an empty design', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const junk = Buffer.from([0xc1, 0xc1, 0xc1])
      expect(decodeEmailNodes(junk)).toBeNull()
      expect(decodeStoredNodes(junk)).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  /**
   * Identity, not just equality, for the plain form. Callers treat "came back
   * unchanged" as the signal a document was never compressed, and a copy
   * would make every one of them think the tree had been rewritten.
   */
  it('passes a plain map through by identity, as the original does', () => {
    expect(decodeEmailNodes(NODES)).toBe(NODES)
    expect(decodeStoredNodes(NODES)).toBe(NODES)
  })

  /**
   * The pooled-offset case, asserted as a property rather than a value: a
   * decoder that ignored `byteOffset` would read the whole allocation pool
   * and throw on the trailing bytes, which this file's own fixture would
   * otherwise be free to stop reproducing.
   */
  it('reads a pooled Buffer at its own offset', () => {
    const packed = pooledBuffer()
    expect(packed.byteOffset).toBeGreaterThan(0)
    expect(packed.buffer.byteLength).toBeGreaterThan(packed.byteLength)
    expect(decodeEmailNodes(packed)).toEqual(NODES)
  })
})

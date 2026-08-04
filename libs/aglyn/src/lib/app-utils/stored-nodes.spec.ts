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

import { nodesReferenceBinding } from './binding-tokens'
import { compress } from './compress'
import {
  REUSABLE_INSTANCE_COMPONENT_ID,
  nodesReferenceComponent,
} from './compose-reusable-components'
import { decodeStoredNodes } from './stored-nodes'

/** A node map that unambiguously references both a variable and a component. */
const NODES = {
  '_@_': { componentId: 'container', nodes: ['n1', 'n2'] },
  n1: { componentId: 'text', props: { children: 'Hello {{var:aB3xK9m2Qw}}' } },
  n2: {
    componentId: REUSABLE_INSTANCE_COMPONENT_ID,
    props: { refId: 'cmp_hero' },
  },
}
const VARIABLE = { kind: 'variable' as const, id: 'aB3xK9m2Qw' }

/**
 * What firebase-admin actually hands back for a bytes field: a Node `Buffer`
 * carved out of the shared 8 KB allocation pool, so `byteOffset` is non-zero
 * and `buffer.byteLength` is the whole pool rather than the field.
 *
 * Carve it from a slab of our own rather than reaching for `Buffer.from` or
 * `Buffer.allocUnsafe`: those DO draw on the real pool, but the offset they
 * land at is whatever the rest of the process left behind — 0 whenever the
 * pool has just been replaced — so the premise guard below would pass or fail
 * by luck. A dedicated slab reproduces the same shape deterministically.
 */
const pooledBuffer = () => {
  const bytes = compress(NODES)
  const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
  const packed = pool.subarray(64, 64 + bytes.byteLength)
  packed.set(bytes)
  return packed
}

describe('decodeStoredNodes', () => {
  it('passes a plain Firestore map through unchanged', () => {
    expect(decodeStoredNodes(NODES)).toBe(NODES)
  })

  it('decodes the compressed form out of a pooled Buffer', () => {
    const packed = pooledBuffer()
    // Guard the premise: a test on a zero-offset buffer would pass even with
    // the byteOffset bug, which is the bug most likely to come back.
    expect(packed.byteOffset).toBeGreaterThan(0)
    expect(packed.buffer.byteLength).toBeGreaterThan(packed.byteLength)

    expect(decodeStoredNodes(packed)).toEqual(NODES)
  })

  it('decodes a bare Uint8Array view at a non-zero offset', () => {
    const bytes = compress(NODES)
    const padded = new Uint8Array(bytes.byteLength + 8)
    padded.set(bytes, 8)
    const view = padded.subarray(8)

    expect(view.byteOffset).toBe(8)
    expect(decodeStoredNodes(view)).toEqual(NODES)
  })

  it('reports absent nodes as null', () => {
    expect(decodeStoredNodes(undefined)).toBeNull()
    expect(decodeStoredNodes(null)).toBeNull()
  })

  it('returns null rather than throwing on undecodable bytes', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(decodeStoredNodes(Buffer.from([0xc1, 0xc1, 0xc1]))).toBeNull()
      // Silence would let a whole scan read as "nothing references this".
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

/**
 * The regression this exists to prevent (AGL-1223).
 *
 * Neither predicate throws on a Buffer — both walk it and find nothing, so
 * the endpoint answers "used nowhere" for a document that plainly uses the
 * thing. These assertions pin the raw reads as broken so that "just pass
 * `snapshot.get('nodes')` straight in" cannot come back green.
 */
describe('the raw storage form defeats the scan predicates', () => {
  it('finds the references once decoded, and none before', () => {
    const packed = pooledBuffer()

    expect(nodesReferenceBinding(packed as never, VARIABLE)).toEqual([])
    expect(nodesReferenceComponent(packed as never, 'cmp_hero')).toBe(false)

    const decoded = decodeStoredNodes(packed)
    expect(nodesReferenceBinding(decoded as never, VARIABLE)).toEqual(['id'])
    expect(nodesReferenceComponent(decoded as never, 'cmp_hero')).toBe(true)
  })

  it('is a no-op for the plain form, so both storage forms agree', () => {
    expect(nodesReferenceBinding(NODES as never, VARIABLE)).toEqual(
      nodesReferenceBinding(decodeStoredNodes(pooledBuffer()) as never, VARIABLE),
    )
    expect(nodesReferenceComponent(NODES as never, 'cmp_hero')).toBe(
      nodesReferenceComponent(
        decodeStoredNodes(pooledBuffer()) as never,
        'cmp_hero',
      ),
    )
  })
})

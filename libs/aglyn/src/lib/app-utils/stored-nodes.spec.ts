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

  /**
   * The CLIENT SDK's form (AGL-1397). Every fix before it — AGL-1223,
   * AGL-1391 — was on a server read, where firebase-admin materialises a
   * bytes field as a Node `Buffer`, an `ArrayBuffer` view. `firebase/firestore`
   * hands back a `Bytes` instead: not a view, and not a plain map either, so
   * without this branch it falls through to `return raw as T` and four
   * console reads keep their blindness while looking fixed.
   *
   * Asserted structurally rather than against the class, to keep
   * `firebase/firestore` out of this library — `decompress` already types the
   * contract as `ByteSource`, and `apps/console/specs/publish-token-normalization.spec.ts`
   * pins the real `Bytes` against it.
   */
  it('decodes the client SDK form, a ByteSource with toUint8Array', () => {
    const bytes = compress(NODES)
    const source = { toUint8Array: () => bytes }

    expect(ArrayBuffer.isView(source)).toBe(false)
    expect(decodeStoredNodes(source)).toEqual(NODES)
  })

  it('does not mistake a node map for a ByteSource', () => {
    // It cannot collide — a node map's values are node OBJECTS, never
    // functions — but the guard is what makes that reasoning hold.
    const map = { toUint8Array: { componentId: 'text' } }
    expect(decodeStoredNodes(map)).toBe(map)
  })

  it('decodes a bare Uint8Array view at a non-zero offset', () => {
    const bytes = compress(NODES)
    const padded = new Uint8Array(bytes.byteLength + 8)
    padded.set(bytes, 8)
    const view = padded.subarray(8)

    expect(view.byteOffset).toBe(8)
    expect(decodeStoredNodes(view)).toEqual(NODES)
  })

  /**
   * The third storage form (AGL-1391): what `JSON.stringify` makes of a Node
   * `Buffer`. It reaches this helper from site-export bundles downloaded
   * before the export learned to decode, and it is the nastiest of the three
   * — an `ArrayBuffer` view is at least recognisable, but this is a plain
   * object, so without the branch it returns UNCHANGED and every caller walks
   * an object whose only keys are `type` and `data`.
   */
  describe('the JSON Buffer envelope', () => {
    it('decodes it back to the node map', () => {
      const envelope = JSON.parse(JSON.stringify(pooledBuffer()))
      expect(envelope).toEqual({ type: 'Buffer', data: expect.any(Array) })

      expect(decodeStoredNodes(envelope)).toEqual(NODES)
    })

    it('leaves a node map whose keys merely resemble it alone', () => {
      // The test has to be exact, or a legitimate map could be swallowed. It
      // cannot actually collide — a node map's values are node OBJECTS, so
      // `type` would have to hold the string 'Buffer' — but the guard is what
      // makes that reasoning hold rather than being an argument in a comment.
      for (const map of [
        { type: { componentId: 'text' }, data: { componentId: 'text' } },
        { type: 'Buffer', data: [1, 2, 3], extra: { componentId: 'text' } },
        { type: 'Buffer' },
        { data: [1, 2, 3] },
      ]) {
        expect(decodeStoredNodes(map)).toBe(map)
      }
    })

    it('returns null rather than throwing on an undecodable envelope', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        expect(
          decodeStoredNodes({ type: 'Buffer', data: [0xc1, 0xc1, 0xc1] }),
        ).toBeNull()
        expect(spy).toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })
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

/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
 *
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
 * Publish-time binding-token normalization must run on the COMPRESSED
 * storage form (AGL-1397), and must not migrate the document's storage form
 * while it is at it.
 *
 * AGL-188/AGL-193: publishing rewrites legacy `{{Name}}` tokens in the
 * version being published to their rename-safe `{{var:id}}` form, so
 * actively-maintained content converges without anyone running the migration
 * script. Read straight off the snapshot, a besigner-saved version's `nodes`
 * is a Firestore `Bytes`; the deep rewrite finds no `{{` inside it, reports
 * `changed: false`, and the normalization has silently never run for the
 * majority of screens and layouts since the day the besigner started
 * compressing.
 *
 * Note the CLIENT type. The server siblings of this bug (AGL-1223, AGL-1391)
 * saw a Node `Buffer`, which is an `ArrayBuffer` view; `Bytes` is neither a
 * view nor a plain map, so a decode helper written for the server form passes
 * it through untouched and the fix would look applied while changing nothing.
 */

import { Bytes } from 'firebase/firestore'
import { compress, decompress } from '@aglyn/aglyn'
import rewriteStoredBindingTokens from '../utils/rewrite-stored-binding-tokens'

/** A legacy-token page, exactly as the besigner would have authored it. */
const NODES = {
  '_@_': { componentId: 'container', nodes: ['n1', 'n2'] },
  n1: {
    componentId: 'text',
    props: { children: 'Welcome back, {{customerName}}' },
  },
  n2: {
    componentId: 'text',
    props: { children: 'Nothing to rewrite here' },
  },
}
const VARIABLES = {
  customerName: { name: 'customerName', $id: 'aB3xK9m2Qw' },
  aB3xK9m2Qw: { name: 'customerName', $id: 'aB3xK9m2Qw' },
}
const NORMALIZED = 'Welcome back, {{var:aB3xK9m2Qw}}'

describe('publish-time token normalization over stored nodes', () => {
  it('rewrites the legacy token when nodes are a plain map', () => {
    // The control: the storage form that always worked. Its job is to prove
    // the seed carries a token the rewrite really does recognise, so the
    // compressed case below fails for the reason claimed.
    const result = rewriteStoredBindingTokens(NODES, VARIABLES, {})

    expect(result?.changed).toBe(true)
    expect((result?.value as any).n1.props.children).toBe(NORMALIZED)
  })

  it('rewrites the legacy token when nodes are a Firestore Bytes', () => {
    const stored = Bytes.fromUint8Array(compress(NODES))

    const result = rewriteStoredBindingTokens(stored, VARIABLES, {})

    expect(result?.changed).toBe(true)
    expect(
      (decompress<any>(result!.value as Bytes)).n1.props.children,
    ).toBe(NORMALIZED)
  })

  /**
   * The write-shape half. `updateDoc` bypasses the converter, so writing the
   * decoded map back would silently convert a compressed document to the
   * plain form — a migration nobody asked for, on the publish path.
   */
  it('writes the compressed form back compressed', () => {
    const stored = Bytes.fromUint8Array(compress(NODES))

    const result = rewriteStoredBindingTokens(stored, VARIABLES, {})

    expect(result?.value).toBeInstanceOf(Bytes)
  })

  it('leaves a plain map plain', () => {
    const result = rewriteStoredBindingTokens(NODES, VARIABLES, {})

    expect(result?.value).not.toBeInstanceOf(Bytes)
  })

  it('reports no change, and writes nothing, when every token is already an id', () => {
    const alreadyNormalized = {
      n1: { componentId: 'text', props: { children: NORMALIZED } },
    }
    const stored = Bytes.fromUint8Array(compress(alreadyNormalized))

    const result = rewriteStoredBindingTokens(stored, VARIABLES, {})

    expect(result?.changed).toBe(false)
    // The untouched original, not a re-encoding of it: an unchanged publish
    // must not rewrite the document at all.
    expect(result?.value).toBe(stored)
  })

  it('skips a version with no nodes at all', () => {
    expect(rewriteStoredBindingTokens(undefined, VARIABLES, {})).toBeNull()
    expect(rewriteStoredBindingTokens(null, VARIABLES, {})).toBeNull()
  })

  it('skips undecodable nodes rather than writing a rewrite of nothing', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(
        rewriteStoredBindingTokens(
          Bytes.fromUint8Array(new Uint8Array([0xc1, 0xc1, 0xc1])),
          VARIABLES,
          {},
        ),
      ).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})

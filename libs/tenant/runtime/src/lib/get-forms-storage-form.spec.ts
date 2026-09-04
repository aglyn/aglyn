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
 * THE FORMS READ READS BOTH STORED FORMS (AGL-1151).
 *
 * `get-components-storage-form.spec.ts` states the case in full for component
 * definitions; a form's published design is written by the same promotion path
 * onto the same kind of parent document, so it is msgpack for anything
 * published since compression landed and a plain map for anything older, and
 * nothing migrates them.
 *
 * The failure this pins is the quiet one. A `Buffer` reaching the graft has no
 * `rootId` key, so the placement resolves to nothing — and because that reads
 * as "this entity has no published design", every page placing the form
 * silently falls back to whatever fields it holds inline, or renders an empty
 * form where it holds none. Nothing throws, and the result is stored under the
 * render cache for the rest of its TTL.
 */

import { encode } from '@msgpack/msgpack'

const mockDocs: Array<{ id: string; data: Record<string, unknown> }> = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              limit: () => ({
                get: async () => ({
                  docs: mockDocs.map((entry) => ({
                    id: entry.id,
                    data: () => entry.data,
                  })),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 60,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  // Straight through: this spec is about what the READ produces, and a cache
  // between the two would let a stale hit answer for a broken decode.
  withRenderCache: async (options: { read: () => unknown }) => options.read(),
}))

import { getForms } from './get-forms'

const DESIGN = {
  root: { $id: 'root', componentId: 'form', nodes: ['email'] },
  email: {
    $id: 'email',
    componentId: 'formField',
    parentId: 'root',
    props: { fieldName: 'email', label: 'Work email' },
  },
}

/**
 * What firebase-admin hands back for a bytes field: a `Buffer` carved from the
 * shared allocation pool, so `byteOffset` is non-zero and the backing
 * `ArrayBuffer` is the whole pool. A zero-offset fixture would not notice a
 * decoder that ignored the offset.
 */
function pooled(value: unknown) {
  const bytes = encode(value)
  const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
  const packed = pool.subarray(64, 64 + bytes.byteLength)
  packed.set(bytes)
  return packed
}

beforeEach(() => {
  mockDocs.length = 0
})

describe('getForms over both stored forms', () => {
  it('reads a design stored as a plain map', async () => {
    mockDocs.push({ id: 'contact', data: { rootId: 'root', nodes: DESIGN } })

    const { forms } = await getForms({ hostId: 'host-1' as never })
    expect(forms['contact']).toEqual({ rootId: 'root', nodes: DESIGN })
  })

  /**
   * THE CONTROL. Reverting the decode in `readForms` turns this red and leaves
   * everything else in this repo green.
   */
  it('reads a design stored as msgpack', async () => {
    const packed = pooled(DESIGN)
    // Guard the premise, or this passes for the wrong reason.
    expect(packed.byteOffset).toBeGreaterThan(0)
    mockDocs.push({ id: 'contact', data: { rootId: 'root', nodes: packed } })

    const { forms } = await getForms({ hostId: 'host-1' as never })
    expect(forms['contact']?.nodes).toEqual(DESIGN)
  })

  /**
   * Stated as an equality rather than two expectations, because the property
   * the render path needs is that the storage form is INVISIBLE to it.
   */
  it('gives both forms the same design', async () => {
    mockDocs.push({ id: 'contact', data: { rootId: 'root', nodes: DESIGN } })
    const fromMap = await getForms({ hostId: 'host-1' as never })
    mockDocs.length = 0
    mockDocs.push({
      id: 'contact',
      data: { rootId: 'root', nodes: pooled(DESIGN) },
    })
    const fromBytes = await getForms({ hostId: 'host-1' as never })

    expect(fromBytes.forms).toEqual(fromMap.forms)
  })

  it('skips a form that has never been published', async () => {
    // No design at all, and a pointer to a root the design does not hold:
    // both mean "this entity contributes nothing", and both must leave the
    // placement rendering the fields the page itself holds.
    mockDocs.push({ id: 'never', data: { displayName: 'Never published' } })
    mockDocs.push({ id: 'rootless', data: { rootId: 'gone', nodes: DESIGN } })

    const { forms } = await getForms({ hostId: 'host-1' as never })
    expect(forms['never']).toBeUndefined()
    expect(forms['rootless']).toBeUndefined()
  })

  it('skips an undecodable design rather than admitting an empty one', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      mockDocs.push({
        id: 'contact',
        data: { rootId: 'root', nodes: Buffer.from([0xc1, 0xc1, 0xc1]) },
      })

      const { forms } = await getForms({ hostId: 'host-1' as never })
      expect(forms['contact']).toBeUndefined()
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  /**
   * Archiving is a catalog state, not a publication one. A page that still
   * places an archived form keeps rendering it — the alternative is a live
   * page quietly losing its form the moment someone tidies up a list.
   */
  it('still renders a form that has been archived', async () => {
    mockDocs.push({
      id: 'contact',
      data: { rootId: 'root', nodes: DESIGN, archivedAt: new Date() },
    })

    const { forms } = await getForms({ hostId: 'host-1' as never })
    expect(forms['contact']?.rootId).toBe('root')
  })
})

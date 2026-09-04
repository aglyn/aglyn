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
 * THE RENDER PATH READS BOTH STORED FORMS (AGL-1151).
 *
 * `getComponents` is the read every published page pays: one collection query
 * per render, which is why a component's tree lives on the PARENT document
 * rather than in its versions. That document is msgpack for anything promoted
 * since components were compressed and a plain Firestore map for everything
 * older, and nothing migrates them — so both forms are live forever.
 *
 * Why this spec exists rather than leaning on the emulator suite next door:
 * `component-publish-propagation.emulator.spec.ts` skips unless
 * FIRESTORE_EMULATOR_HOST is set, and it seeds a plain map — so it is green
 * on a normal run whatever the storage form does. This one runs every time.
 *
 * The failure it pins is silent and CACHED. `composeReusableComponentNodes`
 * looks up `nodes[rootId]`; over a `Buffer` there is no such key, so it grafts
 * an empty wrapper — every instance of the component disappears from every
 * page of the site — and the composed result is then stored under the render
 * cache for the rest of its TTL. Nothing throws and nothing is logged.
 */

import { decode, encode } from '@msgpack/msgpack'

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

import { getComponents } from './get-components'

const TREE = {
  root: {
    $id: 'root',
    componentId: 'container',
    nodes: ['copy'],
  },
  copy: {
    $id: 'copy',
    componentId: 'muiTypography',
    parentId: 'root',
    props: { children: 'The footer sentence a visitor actually reads' },
  },
}

/**
 * What firebase-admin hands back for a bytes field: a `Buffer` carved from the
 * shared allocation pool, so `byteOffset` is non-zero and the backing
 * `ArrayBuffer` is the whole pool. A decoder that ignored the offset would
 * read the pool and throw on the trailing bytes — and a zero-offset fixture
 * would not notice.
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

describe('getComponents over both stored forms', () => {
  it('reads a definition stored as a plain map', async () => {
    mockDocs.push({ id: 'cmp1', data: { rootId: 'root', nodes: TREE } })

    const { definitions } = await getComponents({ hostId: 'host-1' as never })
    expect(definitions['cmp1']?.nodes).toEqual(TREE)
    expect(definitions['cmp1']?.rootId).toBe('root')
  })

  /**
   * THE CONTROL. Reverting the decode in `readComponents` turns this red and
   * leaves everything else in this repo green.
   */
  it('reads a definition stored as msgpack', async () => {
    const packed = pooled(TREE)
    // Guard the premise, or this passes for the wrong reason.
    expect(packed.byteOffset).toBeGreaterThan(0)
    expect(packed.buffer.byteLength).toBeGreaterThan(packed.byteLength)
    mockDocs.push({ id: 'cmp1', data: { rootId: 'root', nodes: packed } })

    const { definitions } = await getComponents({ hostId: 'host-1' as never })
    expect(definitions['cmp1']?.nodes).toEqual(TREE)
  })

  /**
   * Stated as an equality rather than two separate expectations, because the
   * property the render path needs is that the storage form is INVISIBLE to
   * it — not merely that each form produces something.
   */
  it('gives both forms the same definition', async () => {
    mockDocs.push({ id: 'cmp1', data: { rootId: 'root', nodes: TREE } })
    const fromMap = await getComponents({ hostId: 'host-1' as never })
    mockDocs.length = 0
    mockDocs.push({ id: 'cmp1', data: { rootId: 'root', nodes: pooled(TREE) } })
    const fromBytes = await getComponents({ hostId: 'host-1' as never })

    expect(fromBytes.definitions).toEqual(fromMap.definitions)
  })

  it('carries declared props through either form', async () => {
    const props = [{ name: 'headline', type: 'text' as const }]
    mockDocs.push({
      id: 'cmp1',
      data: { rootId: 'root', nodes: pooled(TREE), props },
    })

    const { definitions } = await getComponents({ hostId: 'host-1' as never })
    expect(definitions['cmp1']?.props).toEqual(props)
  })

  /**
   * A definition nobody can decode is SKIPPED, not grafted empty.
   *
   * The page renders the same either way — an instance with no definition and
   * an instance with an empty one both draw nothing — but `decodeStoredNodes`
   * logs the reason on the way past, and a definition that silently became
   * `{}` would leave no record of why the component vanished from the site.
   */
  it('skips an undecodable definition rather than admitting an empty one', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      mockDocs.push({
        id: 'cmp1',
        data: { rootId: 'root', nodes: Buffer.from([0xc1, 0xc1, 0xc1]) },
      })

      const { definitions } = await getComponents({ hostId: 'host-1' as never })
      expect(definitions['cmp1']).toBeUndefined()
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('still skips a deleted definition, in either form', async () => {
    mockDocs.push({
      id: 'cmp1',
      data: { rootId: 'root', nodes: pooled(TREE), deletedAt: new Date() },
    })

    const { definitions } = await getComponents({ hostId: 'host-1' as never })
    expect(definitions['cmp1']).toBeUndefined()
  })

  /**
   * The premise the whole change rests on, asserted here so the number in the
   * commit message is not the only place it lives: the encoding is materially
   * denser than the map Firestore would charge for.
   */
  it('is denser than the JSON of the same tree', () => {
    expect(encode(TREE).byteLength).toBeLessThan(JSON.stringify(TREE).length)
    expect(decode(encode(TREE))).toEqual(TREE)
  })
})

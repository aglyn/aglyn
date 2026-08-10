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
 * Site search must see dataset records through the COMPRESSED storage form
 * (AGL-1396).
 *
 * A dataset record only surfaces in search if some published screen repeats
 * over its dataset — the search links to that screen. Finding the repeater
 * means walking the screen version's `nodes`, and `nodes` is stored in two
 * live forms: a plain Firestore map, and msgpack bytes (the besigner writes
 * the compressed one, so it is the majority). Read raw from the Admin SDK the
 * compressed form is a Node `Buffer`, `Object.values` over it yields byte
 * NUMBERS, no number has `props.repeatDataset`, and the search simply returns
 * fewer results — indistinguishable from "no match".
 *
 * The version read is MEMOISED for the whole call, so the second dataset is
 * answered from the cache rather than from Firestore. A fix at the consumer
 * would still leave a Buffer in that cache; the warm read is asserted here
 * alongside the cold one for exactly that reason.
 */

const HOST_ID = 'host_zeppelin'
const NEEDLE = 'zeppelin'

// Factories, not bare `jest.mock`: the module graph under
// `@aglyn/tenant-data-admin` reaches `undici`, and an auto-mock still
// evaluates the real graph to derive its shape.
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  orgDataQueryForHost: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  __esModuleDefault: true,
  default: jest.fn(async () => new Set<string>()),
}))
// The REAL helpers, reached by file path so the stub stays light. `decodeStoredNodes`
// especially: it is the subject, and a faked one would assert nothing.
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  screenRoutePathToUrl: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/screen-route',
  ).screenRoutePathToUrl,
  hostCollectionKind: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-kind',
  ).hostCollectionKind,
  decodeStoredNodes: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/stored-nodes',
  ).decodeStoredNodes,
}))

import { firebaseAdmin, orgDataQueryForHost } from '@aglyn/tenant-data-admin'
import searchContent from '../utils/search-content'

const { compress } = jest.requireActual(
  '../../../libs/aglyn/src/lib/app-utils/compress',
)

/** A screen that repeats over `datasetId`, as the besigner would author it. */
const repeaterNodes = (datasetId: string) => ({
  '_@_': { componentId: 'container', nodes: ['n1'] },
  n1: {
    componentId: 'repeatable',
    props: { repeatDataset: datasetId },
  },
})

/**
 * What firebase-admin actually hands back for a bytes field: a Node `Buffer`
 * carved out of the shared 8 KB allocation pool, so `byteOffset` is non-zero
 * and `buffer.byteLength` is the whole pool rather than the field.
 *
 * The same helper as `libs/aglyn/src/lib/app-utils/stored-nodes.spec.ts`, and
 * for the same reason: a zero-offset buffer lets the `new Uint8Array(buf.buffer)`
 * byteOffset bug pass by luck. `Buffer.from` DOES draw on the real pool, but
 * the offset it lands at is whatever the rest of the process left behind, so
 * a dedicated slab is what makes the premise deterministic.
 */
const pooledBuffer = (value: unknown) => {
  const bytes = compress(value)
  const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
  const packed = pool.subarray(64, 64 + bytes.byteLength)
  packed.set(bytes)
  return packed
}

interface ScreenSeed {
  id: string
  path: string
  versionId: string
  nodes: unknown
}
interface DatasetSeed {
  id: string
  displayName: string
  records: Record<string, string>[]
}

const snapshot = (id: string, data: Record<string, any> | undefined) => ({
  id,
  exists: data !== undefined,
  data: () => data,
  get: (field: string) => data?.[field],
  ref: {} as any,
})

/** Counts the version reads so the memoised path can be told from the cold one. */
let versionReads: string[] = []

const seed = (screens: ScreenSeed[], datasets: DatasetSeed[]) => {
  versionReads = []
  const screenById = new Map(screens.map((screen) => [screen.id, screen]))
  const hostRef = {
    collection: (name: string) => {
      if (name === 'screens') {
        return {
          doc: (screenId: string) => ({
            get: async () => {
              const screen = screenById.get(screenId)
              return snapshot(
                screenId,
                screen && {
                  displayName: `Screen ${screenId}`,
                  versionId: screen.versionId,
                },
              )
            },
            collection: (sub: string) => {
              expect(sub).toBe('versions')
              return {
                doc: (versionId: string) => ({
                  get: async () => {
                    versionReads.push(`${screenId}/${versionId}`)
                    const screen = screenById.get(screenId)
                    return snapshot(
                      versionId,
                      screen && { nodes: screen.nodes },
                    )
                  },
                }),
              }
            },
          }),
        }
      }
      // No content collections in this suite — entries are AGL-88's branch,
      // not this one.
      return { limit: () => ({ get: async () => ({ docs: [] }) }) }
    },
  }
  ;(firebaseAdmin.app as jest.Mock).mockReturnValue({
    firestore: () => ({
      collection: (name: string) => {
        expect(name).toBe('hosts')
        return { doc: () => hostRef }
      },
    }),
  })
  ;(orgDataQueryForHost as jest.Mock).mockResolvedValue({
    query: {
      limit: () => ({
        get: async () => ({
          docs: datasets.map((dataset) => ({
            id: dataset.id,
            get: (field: string) =>
              field === 'displayName' ? dataset.displayName : undefined,
            ref: {
              collection: () => ({
                limit: () => ({
                  get: async () => ({
                    docs: dataset.records.map((values) => ({
                      get: (field: string) =>
                        field === 'values' ? values : undefined,
                    })),
                  }),
                }),
              }),
            },
          })),
        }),
      }),
    },
  })
  return {
    host: {
      $id: HOST_ID,
      screens: Object.fromEntries(
        screens.map((screen) => [screen.id, screen.path]),
      ),
    } as any,
  }
}

const DATASETS: DatasetSeed[] = [
  {
    id: 'ds_airships',
    displayName: 'Airships',
    records: [{ name: 'Graf Zeppelin', note: 'rigid' }],
  },
  {
    id: 'ds_crew',
    displayName: 'Crew',
    records: [{ name: 'Hugo Eckener', ship: 'Zeppelin LZ 127' }],
  },
]

describe('searchContent dataset records', () => {
  afterEach(() => jest.clearAllMocks())

  it('surfaces a record when the repeating screen stores nodes PLAINLY', async () => {
    // The control: the same site, same query, the other storage form. Its
    // only job is to prove the seed and the predicate are sound, so that the
    // compressed case below fails for the reason claimed.
    const { host } = seed(
      [
        {
          id: 's_airships',
          path: 'airships',
          versionId: 'v1',
          nodes: repeaterNodes('ds_airships'),
        },
      ],
      [DATASETS[0]],
    )

    const results = await searchContent({ host, query: NEEDLE })

    expect(results).toEqual([
      expect.objectContaining({
        kind: 'data',
        title: 'Graf Zeppelin',
        url: '/airships',
      }),
    ])
  })

  it('surfaces the record when the nodes are a pooled compressed Buffer', async () => {
    const packed = pooledBuffer(repeaterNodes('ds_airships'))
    // Guard the premise: a zero-offset buffer would decode even with the
    // byteOffset bug, which is the bug most likely to come back.
    expect(packed.byteOffset).toBeGreaterThan(0)
    expect(packed.buffer.byteLength).toBeGreaterThan(packed.byteLength)

    const { host } = seed(
      [
        {
          id: 's_airships',
          path: 'airships',
          versionId: 'v1',
          nodes: packed,
        },
      ],
      [DATASETS[0]],
    )

    const results = await searchContent({ host, query: NEEDLE })

    expect(results).toEqual([
      expect.objectContaining({
        kind: 'data',
        title: 'Graf Zeppelin',
        url: '/airships',
      }),
    ])
  })

  /**
   * The version read is memoised for the whole call, so the SECOND dataset
   * never touches Firestore — it walks whatever the first one left in the
   * cache. A fix applied at the consumer instead of at the cache write would
   * decode the cold read and keep serving the Buffer to every later dataset.
   */
  it('serves the second dataset from the memoised read, still decoded', async () => {
    const { host } = seed(
      [
        {
          id: 's_airships',
          path: 'airships',
          versionId: 'v1',
          nodes: pooledBuffer(repeaterNodes('ds_airships')),
        },
        {
          id: 's_crew',
          path: 'crew',
          versionId: 'v7',
          nodes: pooledBuffer(repeaterNodes('ds_crew')),
        },
      ],
      DATASETS,
    )

    const results = await searchContent({ host, query: NEEDLE })

    // Both datasets matched, each linking to ITS OWN repeating screen.
    expect(results.map((result) => result.url).sort()).toEqual([
      '/airships',
      '/crew',
    ])
    // One read per screen for two datasets — the second dataset was answered
    // warm, which is the read this test exists to cover.
    expect(versionReads).toEqual(['s_airships/v1', 's_crew/v7'])
  })
})

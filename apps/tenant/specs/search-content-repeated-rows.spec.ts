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
 * Site search finds the rows a published page repeats over (AGL-168), through
 * the platform's repeat-rows contract, and links each to that page.
 *
 * Search names no store: it walks the published screens for the keys their
 * repeats name (`props.repeatDataset`) and asks the one reader the page
 * itself renders through. So the reader is the double here, and what is
 * asserted is the walk around it — which keys reach it, which screen a row
 * links to, and what happens when it is missing.
 *
 * The walk must see repeats through the COMPRESSED storage form (AGL-1396).
 * `nodes` is stored in two live forms — a plain Firestore map, and msgpack
 * bytes (the besigner writes the compressed one, so it is the majority).
 * Bytes left undecoded yield byte NUMBERS to `Object.values`, no number has
 * `props.repeatDataset`, and the search simply returns fewer results —
 * indistinguishable from "no match".
 */

const HOST_ID = 'host_zeppelin'
const NEEDLE = 'zeppelin'

// Factories, not bare `jest.mock`: the module graph under
// `@aglyn/tenant-data-admin` reaches `undici`, and an auto-mock still
// evaluates the real graph to derive its shape.
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
}))
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  // Faithful to the real helper outside a Next server context, which is
  // where jest runs it: the read is performed directly.
  withRenderCache: async (options: { read: () => Promise<unknown> }) =>
    options.read(),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  __esModuleDefault: true,
  default: jest.fn(async () => new Set<string>()),
  // Faithful to the real module's OTHER export (AGL-1998): a double that
  // omits it makes `loadNotFoundScreen`/`page.tsx` throw on an undefined
  // function, and the surrounding try/catch turns that into a silent null.
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
  })),
}))
// The render's cached version read. The double hands back whatever the seed
// stored — bytes included — and counts the reads.
jest.mock('@aglyn/tenant-runtime/get-screen-version', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/aglyn/plugin-manager/repeat-rows', () => ({
  __esModule: true,
  readRepeatRows: jest.fn(),
}))
// The REAL helpers, reached by file path so the stub stays light.
// `decodeStoredNodes` and `repeatKeys` especially: they are the walk under
// test, and faked ones would assert nothing.
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entry-date',
  ),
  screenRoutePathToUrl: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/screen-route',
  ).screenRoutePathToUrl,
  hostCollectionKind: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-kind',
  ).hostCollectionKind,
  decodeStoredNodes: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/stored-nodes',
  ).decodeStoredNodes,
  repeatKeys: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/expand-repeatables',
  ).repeatKeys,
  // The entry branch reaches for both of these (AGL-1525). This suite seeds
  // no content collections, so it never calls them — but an unfaithful
  // double is how a suite starts passing for the wrong reason, and
  // `{...undefined}` is a Fuse that matches EVERYTHING rather than a crash.
  COLLECTION_SEARCH_FUSE_OPTIONS: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entries',
  ).COLLECTION_SEARCH_FUSE_OPTIONS,
  formatCollectionEntryDate: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entries',
  ).formatCollectionEntryDate,
}))

import { readRepeatRows } from '@aglyn/aglyn/plugin-manager/repeat-rows'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import getScreenVersion from '@aglyn/tenant-runtime/get-screen-version'
import searchContent from '../utils/search-content'

const { compress } = jest.requireActual(
  '../../../libs/aglyn/src/lib/app-utils/compress',
)

/** A screen whose one element repeats over `key`, as the besigner authors it. */
const repeaterNodes = (key: string) => ({
  '_@_': { componentId: 'container', nodes: ['n1'] },
  n1: {
    componentId: 'repeatable',
    props: { repeatDataset: key },
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

const snapshot = (id: string, data: Record<string, any> | undefined) => ({
  id,
  exists: data !== undefined,
  data: () => data,
  get: (field: string) => data?.[field],
})

/** The version reads the walk spent, in the order it asked. */
let versionReads: string[] = []

const seed = (
  screens: ScreenSeed[],
  rows: Record<string, Array<Record<string, unknown>>>,
) => {
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
  ;(getScreenVersion as jest.Mock).mockImplementation(
    async (options: { screenId: string; versionId: string }) => {
      versionReads.push(`${options.screenId}/${options.versionId}`)
      const screen = screenById.get(options.screenId)
      return {
        version:
          screen && screen.versionId === options.versionId
            ? { nodes: screen.nodes }
            : undefined,
        error: null,
      }
    },
  )
  // Answers under every key it was asked for that the seed holds, exactly as
  // the contract describes: a key with nothing to render is absent.
  ;(readRepeatRows as jest.Mock).mockImplementation(
    async (request: { keys: string[] }) =>
      Object.fromEntries(
        request.keys
          .filter((key) => rows[key])
          .map((key) => [key, { records: rows[key] }]),
      ),
  )
  return {
    host: {
      $id: HOST_ID,
      screens: Object.fromEntries(
        screens.map((screen) => [screen.id, screen.path]),
      ),
    } as any,
  }
}

const AIRSHIPS = [
  { $id: 'r_graf', name: 'Graf Zeppelin', note: 'rigid' },
  { $id: 'r_blimp', name: 'Goodyear', note: 'non-rigid' },
]
const CREW = [{ $id: 'r_hugo', name: 'Hugo Eckener', ship: 'Zeppelin LZ 127' }]

describe('searchContent repeated rows', () => {
  afterEach(() => jest.clearAllMocks())

  it('finds a row when the repeating screen stores nodes PLAINLY', async () => {
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
      { ds_airships: AIRSHIPS },
    )

    const results = await searchContent({ host, query: NEEDLE })

    expect(results).toEqual([
      {
        kind: 'data',
        title: 'Graf Zeppelin',
        url: '/airships',
        snippet: 'Graf Zeppelin · rigid',
      },
    ])
    expect(readRepeatRows).toHaveBeenCalledWith({
      hostId: HOST_ID,
      keys: ['ds_airships'],
    })
  })

  it('finds the row when the nodes are a pooled compressed Buffer', async () => {
    const packed = pooledBuffer(repeaterNodes('ds_airships'))
    // Guard the premise: a zero-offset buffer would decode even with the
    // byteOffset bug, which is the bug most likely to come back.
    expect(packed.byteOffset).toBeGreaterThan(0)
    expect(packed.buffer.byteLength).toBeGreaterThan(packed.byteLength)

    const { host } = seed(
      [{ id: 's_airships', path: 'airships', versionId: 'v1', nodes: packed }],
      { ds_airships: AIRSHIPS },
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

  it('asks the reader once, for every key the screens repeat over', async () => {
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
          nodes: repeaterNodes('Crew'),
        },
      ],
      { ds_airships: AIRSHIPS, Crew: CREW },
    )

    const results = await searchContent({ host, query: NEEDLE })

    // Each row links to ITS OWN repeating screen.
    expect(results.map((result) => [result.title, result.url])).toEqual([
      ['Graf Zeppelin', '/airships'],
      ['Zeppelin LZ 127', '/crew'],
    ])
    expect(readRepeatRows).toHaveBeenCalledTimes(1)
    expect(
      [...(readRepeatRows as jest.Mock).mock.calls[0][0].keys].sort(),
    ).toEqual(['Crew', 'ds_airships'])
    expect(versionReads).toEqual(['s_airships/v1', 's_crew/v7'])
  })

  it('makes one result of a row two keys reach, linked to the first screen', async () => {
    // One set, named by its id on one page and by its name on another: the
    // reader answers it under both keys.
    const { host } = seed(
      [
        {
          id: 's_fleet',
          path: 'fleet',
          versionId: 'v1',
          nodes: repeaterNodes('Airships'),
        },
        {
          id: 's_airships',
          path: 'airships',
          versionId: 'v2',
          nodes: repeaterNodes('ds_airships'),
        },
      ],
      { ds_airships: AIRSHIPS, Airships: AIRSHIPS },
    )

    const results = await searchContent({ host, query: NEEDLE })

    expect(results.map((result) => result.url)).toEqual(['/fleet'])
  })

  it('takes at most five rows from one repeat', async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      $id: `r_${index}`,
      name: `Zeppelin ${index}`,
    }))
    const { host } = seed(
      [
        {
          id: 's_airships',
          path: 'airships',
          versionId: 'v1',
          nodes: repeaterNodes('ds_airships'),
        },
      ],
      { ds_airships: many },
    )

    const results = await searchContent({ host, query: NEEDLE })

    expect(results.map((result) => result.title)).toEqual([
      'Zeppelin 0',
      'Zeppelin 1',
      'Zeppelin 2',
      'Zeppelin 3',
      'Zeppelin 4',
    ])
  })

  it('asks the reader nothing when the site repeats over nothing', async () => {
    // The floor: a site with no repeat pays for the bounded screen walk and
    // nothing else, whatever its plugins keep.
    const { host } = seed(
      [{ id: 's_plain', path: 'plain', versionId: 'v1', nodes: {} }],
      { ds_airships: AIRSHIPS },
    )

    const results = await searchContent({ host, query: NEEDLE })

    expect(readRepeatRows).not.toHaveBeenCalled()
    expect(results.filter((result) => result.kind === 'data')).toEqual([])
  })

  it('still answers pages when the rows cannot be read', async () => {
    // A declared reader missing from the process makes a page refuse to
    // render. Search is not where that is loud: the page match still answers.
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { host } = seed(
      [
        {
          id: 's_zeppelin',
          path: 'zeppelin',
          versionId: 'v1',
          nodes: repeaterNodes('ds_airships'),
        },
      ],
      { ds_airships: AIRSHIPS },
    )
    ;(readRepeatRows as jest.Mock).mockRejectedValue(new Error('no reader'))

    const results = await searchContent({ host, query: NEEDLE })

    expect(results).toEqual([
      expect.objectContaining({ kind: 'page', url: '/zeppelin' }),
    ])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

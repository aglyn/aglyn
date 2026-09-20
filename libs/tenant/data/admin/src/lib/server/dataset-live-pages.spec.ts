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
 * A RECORD WRITE REFRESHES THE PAGES THAT SHOW IT, AND NOTHING ELSE.
 *
 * Split the way the two halves fail:
 *
 * - WHICH pages is a wrong-answer failure, so the walk is tested as data. The
 *   interesting cases are the indirect ones — a repeat in a layout's chrome, a
 *   repeat inside a reusable component — because those are the pages the
 *   change was most visibly supposed to reach, and because a component
 *   allowlist would have found none of them since repeat became a capability
 *   any element carries (AGL-3111).
 * - THAT a refusal is survivable is a silent failure: a drop that throws, or
 *   one that fails and is reported as success, both render perfectly. So the
 *   announce is driven against a dropper that refuses and one that throws, and
 *   neither is allowed to reach the caller.
 */

import {
  announceDatasetRecordChange,
  datasetLivePageScope,
  describeDatasetAnnounceShortfall,
  registerLivePageDropper,
  resetDatasetAnnounceThrottle,
  screenIdsRepeatingDataset,
  type DatasetLivePageTarget,
} from './dataset-live-pages'
import type { UsageCandidate, UsageSources } from './live-page-usage'

const DATASET_ID = 'ds_team'
const DATASET_NAME = 'Team'
const ORG_ID = 'org_1'
const HOST_ID = 'host_1'

/** A node map with one node repeating over `key`. */
const repeating = (key: string) => ({
  root: { $id: 'root', componentId: 'div', nodes: ['row'] },
  row: {
    $id: 'row',
    // Deliberately NOT a Stack. Any element repeats since AGL-3111, and a
    // heading bound to a dataset renders rows exactly as a list does.
    componentId: 'typography',
    parentId: 'root',
    props: { repeatDataset: key, children: '{{item.name}}' },
    nodes: [],
  },
})

/** A node map placing an instance of the reusable component `refId`. */
const instancing = (refId: string) => ({
  root: { $id: 'root', componentId: 'div', nodes: ['i'] },
  i: {
    $id: 'i',
    componentId: 'reusableInstance',
    parentId: 'root',
    props: { refId },
    nodes: [],
  },
})

const sources = (partial: Partial<UsageSources>): UsageSources => ({
  screens: [],
  layouts: [],
  components: [],
  ...partial,
})

const keys = new Set([DATASET_ID, DATASET_NAME])

describe('screenIdsRepeatingDataset', () => {
  it('finds a screen whose own nodes repeat over the dataset id', () => {
    const screen: UsageCandidate = { id: 's1', nodes: repeating(DATASET_ID) }
    expect(screenIdsRepeatingDataset(keys, sources({ screens: [screen] }))).toEqual(
      ['s1'],
    )
  })

  it('finds a binding written by DISPLAY NAME, not only by id', () => {
    // Editors type the friendly name into the Repeat attribute, and
    // `getDatasets` resolves an id first and then a display name. Matching
    // only the id would leave every by-name binding unrefreshed.
    const screen: UsageCandidate = { id: 's1', nodes: repeating(DATASET_NAME) }
    expect(screenIdsRepeatingDataset(keys, sources({ screens: [screen] }))).toEqual(
      ['s1'],
    )
  })

  it('ignores a screen bound to a DIFFERENT dataset', () => {
    const screen: UsageCandidate = { id: 's1', nodes: repeating('ds_other') }
    expect(screenIdsRepeatingDataset(keys, sources({ screens: [screen] }))).toEqual(
      [],
    )
  })

  it('ignores a screen that repeats over nothing', () => {
    const screen: UsageCandidate = {
      id: 's1',
      nodes: { root: { $id: 'root', componentId: 'div', props: {} } },
    }
    expect(screenIdsRepeatingDataset(keys, sources({ screens: [screen] }))).toEqual(
      [],
    )
  })

  it('reaches every screen under a LAYOUT whose chrome repeats', () => {
    // The composer reads repeat keys after the layout chain, so a repeat in
    // page chrome renders on every screen beneath it — including one nested
    // under a child layout.
    const result = screenIdsRepeatingDataset(
      keys,
      sources({
        screens: [
          { id: 's1', layoutId: 'l1' },
          { id: 's2', layoutId: 'l2' },
          { id: 's3', layoutId: 'l_other' },
        ],
        layouts: [
          { id: 'l1', nodes: repeating(DATASET_ID) },
          { id: 'l2', layoutId: 'l1' },
          { id: 'l_other' },
        ],
      }),
    )
    expect(result.sort()).toEqual(['s1', 's2'])
  })

  it('reaches every screen placing a COMPONENT that repeats, however nested', () => {
    const result = screenIdsRepeatingDataset(
      keys,
      sources({
        screens: [
          { id: 's1', nodes: instancing('c_inner') },
          { id: 's2', nodes: instancing('c_outer') },
          { id: 's3', nodes: instancing('c_unrelated') },
        ],
        components: [
          { id: 'c_inner', nodes: repeating(DATASET_ID) },
          { id: 'c_outer', nodes: instancing('c_inner') },
          { id: 'c_unrelated', nodes: repeating('ds_other') },
        ],
      }),
    )
    expect(result.sort()).toEqual(['s1', 's2'])
  })

  it('ignores a soft-deleted screen, which renders nothing', () => {
    const screen: UsageCandidate = {
      id: 's1',
      nodes: repeating(DATASET_ID),
      deletedAt: 1,
    }
    expect(screenIdsRepeatingDataset(keys, sources({ screens: [screen] }))).toEqual(
      [],
    )
  })

  it('answers nothing for an empty key set rather than matching everything', () => {
    const screen: UsageCandidate = { id: 's1', nodes: repeating(DATASET_ID) }
    expect(
      screenIdsRepeatingDataset(new Set(), sources({ screens: [screen] })),
    ).toEqual([])
  })
})

// ── The Firestore double ────────────────────────────────────────────────────

interface FakeDoc {
  id: string
  data: Record<string, unknown>
  /** Screens and layouts keep their tree on the published version. */
  versionNodes?: Record<string, unknown>
}

interface FakeSite {
  host: Record<string, unknown>
  screens?: FakeDoc[]
  layouts?: FakeDoc[]
  components?: FakeDoc[]
}

const snapshotOf = (doc: FakeDoc | undefined, extra: Record<string, unknown> = {}) => ({
  id: doc?.id ?? '',
  exists: Boolean(doc),
  data: () => doc?.data ?? {},
  get: (field: string) => (doc?.data ?? {})[field],
  ...extra,
})

/**
 * Just enough Firestore for the reads this module makes: the dataset
 * document, the org's hosts, each host document and its three document
 * collections with their published version bodies.
 */
function fakeFirestore(options: {
  dataset?: Record<string, unknown>
  sites: Record<string, FakeSite>
}) {
  const collectionOf = (site: FakeSite, name: string): FakeDoc[] =>
    (name === 'screens'
      ? site.screens
      : name === 'layouts'
        ? site.layouts
        : site.components) ?? []

  const hostRef = (hostId: string) => {
    const site = options.sites[hostId]
    const ref: any = {
      id: hostId,
      collection: (name: string) => ({
        limit: () => ({
          get: async () => {
            const docs = (site ? collectionOf(site, name) : []).map((doc) => ({
              id: doc.id,
              get: (field: string) =>
                field === 'nodes' ? doc.data['nodes'] : doc.data[field],
              ref: {
                collection: () => ({
                  doc: () => ({
                    get: async () => ({
                      get: () => doc.versionNodes ?? null,
                    }),
                  }),
                }),
              },
            }))
            return { size: docs.length, docs }
          },
        }),
      }),
      get: async () =>
        snapshotOf(site ? { id: hostId, data: site.host } : undefined),
    }
    return ref
  }

  return {
    collection: (name: string) => {
      if (name === 'hosts') {
        return {
          doc: (hostId: string) => hostRef(hostId),
          where: () => ({
            limit: () => ({
              get: async () => ({
                docs: Object.keys(options.sites).map((hostId) => ({
                  id: hostId,
                })),
              }),
            }),
          }),
        }
      }
      // orgs/{orgId}/datasets/{datasetId}
      return {
        doc: () => ({
          collection: () => ({
            doc: () =>
              snapshotOf(
                options.dataset
                  ? { id: DATASET_ID, data: options.dataset }
                  : undefined,
                {
                  get: async () =>
                    snapshotOf(
                      options.dataset
                        ? { id: DATASET_ID, data: options.dataset }
                        : undefined,
                    ),
                },
              ),
          }),
        }),
      }
    },
  } as never
}

const ONE_SITE = {
  dataset: { displayName: DATASET_NAME, visibleTo: ['org'] },
  sites: {
    [HOST_ID]: {
      host: {
        subdomain: 'acme',
        cname: 'acme.com',
        screens: { s1: 'team', s2: 'about' },
      },
      screens: [
        { id: 's1', data: { versionId: 'v1' }, versionNodes: repeating(DATASET_ID) },
        { id: 's2', data: { versionId: 'v1' }, versionNodes: repeating('ds_other') },
      ],
    } as FakeSite,
  },
}

describe('datasetLivePageScope', () => {
  it('names only the pages that repeat over the dataset', async () => {
    const scope = await datasetLivePageScope({
      firestore: fakeFirestore(ONE_SITE),
      orgId: ORG_ID,
      datasetId: DATASET_ID,
    })
    expect(scope.reason).toBe('ok')
    expect(scope.targets).toEqual([
      {
        hostId: HOST_ID,
        subdomain: 'acme',
        cname: 'acme.com',
        paths: ['/team'],
        truncated: false,
      },
    ])
  })

  it('answers not-rendered — a success — when no page repeats over it', async () => {
    const scope = await datasetLivePageScope({
      firestore: fakeFirestore({
        ...ONE_SITE,
        sites: {
          [HOST_ID]: {
            ...ONE_SITE.sites[HOST_ID],
            screens: [
              {
                id: 's2',
                data: { versionId: 'v1' },
                versionNodes: repeating('ds_other'),
              },
            ],
          },
        },
      }),
      orgId: ORG_ID,
      datasetId: DATASET_ID,
    })
    expect(scope).toEqual({ targets: [], hostsDropped: 0, reason: 'not-rendered' })
  })

  it('announces to NOBODY when `visibleTo` is missing', async () => {
    // A document nobody scoped is shared with nobody. Reading it as org-wide
    // here would announce one org's dataset change to sites that cannot see
    // the dataset at all — AGL-1466 in the cache layer.
    const scope = await datasetLivePageScope({
      firestore: fakeFirestore({
        ...ONE_SITE,
        dataset: { displayName: DATASET_NAME },
      }),
      orgId: ORG_ID,
      datasetId: DATASET_ID,
    })
    expect(scope.reason).toBe('no-sites')
    expect(scope.targets).toEqual([])
  })

  it('answers no-dataset for a dataset that is not there', async () => {
    const scope = await datasetLivePageScope({
      firestore: fakeFirestore({ sites: {} }),
      orgId: ORG_ID,
      datasetId: DATASET_ID,
    })
    expect(scope.reason).toBe('no-dataset')
  })
})

describe('announceDatasetRecordChange', () => {
  beforeEach(() => {
    resetDatasetAnnounceThrottle()
  })

  const announce = (drop: (target: DatasetLivePageTarget) => Promise<boolean>) =>
    announceDatasetRecordChange({
      firestore: fakeFirestore(ONE_SITE),
      orgId: ORG_ID,
      datasetId: DATASET_ID,
      drop,
    })

  it('drops exactly the pages that repeat, once per site', async () => {
    const dropped: DatasetLivePageTarget[] = []
    const result = await announce(async (target) => {
      dropped.push(target)
      return true
    })
    expect(dropped.map((target) => target.paths)).toEqual([['/team']])
    expect(result).toMatchObject({
      sitesRefreshed: 1,
      pathsRefreshed: 1,
      sitesRefused: 0,
      reason: 'ok',
    })
  })

  it('REPORTS a refused drop and does not throw', async () => {
    const result = await announce(async () => false)
    expect(result).toMatchObject({ sitesRefreshed: 0, sitesRefused: 1 })
    expect(describeDatasetAnnounceShortfall(result)).toMatch(
      /could not be refreshed/,
    )
  })

  it('SWALLOWS a dropper that throws — a record is never lost to a cache', async () => {
    const result = await announce(async () => {
      throw new Error('tenant refused')
    })
    expect(result).toMatchObject({ sitesRefreshed: 0, sitesRefused: 1 })
  })

  it('announces NOTHING for a dataset no page repeats over', async () => {
    const drop = jest.fn(async () => true)
    const result = await announceDatasetRecordChange({
      firestore: fakeFirestore({
        ...ONE_SITE,
        sites: {
          [HOST_ID]: { ...ONE_SITE.sites[HOST_ID], screens: [] },
        },
      }),
      orgId: ORG_ID,
      datasetId: DATASET_ID,
      drop,
    })
    expect(drop).not.toHaveBeenCalled()
    expect(result.reason).toBe('not-rendered')
    // Silent: a dataset no page shows has no stale page to warn about.
    expect(describeDatasetAnnounceShortfall(result)).toBeNull()
  })

  it('coalesces a burst into one announce per site and dataset', async () => {
    const drop = jest.fn(async () => true)
    const results = []
    for (let i = 0; i < 5; i += 1) {
      results.push(await announce(drop))
    }
    expect(drop).toHaveBeenCalledTimes(1)
    expect(results.slice(1).map((result) => result.reason)).toEqual([
      'throttled',
      'throttled',
      'throttled',
      'throttled',
    ])
    // Throttled is silent too: a drop for this pair went out a moment ago.
    expect(describeDatasetAnnounceShortfall(results[1])).toBeNull()
  })

  it('warns rather than dropping silently when no runtime registered a dropper', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await announceDatasetRecordChange({
      firestore: fakeFirestore(ONE_SITE),
      orgId: ORG_ID,
      datasetId: DATASET_ID,
    })
    expect(result.reason).toBe('no-dropper')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('AGL-3113:no-live-page-dropper'),
    )
    warn.mockRestore()
  })

  it('uses the registered dropper when the caller names none', async () => {
    const drop = jest.fn(async () => true)
    const unregister = registerLivePageDropper(drop)
    const result = await announceDatasetRecordChange({
      firestore: fakeFirestore(ONE_SITE),
      orgId: ORG_ID,
      datasetId: DATASET_ID,
    })
    unregister()
    expect(drop).toHaveBeenCalledTimes(1)
    expect(result.sitesRefreshed).toBe(1)
  })
})

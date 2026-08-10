/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-1403: `/api/hosts/import` bypasses every OTHER numeric cap too.
 *
 * AGL-1398 closed the screens leg and `import-screen-cap.spec.ts` is this
 * suite's template — same modelled store, same "assert on what is STORED",
 * same refuse-the-whole-bundle-before-the-first-write rule. What is different
 * is that the screens leg had a bespoke counting rule (`billableScreenIds`)
 * and these do not: with no exclusions the post state is just
 * `|existing ids ∪ bundle ids|`, so the interesting part moves to WHICH
 * collections are gated, and to the one that is org-scoped.
 *
 * ## Datasets lead because they are the leg that leaks revenue
 *
 * Datasets are sold as an addon (`extraDatasetMonthlyUsd`), and the import
 * writes them straight to `orgs/{orgId}/datasets/…` — past `/api/orgs/datasets`,
 * which is the only other create path and the one holding `checkDatasetQuota`.
 * A 50-dataset bundle lands a Pro org at its 50-dataset HARD MAXIMUM against 15
 * included, unpaid. The other legs under-meter; this one bills nothing for
 * something we sell.
 *
 * ## Restore vs copy, for a resource that is not host-scoped
 *
 * AGL-1398 identifies a restore by document-id COLLISION rather than by the
 * bundle's self-reported `sourceHostId`, which is an unsigned string in a file
 * the metered party uploads. The collision argument transfers here, but the
 * sentence it proves changes with the scope of the meter:
 *
 * * host-scoped (workflows, functions, variables, layouts, services) — a
 *   collision means THIS SITE already holds the document, exactly as for
 *   screens;
 * * org-scoped (datasets) — a collision means THIS WORKSPACE already holds the
 *   dataset. The boundary moves from the host to the org, and that is the
 *   correct boundary, because the meter is per-org: moving a site's datasets
 *   to a sibling host of the same workspace provisions nothing (the import only
 *   re-scopes `visibleTo`), while a copy into a DIFFERENT workspace collides on
 *   nothing and provisions all of them.
 *
 * Both are asserted below, in `restores into a sibling site of the same
 * workspace` and `refuses the same backup into a different workspace`.
 */

const mockVerifyIdToken = jest.fn()
const mockServerTimestamp = Symbol('serverTimestamp')

type Doc = Record<string, unknown>

/** The owning org, swapped per test — the plan IS the variable here. */
let mockOrg: Doc

/**
 * Which workspace owns which site. `host-2` is a SIBLING of `host-1` in the
 * same workspace and `host-3` belongs to another one, which is the whole of
 * the org-scoped restore-vs-copy question.
 */
const ORG_OF_HOST: Record<string, string> = {
  'host-1': 'org-1',
  'host-2': 'org-1',
  'host-3': 'org-2',
}

/** An in-memory Firestore keyed by collection PATH (import-screen-cap.spec). */
const store = new Map<string, Map<string, Doc>>()
const writes: Array<{ path: string; data: Doc; merge: boolean }> = []

const seed = (collectionPath: string, id: string, data: Doc) => {
  if (!store.has(collectionPath)) store.set(collectionPath, new Map())
  store.get(collectionPath).set(id, data)
}

const snapshotOf = (path: string, id: string, data: Doc | undefined) => ({
  id,
  exists: data !== undefined,
  ref: docRef(path, id),
  data: () => data,
  get: (field: string) => (data ?? {})[field],
})

function collectionRef(path: string): any {
  const ref: any = {
    path,
    limit: () => ref,
    where: () => ref,
    select: () => ref,
    get: async () => ({
      docs: [...(store.get(path) ?? new Map()).entries()].map(([id, data]) =>
        snapshotOf(path, id, data),
      ),
    }),
    doc: (id: string) => docRef(path, id),
    add: async () => undefined,
  }
  return ref
}

function docRef(collectionPath: string, id: string): any {
  return {
    id,
    path: `${collectionPath}/${id}`,
    get: async () =>
      snapshotOf(
        collectionPath,
        id,
        (store.get(collectionPath) ?? new Map()).get(id),
      ),
    collection: (name: string) => collectionRef(`${collectionPath}/${id}/${name}`),
  }
}

const mockFirestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => ({
    set: (ref: any, data: Doc, options?: { merge?: boolean }) => {
      writes.push({ path: ref.path, data, merge: Boolean(options?.merge) })
    },
    commit: async () => undefined,
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockFirestore,
    }),
    firestore: { FieldValue: { serverTimestamp: () => mockServerTimestamp } },
  },
  getOrgForHost: async (hostId: string) => ({
    orgId: ORG_OF_HOST[hostId] ?? 'org-1',
    org: mockOrg,
  }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan limits and the REAL quota helpers. A suite that stubbed them
  // would pass against a route enforcing nothing, which is the failure mode
  // this issue IS — and `checkDatasetQuota` in particular has to be the real
  // one, because the addon arithmetic is the reason datasets are not a plain
  // `checkQuota` call.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/dataset-models'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/name-search'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/binding-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { POST as IMPORT_POST } from '../app/api/hosts/import/route'
import {
  EXPORT_COLLECTION_LIMITS,
  SITE_EXPORT_FORMAT,
  SITE_EXPORT_VERSION,
} from '../app/api/_lib/site-export'
import { PLAN_ENTITLEMENTS, PLAN_PRICING } from '@aglyn/aglyn/server'

const PRO = PLAN_ENTITLEMENTS.pro

const ids = (count: number, prefix: string) =>
  Array.from({ length: count }, (_unused, index) => `${prefix}-${index + 1}`)

/** A named resource document, the shape every host collection here stores. */
const named = (id: string, extra: Doc = {}): Doc & { $id: string } => ({
  $id: id,
  name: `Thing ${id}`,
  ...extra,
})

const datasetItem = (id: string, records: string[] = []) => ({
  $id: id,
  displayName: `Dataset ${id}`,
  fields: ['title'],
  records: records.map((recordId) => ({
    $id: recordId,
    values: { title: `row ${recordId}` },
  })),
})

interface HostSeed {
  workflows?: string[]
  functions?: string[]
  variables?: string[]
  services?: string[]
}

const reset = () => {
  store.clear()
  writes.length = 0
}

const seedHost = (hostId: string, held: HostSeed = {}) => {
  seed('hosts', hostId, {
    memberRoles: { 'user-1': 'admin' },
    orgId: ORG_OF_HOST[hostId],
    displayName: 'Acme',
    screens: {},
  })
  for (const [collection, held_] of Object.entries(held)) {
    for (const id of held_ ?? []) {
      seed(`hosts/${hostId}/${collection}`, id, { name: `Thing ${id}` })
    }
  }
}

const seedWorkspaceDatasets = (orgId: string, datasetIds: string[]) => {
  for (const id of datasetIds) {
    seed(`orgs/${orgId}/datasets`, id, { displayName: `Dataset ${id}` })
  }
}

const bundleOf = (parts: Doc = {}) => ({
  format: SITE_EXPORT_FORMAT,
  version: SITE_EXPORT_VERSION,
  host: { displayName: 'Acme' },
  ...parts,
})

const runImport = async (hostId: string, bundle: unknown) => {
  writes.length = 0
  const response = await IMPORT_POST(
    new Request('https://app.aglyn.com/api/hosts/import', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId, bundle }),
    }),
  )
  return { status: response.status, body: await response.json() }
}

/** Document ids the run actually stored under a collection path. */
const storedIdsIn = (collectionPath: string) =>
  writes
    .filter((entry) => entry.path.startsWith(`${collectionPath}/`))
    .map((entry) => entry.path.slice(collectionPath.length + 1))
    .filter((rest) => !rest.includes('/'))

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  mockOrg = { plan: 'pro' }
  reset()
  seedHost('host-1')
})

describe('the premise: every bundle cap is at or over the Pro plan cap', () => {
  it('is the arithmetic this issue is about', () => {
    // Guard the premise. If any of these move, the tests below stop describing
    // anything and would go green for the wrong reason.
    expect(EXPORT_COLLECTION_LIMITS.workflows).toBe(100)
    expect(PRO.workflowsPerHost).toBe(25)

    expect(EXPORT_COLLECTION_LIMITS.functions).toBe(100)
    expect(PRO.functionsPerHost).toBe(50)

    expect(EXPORT_COLLECTION_LIMITS.datasets).toBe(50)
    expect(PRO.datasetsPerOrg).toBe(15)
    // Exactly the hard max: a full bundle takes the whole addon runway too.
    expect(PRO.maxDatasetsPerOrg).toBe(50)

    // The tie — the bundle cap alone does not cross, so `variables` crosses
    // only against what the site already holds.
    expect(EXPORT_COLLECTION_LIMITS.variables).toBe(100)
    expect(PRO.variablesPerHost).toBe(100)
  })
})

describe('datasets: the leg that leaks revenue, and the org-scoped one', () => {
  it('refuses a full bundle into a Pro workspace, and writes NOTHING', async () => {
    const wanted = ids(EXPORT_COLLECTION_LIMITS.datasets, 'ds')
    const response = await runImport('host-1', bundleOf({
      datasets: wanted.map((id) => datasetItem(id)),
    }))

    expect(response.status).toBe(403)
    // Concrete arithmetic, AGL-1390/1398's shape: what the backup holds, what
    // the workspace holds, the post-state total and the cap.
    expect(response.body.error).toContain('50 datasets')
    expect(response.body.error).toContain(`50 of ${PRO.datasetsPerOrg}`)
    // Addons can still raise this limit, so the escape named is the addon —
    // "upgrade in Billing" alone would be wrong AND more expensive.
    expect(response.body.error).toContain('add extra datasets')
    expect(response.body.error).toContain(
      `$${PLAN_PRICING.pro.extraDatasetMonthlyUsd}`,
    )
    expect(writes).toEqual([])
  })

  it('restores an ordinary under-cap bundle completely, records and all', async () => {
    // The positive control. A refusal that also refused this would have closed
    // the bug by breaking the feature.
    const wanted = ids(10, 'ds')
    const response = await runImport('host-1', bundleOf({
      datasets: wanted.map((id) => datasetItem(id, ['r-1', 'r-2'])),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('orgs/org-1/datasets')).toEqual(wanted)
    expect(
      writes.filter((entry) => entry.path.endsWith('/records/r-1')),
    ).toHaveLength(10)
  })

  it('counts the addon datasets the workspace has actually bought', async () => {
    // `checkDatasetQuota` and not `checkQuota(org, 'datasetsPerOrg')`: an org
    // that has PAID for 35 extra datasets is entitled to 50, and a check
    // reading the plan's included number would refuse a customer their own
    // backup after taking their money for the room to hold it.
    mockOrg = { plan: 'pro', seatAddons: { datasets: 35 } }
    const wanted = ids(EXPORT_COLLECTION_LIMITS.datasets, 'ds')
    const response = await runImport('host-1', bundleOf({
      datasets: wanted.map((id) => datasetItem(id)),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('orgs/org-1/datasets')).toHaveLength(50)
  })

  it('names upgrading, not addons, once the addon runway is gone', async () => {
    // At the hard max the addon is not an escape and offering it would be a
    // dead end — `checkDatasetQuota` already knows this as `upgradeRequired`.
    mockOrg = { plan: 'pro', seatAddons: { datasets: 35 } }
    seedWorkspaceDatasets('org-1', ids(50, 'have'))
    const response = await runImport('host-1', bundleOf({
      datasets: [datasetItem('one-more')],
    }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('51 of 50')
    expect(response.body.error).not.toContain('add extra datasets')
    expect(response.body.error).toContain('upgrade in Billing')
    expect(writes).toEqual([])
  })

  it('restores a workspace that is already over its dataset limit', async () => {
    // AGL-1390's rule, unchanged: what is refused is the RAISE, never the
    // state of being over. An org lands over legitimately — a downgrade, a
    // cancelled addon — and a backup is the one file nobody may be locked out
    // of on the day they need it.
    const all = ids(PRO.datasetsPerOrg + 12, 'ds')
    seedWorkspaceDatasets('org-1', all)
    const response = await runImport('host-1', bundleOf({
      datasets: all.map((id) => datasetItem(id)),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('orgs/org-1/datasets')).toHaveLength(all.length)
  })

  it('restores into a sibling site of the same workspace', async () => {
    /**
     * The org-scoped half of restore-vs-copy, and the reason the analogy had to
     * be re-derived rather than assumed. Datasets do not live on the host: a
     * bundle exported from `host-1` and restored into `host-2` of the SAME
     * workspace writes the same dataset ids the workspace already holds, so it
     * replaces rather than adds and provisions nothing. All the import changes
     * is `visibleTo`, from `host:host-1` to `host:host-2`.
     *
     * A check that asked "is this the source HOST" would refuse this — and it
     * is one of the two things the feature is for.
     */
    seedHost('host-2')
    const all = ids(EXPORT_COLLECTION_LIMITS.datasets, 'ds')
    seedWorkspaceDatasets('org-1', all)

    const response = await runImport('host-2', bundleOf({
      datasets: all.map((id) => datasetItem(id)),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('orgs/org-1/datasets')).toHaveLength(all.length)
  })

  it('refuses the same backup into a different workspace', async () => {
    // The other side of the same file. Nothing is being given back here: 50
    // datasets are being provisioned into a workspace that holds none of them,
    // and the ids collide with nothing because dataset ids are org-scoped.
    seedHost('host-3')
    const all = ids(EXPORT_COLLECTION_LIMITS.datasets, 'ds')
    seedWorkspaceDatasets('org-1', all)

    const response = await runImport('host-3', bundleOf({
      datasets: all.map((id) => datasetItem(id)),
    }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain(`50 of ${PRO.datasetsPerOrg}`)
    expect(writes).toEqual([])
  })

  it('does not let a bundle vouch for its own provenance', async () => {
    // AGL-1398's principle, restated for the org-scoped resource: the bundle
    // carries `sourceHostId` and it is an unsigned string in a file the metered
    // party uploads. Claiming to have come from this very site buys nothing,
    // because the datasets are still 50 datasets the WORKSPACE does not have.
    const response = await runImport('host-1', {
      ...bundleOf({
        datasets: ids(EXPORT_COLLECTION_LIMITS.datasets, 'ds').map((id) =>
          datasetItem(id),
        ),
      }),
      sourceHostId: 'host-1',
    })

    expect(response.status).toBe(403)
    expect(writes).toEqual([])
  })

  it('judges the bundle by what will be written, not by what the file claims', async () => {
    // The route truncates at `EXPORT_COLLECTION_LIMITS.datasets`, so a longer
    // file stores 50 documents whatever it says. A check counting the raw array
    // would refuse an import that fits — the same drift the export/import media
    // limit had before AGL-1382 gave it one home, which is why the slice lives
    // in `bundleItems` and both answers read it.
    mockOrg = { plan: 'pro', seatAddons: { datasets: 35 } }
    const response = await runImport('host-1', bundleOf({
      datasets: ids(EXPORT_COLLECTION_LIMITS.datasets + 10, 'ds').map((id) =>
        datasetItem(id),
      ),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('orgs/org-1/datasets')).toHaveLength(50)
  })

  it('lets an unlimited plan restore a full bundle', async () => {
    mockOrg = { plan: 'enterprise' }
    const wanted = ids(EXPORT_COLLECTION_LIMITS.datasets, 'ds')
    const response = await runImport('host-1', bundleOf({
      datasets: wanted.map((id) => datasetItem(id)),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('orgs/org-1/datasets')).toHaveLength(50)
  })
})

describe('workflows: a bundle cap of 100 against a Pro 25', () => {
  it('refuses a full bundle, and writes NOTHING', async () => {
    const response = await runImport('host-1', bundleOf({
      workflows: ids(EXPORT_COLLECTION_LIMITS.workflows, 'wf').map((id) =>
        named(id),
      ),
    }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('100 workflows')
    expect(response.body.error).toContain(`100 of ${PRO.workflowsPerHost}`)
    expect(writes).toEqual([])
  })

  it('restores an ordinary under-cap bundle completely', async () => {
    const wanted = ids(10, 'wf')
    const response = await runImport('host-1', bundleOf({
      workflows: wanted.map((id) => named(id)),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('hosts/host-1/workflows')).toEqual(wanted)
  })

  it('restores a site into itself at and above the cap', async () => {
    // Host-scoped, so this is AGL-1398's case unchanged: the bundle keys by id
    // and REPLACES. `existing + bundle.length > limit` would refuse every
    // restore of a site anywhere near full.
    const all = ids(PRO.workflowsPerHost + 6, 'wf')
    seedHost('host-1', { workflows: all })
    const response = await runImport('host-1', bundleOf({
      workflows: all.map((id) => named(id)),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('hosts/host-1/workflows')).toHaveLength(all.length)
  })

  it('still refuses the one workflow that raises an over-cap site', async () => {
    const all = ids(PRO.workflowsPerHost + 6, 'wf')
    seedHost('host-1', { workflows: all })
    const response = await runImport('host-1', bundleOf({
      workflows: [...all, 'one-more'].map((id) => named(id)),
    }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain(`32 of ${PRO.workflowsPerHost}`)
    expect(writes).toEqual([])
  })
})

describe('functions: a bundle cap of 100 against a Pro 50', () => {
  it('refuses a full bundle, and writes NOTHING', async () => {
    const response = await runImport('host-1', bundleOf({
      functions: ids(EXPORT_COLLECTION_LIMITS.functions, 'fn').map((id) =>
        named(id),
      ),
    }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('100 functions')
    expect(response.body.error).toContain(`100 of ${PRO.functionsPerHost}`)
    expect(writes).toEqual([])
  })

  it('restores an ordinary under-cap bundle completely', async () => {
    const wanted = ids(20, 'fn')
    const response = await runImport('host-1', bundleOf({
      functions: wanted.map((id) => named(id)),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('hosts/host-1/functions')).toEqual(wanted)
  })

  it('counts what the site already holds, not just the bundle', async () => {
    // 40 held + 20 new = 60 against 50. Neither number crosses on its own,
    // which is the case a per-bundle cap cannot see at all.
    seedHost('host-1', { functions: ids(40, 'have') })
    const response = await runImport('host-1', bundleOf({
      functions: ids(20, 'fn').map((id) => named(id)),
    }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain(`60 of ${PRO.functionsPerHost}`)
    expect(writes).toEqual([])
  })
})

describe('variables: the bundle cap TIES the plan cap', () => {
  it('lets a full bundle into an empty site — exactly at the cap is allowed', async () => {
    // The boundary. `next > limit` refuses, `next === limit` does not: a plan
    // that includes 100 variables includes the hundredth.
    const wanted = ids(EXPORT_COLLECTION_LIMITS.variables, 'var')
    const response = await runImport('host-1', bundleOf({
      variables: wanted.map((id) => named(id, { type: 'text', value: 'x' })),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('hosts/host-1/variables')).toHaveLength(100)
  })

  it('refuses the same bundle onto a site that already holds variables', async () => {
    // The issue's point about this row: the caps merely tie, so it crosses
    // only against existing state — invisible to any check that reads the file
    // alone.
    seedHost('host-1', { variables: ids(5, 'have') })
    const response = await runImport('host-1', bundleOf({
      variables: ids(EXPORT_COLLECTION_LIMITS.variables, 'var').map((id) =>
        named(id, { type: 'text', value: 'x' }),
      ),
    }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain(`105 of ${PRO.variablesPerHost}`)
    expect(writes).toEqual([])
  })
})

describe('the whole bundle or none of it, and one refusal', () => {
  it('writes no SCREENS either when only the dataset cap is crossed', async () => {
    // The AGL-1398 decision, extended: the refusal is not per-collection at
    // write time. The route commits in chunks of 400 and batches the restored
    // routing map FIRST, so importing the screens and dropping the datasets
    // would leave a site whose pages bind to data that is not there.
    const response = await runImport('host-1', bundleOf({
      host: {
        displayName: 'Acme',
        screens: { 'page-1': '/page-1' },
      },
      screens: [{ $id: 'page-1', displayName: 'Page', slug: '/page-1' }],
      datasets: ids(EXPORT_COLLECTION_LIMITS.datasets, 'ds').map((id) =>
        datasetItem(id),
      ),
    }))

    expect(response.status).toBe(403)
    expect(writes).toEqual([])
  })

  it('names the dataset cap when a bundle crosses several at once', async () => {
    // One refusal, not four. The bundle that busts every cap is the common
    // case, and a restore blocked four times in a row is worse than one
    // blocked once with the arithmetic that costs the most money.
    const response = await runImport('host-1', bundleOf({
      workflows: ids(100, 'wf').map((id) => named(id)),
      functions: ids(100, 'fn').map((id) => named(id)),
      datasets: ids(50, 'ds').map((id) => datasetItem(id)),
    }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('datasets')
    expect(writes).toEqual([])
  })
})

describe('what this deliberately does NOT cap', () => {
  it('restores a bundle full of actions, collections and entries', async () => {
    // `actions` has no `RESOURCES` entry and therefore no quota key anywhere,
    // and AGL-1387 declined `collectionsPerHost` on purpose. Nothing here gets
    // to invent a cap — AGL-1383, AGL-1387 and AGL-1390 each refused to change
    // what counts, and this issue does not get to either.
    const actionIds = ids(EXPORT_COLLECTION_LIMITS.actions, 'act')
    const response = await runImport('host-1', bundleOf({
      actions: actionIds.map((id) => named(id, { steps: [], enabled: true })),
      collections: ids(20, 'col').map((id) => ({
        $id: id,
        slug: id,
        kind: 'content',
        displayName: `Collection ${id}`,
        entries: ids(10, `${id}-entry`).map((entryId) => ({
          $id: entryId,
          title: entryId,
          slug: entryId,
        })),
      })),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('hosts/host-1/actions')).toHaveLength(actionIds.length)
    expect(storedIdsIn('hosts/host-1/collections')).toHaveLength(20)
  })

  it('restores layouts and services, which Pro does not limit', async () => {
    // Both have quota keys, and both are UNLIMITED on every plan that can
    // reach this route. They are gated for the same reason the others are —
    // the table is the mapping, not a judgement about today's price list — and
    // an unlimited cap must never cost a read or refuse anything.
    const layoutIds = ids(EXPORT_COLLECTION_LIMITS.layouts, 'lay')
    const serviceIds = ids(EXPORT_COLLECTION_LIMITS.services, 'svc')
    const response = await runImport('host-1', bundleOf({
      layouts: layoutIds.map((id) => ({ $id: id, displayName: `Layout ${id}` })),
      services: serviceIds.map((id) => named(id, { durationMinutes: 30 })),
    }))

    expect(response.status).toBe(200)
    expect(storedIdsIn('hosts/host-1/layouts')).toHaveLength(layoutIds.length)
    expect(storedIdsIn('hosts/host-1/services')).toHaveLength(serviceIds.length)
  })
})

describe('the gates that were already there still answer first', () => {
  it('refuses a plan without siteExport before it counts anything', async () => {
    mockOrg = { plan: 'starter' }
    const response = await runImport('host-1', bundleOf({
      datasets: ids(50, 'ds').map((id) => datasetItem(id)),
    }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Pro plan')
    expect(writes).toEqual([])
  })
})

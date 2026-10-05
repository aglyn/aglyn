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
 *
 * @jest-environment node
 */

/**
 * A DATASET SCHEMA'S DOORS ASK THE PLUGIN THAT KEEPS DATASETS (AGL-3080).
 *
 * A dataset schema is published from a dataset and installs as a new one,
 * and datasets are the data plugin's. The three doors keep what is the
 * marketplace's (who may act, the listing and its gates, the purchase, the
 * provenance stamp, the tally) and ask the `datasetSchema` type's owner,
 * through `plugin-manager/plugin-artifact-types`, for everything else. This
 * plugin may not load the data plugin, so the owner here is a stand-in that
 * records what it was asked; what the data plugin answers is held in its own
 * spec (`dataset-schema-artifact.server.spec.ts`), and the console's boot
 * registering it in `apps/console/specs/artifact-type-owners-are-registered`.
 *
 * Contracts:
 *
 *  1. THE DOORS NEVER READ THE DATASETS COLLECTION. The Firestore double
 *     throws on it, so every case below is also that assertion.
 *  2. AN INSTALL LANDS IN THE ORG, NEVER THE ACTING SITE. The site only finds
 *     the org (AGL-2891); the owner is handed the org and never the site.
 *  3. PROVENANCE IS RECORDED OVER WHAT THE OWNER PREPARED, and the owner
 *     writes the copy with exactly that stamp.
 *  4. A MISSING OWNER REFUSES WHOLE: no copy, no provenance, no tally, no
 *     listing. Likewise any refusal the owner answers.
 *  5. AN UPDATE IS DIFFED HERE AND WRITTEN BY THE OWNER, a destructive one
 *     only once confirmed, and never forked into a second copy.
 */

let mockDeclared: unknown = undefined

jest.mock('@aglyn/aglyn/plugin-manager/first-party-plugins.generated', () => {
  const actual = jest.requireActual('@aglyn/aglyn/plugin-manager/first-party-plugins.generated')
  return {
    __esModule: true,
    ...actual,
    get PLUGIN_ARTIFACT_TYPES_DECLARED() {
      return mockDeclared === undefined ? actual.PLUGIN_ARTIFACT_TYPES_DECLARED : mockDeclared
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  checkEntitlement: () => true,
  createResourceUid: () => 'listing-new',
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  // Every role may act: the permission gates are not what this suite is about.
  resolveOrgPermissions: async (_uid: string, context: { orgId?: string }) => ({
    orgId: context.orgId ?? 'org-1',
    permissions: { installPlugins: true, publishToMarketplace: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => false,
  resolvePublisherProfile: async () => ({ orgId: 'org-1', displayName: 'Acme' }),
}))
jest.mock('./publish-preconditions', () => ({ publishPreconditionRefusal: () => null }))
jest.mock('./purchase-entitlement', () => ({ requirePurchase: async () => null }))
jest.mock('./sale-risk', () => ({ isPublisherSecurityLocked: async () => false }))
jest.mock('./listing-screen', () => ({ listingSubmissionRefusal: async () => null }))
jest.mock('./listing-query-fields', () => ({ refreshListingQueryFields: async () => undefined }))

jest.mock('./version-stats', () => ({
  recordVersionMove: jest.fn(async () => undefined),
}))

jest.mock('./provenance', () => ({
  recordInstallProvenance: jest.fn(async (input: { version: unknown }) => ({
    installedFrom: { sha256: 'sha-new', version: String(input.version) },
    baseStored: true,
  })),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = {
    store: {} as Record<string, Record<string, any>>,
    /** Every collection path a door addressed. */
    touched: [] as string[],
  }
  const read = (data: any, field: string) =>
    field.split('.').reduce((value, key) => value?.[key], data)
  const write = (path: string, data: Record<string, any>, merge: boolean) => {
    state.store[path] = { ...(merge ? (state.store[path] ?? {}) : {}), ...data }
  }
  const snapshotFor = (path: string) => {
    const data = state.store[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      ref: docRef(path),
      data: () => data,
      get: (field: string) => read(data, field),
    }
  }
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get: async () => snapshotFor(path),
    set: async (data: Record<string, any>, options?: { merge?: boolean }) =>
      write(path, data, Boolean(options?.merge)),
    update: async (data: Record<string, any>) => write(path, data, true),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string): any => {
    state.touched.push(path)
    if (path.split('/').pop() === 'datasets') {
      throw new Error(`the marketplace addressed ${path}, which the data plugin keeps`)
    }
    const build = (filters: Array<[string, unknown]>, limit?: number): any => ({
      where: (field: string, _op: string, value: unknown) =>
        build([...filters, [field, value]], limit),
      limit: (count: number) => build(filters, count),
      get: async () => {
        const docs = Object.keys(state.store)
          .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .map((key) => snapshotFor(key))
          .filter((snapshot) => filters.every(([field, value]) => snapshot.get(field) === value))
          .slice(0, limit ?? Infinity)
        return { empty: docs.length === 0, docs }
      },
    })
    return { ...build([]), path, doc: (id: string) => docRef(`${path}/${id}`) }
  }
  const firestore = { collection: (name: string) => collectionRef(name) }
  return {
    __state: state,
    getOrgForHost: async (hostId: string) =>
      ({ 'host-a': { orgId: 'org-1' }, 'host-foreign': { orgId: 'org-2' } })[hostId] ?? null,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'member-1' }) }),
        firestore: () => firestore,
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'NOW',
          increment: (by: number) => ({ increment: by }),
          arrayUnion: (...items: unknown[]) => items,
          delete: () => ({ delete: true }),
        },
        Timestamp: { now: () => 'TS' },
      },
    },
  }
})

import {
  registerArtifactTypeOwner,
  resetArtifactTypeOwnersForTests,
  type ArtifactInstallStamp,
  type PluginArtifactOwner,
} from '@aglyn/aglyn/plugin-manager/plugin-artifact-types'
import { resetPluginDeclarationsRepairForTests } from '@aglyn/aglyn/plugin-manager/plugin-declarations-repair'
import { installDatasetSchemaHandler } from './install-dataset-schema'
import { publishDatasetSchemaHandler } from './publish-dataset-schema'
import { updateArtifactHandler } from './update-artifact'

const { __state: state } = jest.requireMock('@aglyn/tenant-data-admin') as {
  __state: { store: Record<string, Record<string, any>>; touched: string[] }
}
const { recordInstallProvenance } = jest.requireMock('./provenance') as {
  recordInstallProvenance: jest.Mock
}
const { recordVersionMove } = jest.requireMock('./version-stats') as {
  recordVersionMove: jest.Mock
}

const PUBLISHED = { order: ['title', 'speaker'], fields: { title: {}, speaker: {} } }
const PREPARED = { order: ['title', 'speaker'], fields: { title: {}, speaker: { relinked: true } } }

/** The stand-in owner: what it was asked, and what it answers. */
let asked: Record<string, unknown[]>
let answers: Partial<Record<keyof PluginArtifactOwner | 'commit' | 'apply', unknown>>

const standIn: PluginArtifactOwner = {
  snapshot: async (request) => {
    asked['snapshot'].push(request)
    return (answers.snapshot as never) ?? {
      ok: true,
      content: { order: ['a', 'b', 'c'], fields: {} },
      facts: { fieldCount: 3 },
    }
  },
  admits: async (workspace) => {
    asked['admits'].push(workspace)
    return (answers.admits as never) ?? null
  },
  prepare: async (request) => {
    asked['prepare'].push(request)
    return (answers.prepare as never) ?? {
      ok: true,
      content: PREPARED,
      commit: async (stamp: ArtifactInstallStamp) => {
        asked['commit'].push(stamp)
        return (answers.commit as never) ?? {
          ok: true,
          report: { datasetId: 'ds-new', fields: 2, degradedFieldIds: ['speaker'] },
        }
      },
    }
  },
  locate: async (request) => {
    asked['locate'].push(request)
    return (answers.locate as never) ?? {
      ok: true,
      current: { order: ['title'], fields: { title: { type: 'text' } } },
      incoming: { order: ['title', 'body'], fields: { title: { type: 'text' }, body: { type: 'text' } } },
      installedVersion: '1',
      baseSha: 'sha-base',
      impact: {
        preview: { schema: { added: ['body'], removed: [], retyped: [], additiveOnly: true, recordCount: 7 } },
        destructive: false,
        refusal: 'This update removes or retypes 0 field(s) on a dataset holding 7 record(s).',
      },
      apply: async (update: unknown) => {
        asked['apply'].push(update)
      },
    }
  },
}

async function call(handler: any, body: Record<string, unknown>) {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  await handler({ method: 'POST', body, headers: { authorization: 'Bearer token' } }, res)
  return res as { statusCode: number; body: any }
}

const listingPaths = () => Object.keys(state.store).filter((key) => key.startsWith('marketplaceListings/'))

beforeEach(() => {
  mockDeclared = undefined
  asked = { snapshot: [], admits: [], prepare: [], commit: [], locate: [], apply: [] }
  answers = {}
  state.touched.length = 0
  state.store = {
    'orgs/org-1': { plan: 'pro', defaultResourceScope: 'host' },
    'orgs/org-2': { plan: 'pro' },
    'hosts/host-a': {},
    'marketplaceListings/listing-1': {
      artifactType: 'datasetSchema',
      displayName: 'Sessions',
      description: 'Talks and who gives them',
      priceUsd: 0,
      profileId: 'publisher-org',
      latestVersion: 2,
    },
    'marketplaceListings/listing-1/versions/2': { datasetSchema: PUBLISHED },
    'marketplaceArtifactBases/sha-base': { content: { order: ['title'], fields: { title: { type: 'text' } } } },
  }
  recordInstallProvenance.mockClear()
  recordVersionMove.mockClear()
  resetArtifactTypeOwnersForTests()
  resetPluginDeclarationsRepairForTests()
  registerArtifactTypeOwner('datasetSchema', standIn, { pluginId: 'data' })
})

afterEach(() => {
  // Contract 1, for every case.
  expect(state.touched.filter((path) => path.endsWith('/datasets'))).toEqual([])
})

describe('install: the owner lands the copy in the org', () => {
  it('finds the org through the site, and hands the owner the org, never the site', async () => {
    const res = await call(installDatasetSchemaHandler, { listingId: 'listing-1', hostId: 'host-a' })

    expect(res.statusCode).toBe(200)
    expect(asked['admits']).toEqual([{ orgId: 'org-1', org: state.store['orgs/org-1'] }])
    expect(asked['prepare']).toEqual([
      {
        orgId: 'org-1',
        org: state.store['orgs/org-1'],
        listing: {
          listingId: 'listing-1',
          displayName: 'Sessions',
          description: 'Talks and who gives them',
          version: 2,
        },
        published: PUBLISHED,
      },
    ])
    expect(JSON.stringify(asked['prepare'])).not.toContain('host-a')
  })

  it('lands in the org named beside a site of another org', async () => {
    const res = await call(installDatasetSchemaHandler, {
      listingId: 'listing-1',
      orgId: 'org-1',
      hostId: 'host-foreign',
    })

    expect(res.statusCode).toBe(200)
    expect((asked['prepare'][0] as { orgId: string }).orgId).toBe('org-1')
  })

  it('records provenance over what the owner prepared, and commits with that stamp', async () => {
    const res = await call(installDatasetSchemaHandler, { listingId: 'listing-1', orgId: 'org-1' })

    expect(recordInstallProvenance).toHaveBeenCalledTimes(1)
    expect(recordInstallProvenance.mock.calls[0][0]).toMatchObject({
      listingId: 'listing-1',
      version: 2,
      artifactType: 'datasetSchema',
      content: PREPARED,
    })
    expect(asked['commit']).toEqual([
      {
        installedFrom: { sha256: 'sha-new', version: '2' },
        source: { type: 'marketplace', listingId: 'listing-1', version: 2 },
      },
    ])
    expect(res.body).toEqual({
      installed: true,
      datasetId: 'ds-new',
      fields: 2,
      degradedFieldIds: ['speaker'],
      version: 2,
      baseStored: true,
    })
    expect(recordVersionMove).toHaveBeenCalledWith(
      expect.objectContaining({ artifactType: 'datasetSchema', to: 2 }),
    )
    expect(state.store['marketplaceListings/listing-1'].installCount).toEqual({ increment: 1 })
  })

  it('refuses before the listing is read when the owner does not admit the workspace', async () => {
    answers.admits = { ok: false, status: 403, error: 'Datasets require a Starter plan or higher' }
    const res = await call(installDatasetSchemaHandler, { listingId: 'listing-1', orgId: 'org-1' })

    expect(res).toMatchObject({ statusCode: 403, body: { error: 'Datasets require a Starter plan or higher' } })
    expect(asked['prepare']).toEqual([])
    expect(recordInstallProvenance).not.toHaveBeenCalled()
    expect(recordVersionMove).not.toHaveBeenCalled()
  })

  it('writes nothing when the owner refuses the version', async () => {
    answers.prepare = { ok: false, status: 403, error: 'Dataset limit reached (3) — see Billing to upgrade.' }
    const res = await call(installDatasetSchemaHandler, { listingId: 'listing-1', orgId: 'org-1' })

    expect(res).toMatchObject({ statusCode: 403, body: { error: 'Dataset limit reached (3) — see Billing to upgrade.' } })
    expect(recordInstallProvenance).not.toHaveBeenCalled()
    expect(recordVersionMove).not.toHaveBeenCalled()
    expect(state.store['marketplaceListings/listing-1'].installCount).toBeUndefined()
  })

  it('tallies nothing when the owner refuses the write itself', async () => {
    answers.commit = { ok: false, status: 403, error: 'Dataset limit reached (3) — see Billing to upgrade.' }
    const res = await call(installDatasetSchemaHandler, { listingId: 'listing-1', orgId: 'org-1' })

    expect(res.statusCode).toBe(403)
    expect(recordVersionMove).not.toHaveBeenCalled()
    expect(state.store['marketplaceListings/listing-1'].installCount).toBeUndefined()
  })
})

describe('a missing owner refuses whole', () => {
  it('answers 503 when the declared owner did not start, and writes nothing', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    resetArtifactTypeOwnersForTests()

    const install = await call(installDatasetSchemaHandler, { listingId: 'listing-1', orgId: 'org-1' })
    const publish = await call(publishDatasetSchemaHandler, {
      orgId: 'org-1',
      datasetId: 'ds-src',
      displayName: 'Sessions',
    })
    const update = await call(updateArtifactHandler, {
      listingId: 'listing-1',
      hostId: 'host-a',
      action: 'apply',
    })

    for (const res of [install, publish, update]) {
      expect(res.statusCode).toBe(503)
      expect(res.body.error).toMatch(/Dataset schemas cannot be handled right now/)
    }
    expect(recordInstallProvenance).not.toHaveBeenCalled()
    expect(recordVersionMove).not.toHaveBeenCalled()
    expect(listingPaths()).toEqual([
      'marketplaceListings/listing-1',
      'marketplaceListings/listing-1/versions/2',
    ])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('answers 501 where no plugin in the deployment keeps the type', async () => {
    mockDeclared = []
    const install = await call(installDatasetSchemaHandler, { listingId: 'listing-1', orgId: 'org-1' })
    const publish = await call(publishDatasetSchemaHandler, {
      orgId: 'org-1',
      datasetId: 'ds-src',
      displayName: 'Sessions',
    })

    for (const res of [install, publish]) {
      expect(res.statusCode).toBe(501)
      expect(res.body.error).toMatch(/Dataset schemas are not available here/)
    }
    expect(recordInstallProvenance).not.toHaveBeenCalled()
    expect(asked['admits']).toEqual([])
  })
})

describe('publish: the owner reduces its source to what travels', () => {
  it('stores the owner’s snapshot on the version and its facts on the listing', async () => {
    const res = await call(publishDatasetSchemaHandler, {
      orgId: 'org-1',
      datasetId: 'ds-src',
      displayName: 'Sessions',
    })

    expect(res).toMatchObject({ statusCode: 200, body: { listingId: 'listing-new', version: 1 } })
    expect(asked['snapshot']).toEqual([{ orgId: 'org-1', sourceId: 'ds-src' }])
    expect(state.store['marketplaceListings/listing-new']).toMatchObject({
      profileId: 'org-1',
      artifactType: 'datasetSchema',
      sourceDatasetId: 'ds-src',
      fieldCount: 3,
      latestVersion: 1,
    })
    expect(state.store['marketplaceListings/listing-new/versions/1']).toEqual({
      datasetSchema: { order: ['a', 'b', 'c'], fields: {} },
      publishedAt: 'NOW',
    })
  })

  it('never lets a fact stand in for one of the listing’s own fields', async () => {
    answers.snapshot = {
      ok: true,
      content: {},
      facts: { profileId: 'someone-else', priceUsd: 999, fieldCount: 1 },
    }
    await call(publishDatasetSchemaHandler, { orgId: 'org-1', datasetId: 'ds-src', displayName: 'Sessions' })

    expect(state.store['marketplaceListings/listing-new']).toMatchObject({
      profileId: 'org-1',
      priceUsd: 0,
      fieldCount: 1,
    })
  })

  it('lists nothing when the owner refuses the source', async () => {
    answers.snapshot = { ok: false, status: 404, error: 'Unknown dataset' }
    const res = await call(publishDatasetSchemaHandler, {
      orgId: 'org-1',
      datasetId: 'ds-gone',
      displayName: 'Sessions',
    })

    expect(res).toMatchObject({ statusCode: 404, body: { error: 'Unknown dataset' } })
    expect(state.store['marketplaceListings/listing-new']).toBeUndefined()
  })
})

describe('update: diffed here, written by the owner', () => {
  const update = (body: Record<string, unknown>) =>
    call(updateArtifactHandler, { listingId: 'listing-1', hostId: 'host-a', ...body })

  it('asks the owner for the site org’s copy, and shows its impact as it is', async () => {
    const res = await update({ action: 'preview' })

    expect(asked['locate']).toEqual([
      { orgId: 'org-1', hostId: 'host-a', listingId: 'listing-1', published: PUBLISHED },
    ])
    expect(res.statusCode).toBe(200)
    expect(res.body.preview).toMatchObject({
      artifactType: 'datasetSchema',
      installedVersion: '1',
      availableVersion: '2',
      mergeable: true,
      schema: { added: ['body'], removed: [], retyped: [], additiveOnly: true, recordCount: 7 },
    })
    expect(res.body.preview.safe.map((change: { path: string }) => change.path)).toContain('fields.body')
  })

  it('refuses an unconfirmed destructive merge with the owner’s sentence, and writes nothing', async () => {
    const located = await standIn.locate({ orgId: 'org-1', hostId: 'host-a', listingId: 'listing-1', published: PUBLISHED })
    asked['locate'].length = 0
    const preview = { schema: { added: [], removed: ['title'], retyped: [], additiveOnly: false, recordCount: 7 } }
    answers.locate = {
      ...located,
      impact: { preview, destructive: true, refusal: 'This update removes or retypes 1 field(s) on a dataset holding 7 record(s).' },
    }
    const res = await update({ action: 'apply' })

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({
      error: 'This update removes or retypes 1 field(s) on a dataset holding 7 record(s).',
      needsConfirmation: true,
      ...preview,
    })
    expect(asked['apply']).toEqual([])
    expect(recordInstallProvenance).not.toHaveBeenCalled()
  })

  it('has the owner apply the merge, stamped with the publisher’s version as the next base', async () => {
    const res = await update({ action: 'apply', confirmDestructive: true })

    expect(res).toMatchObject({ statusCode: 200, body: { updated: true, mode: 'merge', version: '2' } })
    expect(recordInstallProvenance.mock.calls[0][0]).toMatchObject({
      artifactType: 'datasetSchema',
      content: { order: ['title', 'body'], fields: { title: { type: 'text' }, body: { type: 'text' } } },
    })
    expect(asked['apply']).toEqual([
      {
        content: { order: ['title', 'body'], fields: { title: { type: 'text' }, body: { type: 'text' } } },
        stamp: {
          installedFrom: { sha256: 'sha-new', version: '2' },
          source: { type: 'marketplace', listingId: 'listing-1', version: 2 },
        },
      },
    ])
    expect(recordVersionMove).toHaveBeenCalledWith(
      expect.objectContaining({ artifactType: 'datasetSchema', from: '1', to: '2' }),
    )
  })

  it('never forks the owner’s copy: a new one installs fresh from the listing', async () => {
    const res = await update({ action: 'apply', mode: 'copy' })

    expect(res).toMatchObject({
      statusCode: 400,
      body: { error: 'Install a fresh copy of this from the listing instead' },
    })
    expect(asked['apply']).toEqual([])
    expect(recordInstallProvenance).not.toHaveBeenCalled()
  })

  it('answers the owner’s refusal as it is', async () => {
    answers.locate = { ok: false, status: 404, error: 'Not installed in this organization' }
    const res = await update({ action: 'preview' })

    expect(res).toMatchObject({ statusCode: 404, body: { error: 'Not installed in this organization' } })
  })
})

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
 * A dataset schema, as the plugin that keeps datasets answers for it
 * (AGL-657, AGL-3080).
 *
 * The marketplace publishes, installs and updates a dataset schema by asking
 * this plugin, and never reads the datasets collection itself. These cases
 * hold what the answers write and read; the doors that ask are held in the
 * marketplace's `artifact-owner-doors.spec.ts`.
 *
 * Contracts the install carried before it moved here, unchanged:
 *
 *  1. A SCHEMA INSTALLS FOR THE WHOLE ORGANIZATION, whatever the org's
 *     Default sharing says (AGL-2891). The installer resolves the org through
 *     a site and sends no site on, so an org set to "Only the site they were
 *     created in" cannot have every installed dataset hidden from every site
 *     but its first.
 *  2. A REFERENCE RELINKS ONLY TO A DATASET VISIBLE EVERYWHERE THE NEW ONE IS
 *     (AGL-1044/1046): a reference to a dataset some sites cannot see resolves
 *     to nothing on those sites.
 *  3. NOTHING IS WRITTEN BEFORE `commit`, and the copy carries exactly the
 *     stamp the installer hands it.
 *
 * The scope helpers are the REAL ones, so the stored `visibleTo` and the
 * relink choice are what this code computed rather than what a stub returned.
 */

/** Ids handed out in order when a case stages them, else the one id. */
const mockUids: string[] = []

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  createResourceUid: () => mockUids.shift() ?? 'ds-installed',
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = {
    /** `orgs/{orgId}/datasets`, by org, each row with its `$id`. */
    datasets: {} as Record<string, Array<Record<string, any>>>,
    /** Records per dataset id, for the update's count. */
    recordCounts: {} as Record<string, number>,
    /** Every create, set and read of a dataset document, in order. */
    creates: [] as Array<{ orgId: string; id: string; data: Record<string, any> }>,
    sets: [] as Array<{ orgId: string; id: string; data: Record<string, any>; options: unknown }>,
  }
  const read = (data: any, field: string) =>
    field.split('.').reduce((value, key) => value?.[key], data)
  const datasetDoc = (orgId: string, id: string) => {
    const row = () => (state.datasets[orgId] ?? []).find((entry) => entry['$id'] === id)
    const ref: any = {
      id,
      get: async () => ({
        exists: Boolean(row()),
        id,
        data: () => row(),
        get: (field: string) => read(row(), field),
      }),
      create: async (data: Record<string, any>) => {
        // Firestore's own refusal when the document already exists.
        if (row()) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
        state.creates.push({ orgId, id, data })
        ;(state.datasets[orgId] ??= []).push({ $id: id, ...data })
      },
      set: async (data: Record<string, any>, options: unknown) => {
        state.sets.push({ orgId, id, data, options })
      },
      collection: (name: string) => {
        if (name !== 'records') throw new Error(`unexpected subcollection ${name}`)
        return {
          count: () => ({
            get: async () => ({ data: () => ({ count: state.recordCounts[id] ?? 0 }) }),
          }),
        }
      },
    }
    return ref
  }
  const datasetsOf = (orgId: string) => ({
    /**
     * A marker the transaction double recognises rather than a number, so a
     * commit that counted OUTSIDE the transaction and handed the answer in
     * cannot pass for one that counted inside it.
     */
    count: () => ({ __count: () => (state.datasets[orgId] ?? []).length }),
    get: async () => {
      const rows = state.datasets[orgId] ?? []
      return {
        size: rows.length,
        docs: rows.map((row) => ({
          id: row['$id'],
          ref: datasetDoc(orgId, row['$id']),
          get: (field: string) => read(row, field),
        })),
      }
    },
    doc: (id: string) => datasetDoc(orgId, id),
  })
  /**
   * A transaction that SERIALIZES its bodies and defers their writes, which is
   * what the fix leans on: one global lock stands in for the pessimistic lock
   * an aggregate read takes, so the second body's count sees the first body's
   * create. The lock advances when a body rejects too.
   */
  let lock: Promise<unknown> = Promise.resolve()
  const runTransaction = async (body: (tx: any) => Promise<unknown>) => {
    const attempt = lock.then(async () => {
      const buffered: Array<() => Promise<unknown>> = []
      const result = await body({
        get: async (target: any) => {
          if (buffered.length) throw new Error('Firestore transactions cannot read after a write')
          if (typeof target?.__count !== 'function') throw new Error('only an aggregate is read here')
          return { data: () => ({ count: target.__count() }) }
        },
        create: (ref: any, data: Record<string, any>) => {
          buffered.push(() => ref.create(data))
        },
      })
      for (const write of buffered) await write()
      return result
    })
    lock = attempt.catch(() => undefined)
    return attempt
  }
  const firestore = {
    runTransaction,
    collection: (name: string) => {
      if (name !== 'orgs') throw new Error(`unexpected collection ${name}`)
      return {
        doc: (orgId: string) => ({
          collection: (sub: string) => {
            if (sub !== 'datasets') throw new Error(`unexpected subcollection ${sub}`)
            return datasetsOf(orgId)
          },
        }),
      }
    },
  }
  return {
    __state: state,
    firebaseAdmin: {
      app: () => ({ firestore: () => firestore }),
      firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
    },
  }
})

import type {
  ArtifactInstallStamp,
  InstalledArtifactCopy,
  PreparedArtifactInstall,
} from '@aglyn/aglyn/plugin-manager/plugin-artifact-types'
import {
  admitsDatasetSchema,
  locateInstalledDatasetSchema,
  prepareDatasetSchemaInstall,
  snapshotDatasetSchema,
} from './dataset-schema-artifact.server'

const { __state: state } = jest.requireMock('@aglyn/tenant-data-admin') as {
  __state: {
    datasets: Record<string, Array<Record<string, any>>>
    recordCounts: Record<string, number>
    creates: Array<{ orgId: string; id: string; data: Record<string, any> }>
    sets: Array<{ orgId: string; id: string; data: Record<string, any>; options: unknown }>
  }
}

const STAMP: ArtifactInstallStamp = {
  installedFrom: { sha256: 'sha' } as never,
  source: { type: 'marketplace', listingId: 'listing-1', version: 1 },
}

const PUBLISHED = {
  order: ['title', 'speaker', 'venue'],
  fields: {
    title: { name: 'Title', type: 'text' },
    speaker: { name: 'Speaker', type: 'reference', reference: { datasetLabel: 'Speakers' } },
    venue: { name: 'Venue', type: 'reference', reference: { datasetLabel: 'Venues' } },
  },
}

/** An org set to "Only the site they were created in". */
const ORG = { plan: 'pro', defaultResourceScope: 'host' }

const LISTING = {
  listingId: 'listing-1',
  displayName: 'Sessions',
  description: 'Talks and who gives them',
  version: 1,
}

async function install(published: unknown = PUBLISHED) {
  const prepared = await prepareDatasetSchemaInstall({
    orgId: 'org-1',
    org: ORG,
    listing: LISTING,
    published,
  })
  if (prepared.ok === false) throw new Error(prepared.error)
  return prepared as PreparedArtifactInstall
}

beforeEach(() => {
  mockUids.length = 0
  state.datasets = {}
  state.recordCounts = {}
  state.creates.length = 0
  state.sets.length = 0
})

describe('install: a new, empty dataset for the whole organization', () => {
  it('writes nothing until commit, then exactly the dataset with the installer’s stamp', async () => {
    const prepared = await install()
    expect(state.creates).toEqual([])

    const installed = await prepared.commit(STAMP)

    expect(installed).toEqual({
      ok: true,
      report: { datasetId: 'ds-installed', fields: 3, degradedFieldIds: ['speaker', 'venue'] },
    })
    expect(state.creates).toEqual([
      {
        orgId: 'org-1',
        id: 'ds-installed',
        data: {
          displayName: 'Sessions',
          description: 'Talks and who gives them',
          fields: ['title', 'speaker', 'venue'],
          model: prepared.content,
          source: STAMP.source,
          installedFrom: STAMP.installedFrom,
          // Red before AGL-2891 under this org's Default sharing: the acting
          // site alone.
          visibleTo: ['org'],
          createdAt: '__now__',
        },
      },
    ])
  })

  it('names an unnamed listing "Dataset", and leaves an absent description out', async () => {
    const prepared = await prepareDatasetSchemaInstall({
      orgId: 'org-1',
      org: ORG,
      listing: { listingId: 'listing-1', version: 1 },
      published: PUBLISHED,
    })
    if (prepared.ok === false) throw new Error(prepared.error)
    await prepared.commit(STAMP)

    expect(state.creates[0].data['displayName']).toBe('Dataset')
    expect('description' in state.creates[0].data).toBe(false)
  })

  it('refuses a version with no fields', async () => {
    await expect(
      prepareDatasetSchemaInstall({ orgId: 'org-1', org: ORG, listing: LISTING, published: undefined }),
    ).resolves.toEqual({ ok: false, status: 500, error: 'Dataset schema version missing' })
  })

  it('counts every dataset the org owns against its quota, visible or not', async () => {
    // The plan's included datasets, every one of them restricted to one site.
    const org = { plan: 'starter' }
    const { checkDatasetQuota } = jest.requireActual('@aglyn/aglyn/server') as {
      checkDatasetQuota: (org: unknown, count: number) => { limit: number }
    }
    const limit = checkDatasetQuota(org, 0).limit
    expect(limit).toBeGreaterThan(0)
    const restricted = (index: number) => ({
      $id: `ds-${index}`,
      displayName: `Set ${index}`,
      visibleTo: ['host:host-a'],
    })
    // THE CONTROL: one short of the limit, it installs.
    state.datasets['org-1'] = Array.from({ length: limit - 1 }, (_, index) => restricted(index))
    await expect(
      prepareDatasetSchemaInstall({ orgId: 'org-1', org, listing: LISTING, published: PUBLISHED }),
    ).resolves.toMatchObject({ ok: true })

    state.datasets['org-1'] = Array.from({ length: limit }, (_, index) => restricted(index))
    await expect(
      prepareDatasetSchemaInstall({ orgId: 'org-1', org, listing: LISTING, published: PUBLISHED }),
    ).resolves.toEqual({
      ok: false,
      status: 403,
      error: `Dataset limit reached (${limit}) — see Billing to upgrade.`,
    })
  })

  it('refuses a workspace whose plan holds no datasets, before anything is read', async () => {
    await expect(admitsDatasetSchema({ orgId: 'org-1', org: { plan: 'free' } })).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Datasets require a Starter plan or higher',
    })
    await expect(admitsDatasetSchema({ orgId: 'org-1', org: ORG })).resolves.toBeNull()
  })
})

describe('install: a reference relinks only to a dataset every site can see', () => {
  const referenceTarget = (fieldId: string) => {
    const field = (state.creates[0].data['model'] as any).fields[fieldId]
    return field.type === 'reference' ? field.reference.datasetId : null
  }

  it('relinks to an org-wide dataset and degrades one shared with one site alone', async () => {
    state.datasets['org-1'] = [
      { $id: 'ds-speakers', displayName: 'Speakers', visibleTo: ['org'] },
      { $id: 'ds-venues', displayName: 'Venues', visibleTo: ['host:host-a'] },
    ]
    const installed = await (await install()).commit(STAMP)

    expect(referenceTarget('speaker')).toBe('ds-speakers')
    expect(referenceTarget('venue')).toBeNull()
    expect(installed.ok && installed.report['degradedFieldIds']).toEqual(['venue'])
  })

  it('prefers the org-wide dataset when a restricted one shares its name', async () => {
    state.datasets['org-1'] = [
      { $id: 'ds-speakers-internal', displayName: 'Speakers', visibleTo: ['host:host-a'] },
      { $id: 'ds-speakers', displayName: 'Speakers', visibleTo: ['org'] },
    ]
    await (await install()).commit(STAMP)

    expect(referenceTarget('speaker')).toBe('ds-speakers')
  })

  it('never relinks to a dataset with no sharing stored', async () => {
    state.datasets['org-1'] = [{ $id: 'ds-speakers', displayName: 'Speakers' }]
    const installed = await (await install()).commit(STAMP)

    expect(referenceTarget('speaker')).toBeNull()
    expect(installed.ok && installed.report['degradedFieldIds']).toEqual(['speaker', 'venue'])
  })

  it('records the RELINKED schema as the content, the shape the base snapshot keeps', async () => {
    state.datasets['org-1'] = [{ $id: 'ds-speakers', displayName: 'Speakers', visibleTo: ['org'] }]
    const prepared = await install()

    expect((prepared.content as any).fields.speaker.reference.datasetId).toBe('ds-speakers')
  })
})

describe('install: the dataset cap holds under concurrency (AGL-3454)', () => {
  /**
   * The installer records provenance between `prepare` and `commit`, so N
   * installs in flight each prepare against the same pre-count. Only the
   * count `commit` takes inside its transaction can hold the cap.
   *
   * FORCED RED: committing with a plain `create` (the code before AGL-3454)
   * lands all five installs in the capped case below.
   */
  const installConcurrently = async (org: Record<string, unknown>, count: number) => {
    mockUids.push(...Array.from({ length: count }, (_, index) => `ds-new-${index}`))
    const prepared = await Promise.all(
      Array.from({ length: count }, () =>
        prepareDatasetSchemaInstall({ orgId: 'org-1', org, listing: LISTING, published: PUBLISHED }),
      ),
    )
    return Promise.all(
      prepared.map((one) => {
        if (one.ok === false) throw new Error(one.error)
        return one.commit(STAMP)
      }),
    )
  }

  it('lands exactly as many as the cap has room for, and refuses the rest', async () => {
    const org = { plan: 'starter' }
    const { checkDatasetQuota } = jest.requireActual('@aglyn/aglyn/server') as {
      checkDatasetQuota: (org: unknown, count: number) => { limit: number }
    }
    const limit = checkDatasetQuota(org, 0).limit
    expect(limit).toBeGreaterThanOrEqual(2)
    // Two places left.
    state.datasets['org-1'] = Array.from({ length: limit - 2 }, (_, index) => ({
      $id: `ds-${index}`,
      displayName: `Set ${index}`,
      visibleTo: ['org'],
    }))

    const outcomes = await installConcurrently(org, 5)

    expect(outcomes.filter((one) => one.ok)).toHaveLength(2)
    expect(outcomes.filter((one) => !one.ok)).toEqual(
      Array.from({ length: 3 }, () => ({
        ok: false,
        status: 403,
        error: `Dataset limit reached (${limit}) — see Billing to upgrade.`,
      })),
    )
    expect(state.creates).toHaveLength(2)
    expect(state.datasets['org-1']).toHaveLength(limit)
  })

  it('lands every one where the plan has room for all of them', async () => {
    const outcomes = await installConcurrently({ plan: 'pro' }, 5)

    expect(outcomes.every((one) => one.ok)).toBe(true)
    expect(state.creates.map((one) => one.id)).toEqual([
      'ds-new-0',
      'ds-new-1',
      'ds-new-2',
      'ds-new-3',
      'ds-new-4',
    ])
  })
})

describe('publish: the schema, never the records', () => {
  it('reduces the dataset to its model, labels its references, and counts its fields', async () => {
    state.datasets['org-1'] = [
      {
        $id: 'ds-sessions',
        displayName: 'Sessions',
        model: {
          order: ['title', 'speaker'],
          fields: {
            title: { name: 'Title', type: 'text' },
            speaker: { name: 'Speaker', type: 'reference', reference: { datasetId: 'ds-speakers' } },
          },
        },
      },
      { $id: 'ds-speakers', displayName: 'Speakers' },
    ]
    const snapshot = await snapshotDatasetSchema({ orgId: 'org-1', sourceId: 'ds-sessions' })

    expect(snapshot).toEqual({
      ok: true,
      content: {
        order: ['title', 'speaker'],
        fields: {
          title: { name: 'Title', type: 'text' },
          speaker: {
            name: 'Speaker',
            type: 'reference',
            reference: { datasetId: 'ds-speakers', datasetLabel: 'Speakers' },
          },
        },
      },
      facts: { fieldCount: 2 },
    })
  })

  it('publishes a v1 dataset’s flat field list as text fields', async () => {
    state.datasets['org-1'] = [{ $id: 'ds-v1', displayName: 'Old', fields: ['name', 'city'] }]
    const snapshot = await snapshotDatasetSchema({ orgId: 'org-1', sourceId: 'ds-v1' })

    expect(snapshot.ok && snapshot.content).toEqual({
      order: ['name', 'city'],
      fields: { name: { name: 'name', type: 'text' }, city: { name: 'city', type: 'text' } },
    })
  })

  it('refuses a missing or deleted dataset, and one with nothing to publish', async () => {
    state.datasets['org-1'] = [
      { $id: 'ds-deleted', displayName: 'Gone', deletedAt: 'then', fields: ['a'] },
      { $id: 'ds-empty', displayName: 'Empty', model: { fields: {}, order: [] } },
    ]
    for (const sourceId of ['ds-missing', 'ds-deleted']) {
      await expect(snapshotDatasetSchema({ orgId: 'org-1', sourceId })).resolves.toEqual({
        ok: false,
        status: 404,
        error: 'Unknown dataset',
      })
    }
    await expect(snapshotDatasetSchema({ orgId: 'org-1', sourceId: 'ds-empty' })).resolves.toEqual({
      ok: false,
      status: 422,
      error: 'Dataset has no fields to publish',
    })
  })
})

describe('update: the copy a listing installed, and what a version does to its records', () => {
  const installedRow = (model: unknown) => ({
    $id: 'ds-installed',
    displayName: 'Sessions',
    model,
    source: { type: 'marketplace', listingId: 'listing-1', version: 1 },
    installedFrom: { version: '1', sha256: 'sha-base' },
    visibleTo: ['host:host-a'],
  })

  async function locate(published: unknown, orgId: string | null = 'org-1') {
    return locateInstalledDatasetSchema({ orgId, hostId: 'host-a', listingId: 'listing-1', published })
  }

  it('refuses a site with no organization, and an org that never installed the listing', async () => {
    await expect(locate(PUBLISHED, null)).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Site has no owning organization',
    })
    state.datasets['org-1'] = [{ ...installedRow({}), deletedAt: 'then' }]
    await expect(locate(PUBLISHED)).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Not installed in this organization',
    })
  })

  it('relinks the version on offer as an install would, and reads the copy’s stamp', async () => {
    const current = { order: ['title'], fields: { title: { name: 'Title', type: 'text' } } }
    state.datasets['org-1'] = [
      installedRow(current),
      { $id: 'ds-speakers', displayName: 'Speakers', visibleTo: ['host:host-b'] },
    ]
    const located = (await locate(PUBLISHED)) as InstalledArtifactCopy

    expect(located).toMatchObject({ ok: true, current, installedVersion: '1', baseSha: 'sha-base' })
    // The update relinks by name alone, as it always has.
    expect((located.incoming as any).fields.speaker.reference.datasetId).toBe('ds-speakers')
    expect((located.incoming as any).fields.venue.type).toBe('text')
  })

  it('reads an additive version as safe, with the records it would touch', async () => {
    const current = { order: ['title'], fields: { title: { name: 'Title', type: 'text' } } }
    state.datasets['org-1'] = [installedRow(current)]
    state.recordCounts['ds-installed'] = 1240
    const located = (await locate({
      order: ['title', 'body'],
      fields: { title: { name: 'Title', type: 'text' }, body: { name: 'Body', type: 'text' } },
    })) as InstalledArtifactCopy

    expect(located.impact).toEqual({
      preview: {
        schema: { added: ['body'], removed: [], retyped: [], additiveOnly: true, recordCount: 1240 },
      },
      destructive: false,
      refusal: 'This update removes or retypes 0 field(s) on a dataset holding 1240 record(s).',
    })
  })

  it('reads a removal or a retype as destructive, and says over how many records', async () => {
    const current = {
      order: ['title', 'rating'],
      fields: { title: { name: 'Title', type: 'text' }, rating: { name: 'Rating', type: 'int32' } },
    }
    state.datasets['org-1'] = [installedRow(current)]
    state.recordCounts['ds-installed'] = 3
    const located = (await locate({
      order: ['title'],
      fields: { title: { name: 'Title', type: 'float' } },
    })) as InstalledArtifactCopy

    expect(located.impact?.destructive).toBe(true)
    expect(located.impact?.refusal).toBe(
      'This update removes or retypes 2 field(s) on a dataset holding 3 record(s).',
    )
  })

  it('reads a v1 copy with no model as its flat field list', async () => {
    state.datasets['org-1'] = [{ ...installedRow(undefined), fields: ['name'], installedFrom: undefined }]
    const located = (await locate(PUBLISHED)) as InstalledArtifactCopy

    expect(located.current).toEqual({ order: ['name'], fields: {} })
    expect(located.installedVersion).toBe('1')
    expect(located.baseSha).toBeNull()
  })

  it('applies the merged schema with the installer’s stamp, merged into the copy', async () => {
    state.datasets['org-1'] = [installedRow({ order: [], fields: {} })]
    const located = (await locate(PUBLISHED)) as InstalledArtifactCopy
    const merged = { order: ['title'], fields: { title: { name: 'Title', type: 'text' } } }

    await located.apply({ content: merged, stamp: STAMP })

    expect(state.sets).toEqual([
      {
        orgId: 'org-1',
        id: 'ds-installed',
        data: {
          model: merged,
          fields: ['title'],
          installedFrom: STAMP.installedFrom,
          source: STAMP.source,
          updatedAt: '__now__',
        },
        options: { merge: true },
      },
    ])
  })
})

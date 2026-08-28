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
 * The fourth door onto `datasets/{id}/records`, and the one that had no lock.
 *
 * `recordsPerDataset` is re-checked inside the console route's creating
 * transaction, checked below the `/v1` route's idempotency claim, and checked
 * (rows AND bytes) on the public form-submission leg. A workflow `datasetAppend`
 * step checked neither, and it is the door a visitor drives hardest: an action
 * fires per event on a published site, so the volume is not the customer's to
 * control. A cap enforced at three doors of four is not a cap.
 *
 * ## The boundary these tests draw, and it is the whole point
 *
 * What is refused is the WRITE, never the dataset. The two controls below are
 * the ones that stop an over-broad fix:
 *
 *  - an org whose capacity SHRANK keeps every record it has, and an update to
 *    a record that already exists still lands. Nothing here deletes,
 *    truncates or hides anything.
 *  - an uncapped plan pays no read to find that out.
 *
 * Between them they say the same thing the other three doors say: refuse the
 * raise, never the state of being over.
 */

const HOST_ID = 'site-1'

let mockActivity: Record<string, any>[] = []
let mockActions: { id: string; data: Record<string, any> }[] = []
let mockCounters: Record<string, any> = {}

/** Records this run appended, and how the fixture answered the count. */
let addedRecords: Record<string, any>[] = []
let mergedRecords: Record<string, any>[] = []
let recordCount = 0
/** How many times the row band actually read the collection. */
let countReads = 0
/** The org the owning-host lookup answers with, swapped per case. */
let mockOrg: Record<string, any> = { plan: 'pro' }
/** What the byte band answers; null lets the row band decide alone. */
let mockStorageRefusal: { includedMb: number; basis: string } | null = null
/** An existing record for the update-or-append step to merge into. */
let existingRecord: Record<string, any> | null = null

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    delete: () => ({ __delete: true }),
  },
}))

/**
 * The dataset's `records` subcollection. `count()` is instrumented because
 * "did this read happen" is itself an assertion — an unlimited plan that pays
 * an aggregation per append would be a cost regression wearing a fix's clothes.
 */
const recordsHandle = (): any => ({
  count: () => ({
    get: async () => {
      countReads += 1
      return { data: () => ({ count: recordCount }) }
    },
  }),
  add: async (data: Record<string, any>) => {
    addedRecords.push(data)
    return { id: `record-${addedRecords.length}` }
  },
  where: () => ({
    limit: () => ({
      get: async () =>
        existingRecord
          ? {
              empty: false,
              docs: [
                {
                  get: (field: string) => existingRecord?.[field],
                  ref: {
                    set: async (patch: Record<string, any>) => {
                      mergedRecords.push(patch)
                    },
                  },
                },
              ],
            }
          : { empty: true, docs: [] },
    }),
  }),
})

/** The dataset document every `resolveDatasetDoc` call answers with. */
const datasetDoc = {
  id: 'dataset-1',
  exists: true,
  get: (field: string) =>
    ({
      displayName: 'Leads',
      fields: ['email', 'name'],
    })[field],
  ref: { collection: () => recordsHandle() },
}

const collectionHandle = (path: string): any => ({
  doc: (id: string) => ({
    get: async () => ({
      exists: Boolean(mockCounters[`${path}/${id}`]),
      get: (field: string) => mockCounters[`${path}/${id}`]?.[field],
      data: () => mockCounters[`${path}/${id}`],
    }),
    set: async (patch: Record<string, any>) => {
      mockCounters[`${path}/${id}`] = {
        ...(mockCounters[`${path}/${id}`] ?? {}),
        ...patch,
      }
    },
    collection: (name: string) => collectionHandle(`${path}/${id}/${name}`),
  }),
  where: () => collectionHandle(path),
  limit: () => collectionHandle(path),
  get: async () => ({
    docs: path.endsWith('actions')
      ? mockActions.map((entry) => ({
          id: entry.id,
          exists: true,
          data: () => entry.data,
          get: (field: string) =>
            field
              .split('.')
              .reduce<any>((value, key) => value?.[key], entry.data),
        }))
      : [],
    empty: true,
  }),
  add: async (data: Record<string, any>) => {
    if (path.endsWith('activity')) mockActivity.push(data)
    return { id: 'new' }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => collectionHandle(name),
      }),
    }),
  },
  // The org is the ENTITLEMENT INPUT under test — a fixture that answered a
  // fixed plan here would let every assertion below pass for the wrong reason.
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
  dataStorageRefusal: async () => mockStorageRefusal,
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () => collectionHandle('orgs/org-1/datasets'),
  orgDataQueryForHost: async () => collectionHandle('orgs/org-1/contacts'),
  resolveOrgIdForHost: async () => 'org-1',
}))

// The lookup is not what is being tested; a fixture that failed to resolve the
// dataset would make every "nothing was written" assertion below pass without
// the cap ever running.
jest.mock('./resolve-dataset', () => ({
  __esModule: true,
  resolveDatasetDoc: async () => datasetDoc,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async () => ({ sent: true }),
}))

import { runEventActions } from './run-event-actions'

const appendAction = (type: 'datasetAppend' | 'updateDataset') => ({
  id: 'action-1',
  data: {
    name: 'Capture the lead',
    enabled: true,
    trigger: { event: 'formSubmission' },
    steps: [{ type, datasetName: 'Leads' }],
  },
})

beforeEach(() => {
  mockActivity = []
  mockActions = []
  mockCounters = {}
  addedRecords = []
  mergedRecords = []
  recordCount = 0
  countReads = 0
  mockOrg = { plan: 'pro' }
  mockStorageRefusal = null
  existingRecord = null
})

describe('the fixture reaches the code under test', () => {
  it('appends a record when the dataset is under its band', async () => {
    // The control that makes every refusal below mean something. Without it a
    // broken mock would report "nothing written" for every case and the whole
    // file would pass while enforcing nothing.
    mockActions = [appendAction('datasetAppend')]
    recordCount = 5

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(addedRecords).toHaveLength(1)
    expect(addedRecords[0].values).toEqual({ email: 'a@b.co' })
    expect(mockActivity[0].result).toBe('succeeded')
  })
})

describe('a workflow append past the row band', () => {
  it('is REFUSED, and the run says why', async () => {
    // Pro includes 10,000 records per dataset. The step used to write the
    // 10,001st and every one after it, forever, with no check of any kind.
    mockOrg = { plan: 'pro' }
    recordCount = 10_000
    mockActions = [appendAction('datasetAppend')]

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(addedRecords).toEqual([])
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('dataset is full')
  })

  it('refuses the APPEND leg of update-or-append too', async () => {
    // `updateDataset` appends when nothing matches, which is a new row by
    // another name — gating one leg and not the other would leave the door
    // open to any action willing to rename its step.
    mockOrg = { plan: 'pro' }
    recordCount = 10_000
    existingRecord = null
    mockActions = [appendAction('updateDataset')]

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(addedRecords).toEqual([])
    expect(mockActivity[0].result).toBe('failed')
  })

  it('reads the band from the ORG, not from the plan name', async () => {
    // A per-org override is how a shrunken capacity actually arrives, and it
    // is the input `resolveOrgEntitlements` exists to apply. A gate that read
    // `PLAN_ENTITLEMENTS[plan]` alone would let this write.
    mockOrg = { plan: 'pro', entitlements: { recordsPerDataset: 2 } }
    recordCount = 2
    mockActions = [appendAction('datasetAppend')]

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(addedRecords).toEqual([])
  })

  it('is refused by the BYTE band even when the rows fit', async () => {
    // Rows and bytes are two different bands and a dataset can be over either.
    mockOrg = { plan: 'pro' }
    recordCount = 1
    mockStorageRefusal = { includedMb: 5120, basis: 'measured' }
    mockActions = [appendAction('datasetAppend')]

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(addedRecords).toEqual([])
    expect(mockActivity[0].action).toContain('dataset storage is full')
  })
})

describe('a customer whose capacity SHRANK keeps what they have', () => {
  it('still merges into a record that already exists', async () => {
    // THE CONTROL. An org sitting above its band is over it; that is not the
    // same as being in the act of exceeding it. The merge leg adds no row, so
    // refusing it would refuse the state of being over — which is how a fix
    // for a leak turns into data a paying customer can no longer maintain.
    mockOrg = { plan: 'pro', entitlements: { recordsPerDataset: 1 } }
    recordCount = 40
    existingRecord = { values: { email: 'a@b.co', name: 'Old' } }
    mockActions = [appendAction('updateDataset')]

    await runEventActions(HOST_ID, 'formSubmission', {
      email: 'a@b.co',
      name: 'New',
    })

    expect(mergedRecords).toHaveLength(1)
    expect(mergedRecords[0].values).toEqual({ email: 'a@b.co', name: 'New' })
    expect(addedRecords).toEqual([])
    expect(mockActivity[0].result).toBe('succeeded')
  })

  it('deletes nothing and truncates nothing on the refused path', async () => {
    // Stated as an assertion because it is the invariant, not a side effect:
    // the only write this file may prevent is the one it was asked to make.
    mockOrg = { plan: 'pro', entitlements: { recordsPerDataset: 0 } }
    recordCount = 40
    mockActions = [appendAction('datasetAppend')]

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(addedRecords).toEqual([])
    expect(mergedRecords).toEqual([])
    expect(recordCount).toBe(40)
  })
})

describe('an uncapped plan pays nothing to be uncapped', () => {
  it('never reads the record count, and writes', async () => {
    // Agency's `recordsPerDataset` is UNLIMITED. An aggregation per append on
    // the plans that buy the most volume would be a cost regression dressed
    // as an entitlement fix — the read is only worth paying where it can
    // change the answer.
    mockOrg = { plan: 'agency' }
    recordCount = 9_000_000
    mockActions = [appendAction('datasetAppend')]

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(countReads).toBe(0)
    expect(addedRecords).toHaveLength(1)
  })
})

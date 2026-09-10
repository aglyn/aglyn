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
 * A dataset step that saved nothing does not say it saved (AGL-2773).
 *
 * `datasetAppend` and `updateDataset` keep only the event fields whose keys
 * match a field of the dataset. When none match, nothing is written. The run
 * history must then say the step failed and why: a merchant whose form fields
 * are named differently from the dataset's fields otherwise reads
 * `saved to Leads` on every run while the dataset stays empty.
 *
 * Each negative case has a positive twin driven through the same fixture, so a
 * fixture that silently failed to reach the step could not make the negative
 * cases pass.
 */

const HOST_ID = 'site-1'

let mockActivity: Record<string, any>[] = []
let mockActions: { id: string; data: Record<string, any> }[] = []
/** Records the run appended. */
let addedRecords: Record<string, any>[] = []
/** Records the run merged into. */
let mergedRecords: Record<string, any>[] = []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    delete: () => ({ __delete: true }),
  },
}))

/** The dataset's `records` subcollection: empty, and under every band. */
const recordsHandle = (): any => ({
  count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
  add: async (data: Record<string, any>) => {
    addedRecords.push(data)
    return { id: `record-${addedRecords.length}` }
  },
  where: () => ({
    limit: () => ({
      get: async () => ({ empty: true, docs: [] }),
    }),
  }),
})

/** A dataset with two fields, `email` and `name`. */
const datasetDoc = {
  id: 'dataset-1',
  exists: true,
  get: (field: string) =>
    ({
      displayName: 'Leads',
      fields: ['email', 'name'],
    })[field],
  ref: {
    collection: () => recordsHandle(),
    set: async (patch: Record<string, any>) => {
      mergedRecords.push(patch)
    },
  },
}

const collectionHandle = (path: string): any => ({
  doc: (id: string) => ({
    get: async () => ({
      exists: false,
      get: () => undefined,
      data: () => undefined,
    }),
    set: async () => undefined,
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
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
  dataStorageRefusal: async () => null,
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () => collectionHandle('orgs/org-1/datasets'),
  orgDataQueryForHost: async () => collectionHandle('orgs/org-1/contacts'),
  resolveOrgIdForHost: async () => 'org-1',
}))

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

const datasetAction = (type: 'datasetAppend' | 'updateDataset') => ({
  id: 'action-1',
  data: {
    name: 'Capture the lead',
    enabled: true,
    trigger: { event: 'formSubmission' },
    steps: [{ type, datasetId: 'dataset-1' }],
  },
})

beforeEach(() => {
  mockActivity = []
  mockActions = []
  addedRecords = []
  mergedRecords = []
})

describe.each(['datasetAppend', 'updateDataset'] as const)('%s', (type) => {
  it('writes a record, and says so, when an event field matches', async () => {
    mockActions = [datasetAction(type)]

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(addedRecords).toHaveLength(1)
    expect(addedRecords[0].values).toEqual({ email: 'a@b.co' })
    expect(mockActivity).toHaveLength(1)
    expect(mockActivity[0].result).toBe('succeeded')
  })

  it('writes nothing and records the step as FAILED when no field matches', async () => {
    mockActions = [datasetAction(type)]

    await runEventActions(HOST_ID, 'formSubmission', { phone: '555-0100' })

    expect(addedRecords).toHaveLength(0)
    expect(mergedRecords).toHaveLength(0)
    expect(mockActivity).toHaveLength(1)
    const run = mockActivity[0]
    expect(run.result).toBe('failed')
    // The outcome line must not claim the write that did not happen.
    expect(run.summary).not.toMatch(/saved|updated/)
    // The error names the dataset, so the merchant knows which step to fix.
    expect(run.action).toContain('"Leads"')
  })
})

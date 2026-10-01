/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
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
 * A dataset step's record is held to the dataset's model (AGL-2773, option B).
 *
 * `datasetAppend` and `updateDataset` used to store `String(value)` for every
 * field and check nothing. They now coerce each value to its field's type,
 * and a record with a refused value is not written: the run records the step
 * as failed and names the field, instead of `saved to Leads`.
 *
 * A plugin's field type validates here too, through core's registry — this
 * plugin never imports the one that declares the type.
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

/** The stored row the update step's email lookup finds, when one exists. */
let existingValues: Record<string, any> | null = null

/** The dataset's `records` subcollection, under every band. */
const recordsHandle = (): any => ({
  count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
  add: async (data: Record<string, any>) => {
    addedRecords.push(data)
    return { id: `record-${addedRecords.length}` }
  },
  where: () => ({
    limit: () => ({
      get: async () =>
        existingValues
          ? {
              empty: false,
              docs: [
                {
                  get: (field: string) =>
                    field === 'values' ? existingValues : undefined,
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

/** A dataset with one field of each type a run writes. */
const MODEL = {
  order: ['email', 'seats', 'subscribed', 'startsOn', 'tier', 'stars'],
  fields: {
    email: { name: 'Email', type: 'text', required: true },
    seats: { name: 'Seats', type: 'int32' },
    subscribed: { name: 'Subscribed', type: 'bool' },
    startsOn: { name: 'Starts on', type: 'timestamp' },
    tier: { name: 'Tier', type: 'text', validation: { options: ['Gold', 'Silver'] } },
    // A plugin-contributed field type, registered as boot declarations would.
    stars: { name: 'Stars', type: 'int32', customType: 'spec-rating' },
  },
}

const datasetDoc = {
  id: 'dataset-1',
  exists: true,
  get: (field: string) =>
    ({
      displayName: 'Leads',
      model: MODEL,
      fields: MODEL.order,
    })[field],
  ref: {
    collection: () => recordsHandle(),
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
  orderBy: () => collectionHandle(path),
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

jest.mock('@aglyn/tenant-runtime/resolve-dataset', () => ({
  __esModule: true,
  resolveDatasetDoc: async () => datasetDoc,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async () => ({ sent: true }),
}))

import { registerCustomFieldType } from '@aglyn/aglyn/plugin-manager/custom-fields'
import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-declarations-repair'
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

/**
 * The plugin's field type, registered by the app's boot step the first time
 * a write asks for it — the path a process whose boot declarations did not
 * run takes. The workflows plugin never imports the plugin that owns it.
 */
const bootStep = jest.fn(async () => {
  registerCustomFieldType({
    name: 'spec-rating',
    pluginId: 'spec',
    label: 'Rating',
    baseType: 'int32',
    validate: (value) =>
      Number(value) >= 0 && Number(value) <= 5
        ? null
        : 'must be a whole number from 0 to 5',
  })
})

beforeEach(() => {
  mockActivity = []
  mockActions = []
  addedRecords = []
  mergedRecords = []
  existingValues = null
  registerPluginDeclarationsRepair(bootStep)
})

afterAll(() => {
  resetPluginDeclarationsRepairForTests()
})

const VALID = {
  email: 'a@b.co',
  seats: '3',
  subscribed: 'yes',
  startsOn: '2026-10-01',
  tier: 'Gold',
  stars: 4,
}

describe.each(['datasetAppend', 'updateDataset'] as const)('%s', (type) => {
  it('writes each value in its field’s type', async () => {
    mockActions = [datasetAction(type)]

    await runEventActions(HOST_ID, 'formSubmission', VALID)

    expect(addedRecords).toHaveLength(1)
    expect(addedRecords[0].values).toEqual({
      email: 'a@b.co',
      seats: 3,
      subscribed: true,
      startsOn: Date.parse('2026-10-01'),
      tier: 'Gold',
      stars: 4,
    })
    expect(mockActivity[0].result).toBe('succeeded')
  })

  it.each([
    ['a number field', { seats: 'three' }, /Seats must be a whole number/],
    ['a boolean field', { subscribed: 'perhaps' }, /Subscribed must be true or false/],
    ['a date field', { startsOn: 'soon' }, /Starts on must be a date/],
    ['a select field', { tier: 'Bronze' }, /Tier must be one of: Gold, Silver/],
    ['a required field', { email: '' }, /Email is required/],
    ['a plugin field type', { stars: 9 }, /Stars: must be a whole number from 0 to 5/],
  ])('refuses %s and records the step as failed', async (_label, override, reason) => {
    mockActions = [datasetAction(type)]

    await runEventActions(HOST_ID, 'formSubmission', { ...VALID, ...override })

    expect(addedRecords).toHaveLength(0)
    expect(mergedRecords).toHaveLength(0)
    const run = mockActivity[0]
    expect(run.result).toBe('failed')
    expect(run.summary).not.toMatch(/saved|updated/)
    expect(run.action).toContain('"Leads"')
    expect(run.action).toMatch(reason)
  })
})

describe('updateDataset merging into a stored row', () => {
  it('holds only the fields it sent to the model, keeping legacy text it did not touch', async () => {
    // A row a form wrote before AGL-2773: every value is text.
    existingValues = { email: 'a@b.co', seats: '2', tier: 'Platinum' }
    mockActions = [datasetAction('updateDataset')]

    await runEventActions(HOST_ID, 'formSubmission', {
      email: 'a@b.co',
      subscribed: 'no',
    })

    expect(addedRecords).toHaveLength(0)
    expect(mergedRecords).toHaveLength(1)
    expect(mergedRecords[0].values).toEqual({
      email: 'a@b.co',
      seats: '2',
      tier: 'Platinum',
      subscribed: false,
    })
    expect(mockActivity[0].result).toBe('succeeded')
  })

  it('refuses a merge whose own value does not fit', async () => {
    existingValues = { email: 'a@b.co' }
    mockActions = [datasetAction('updateDataset')]

    await runEventActions(HOST_ID, 'formSubmission', {
      email: 'a@b.co',
      seats: 'lots',
    })

    expect(mergedRecords).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toMatch(/Seats must be a whole number/)
  })
})

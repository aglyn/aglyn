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
 * THE DATASET STEPS AN AUTOMATION RUNS (AGL-3080), as this plugin answers
 * them through the server-step seam. Moved here, case for case, from the
 * engine's own specs when the steps moved; what the engine does with an
 * answer is `apps/console/specs/dataset-automation-steps.spec.ts`'s.
 *
 * Three properties, each held by a control that drives the same fixture to a
 * write, so a fixture that failed to reach the step could not pass a refusal:
 *
 *  1. THE BANDS (the fourth door onto `datasets/{id}/records`). An append past
 *     the row band or the byte band is refused, on either leg of
 *     update-or-append; the band is the ORG's; a customer whose capacity
 *     shrank still merges into a record it has, and nothing is deleted; and an
 *     uncapped plan never pays the count.
 *  2. A STEP THAT SAVED NOTHING DOES NOT SAY IT SAVED (AGL-2773): no matching
 *     field is a refusal naming the dataset.
 *  3. THE RECORD IS HELD TO THE MODEL (AGL-2773, option B): each value in its
 *     field's type, a refused value names its field, a plugin's field type
 *     validates through core's registry, and a merge holds only the fields it
 *     sent.
 */

import type { ServerStepRequest } from '@aglyn/aglyn/plugin-manager/plugin-server-steps'

const HOST_ID = 'site-1'

/** Records the step appended, and the patches it merged. */
let addedRecords: Record<string, any>[] = []
let mergedRecords: Record<string, any>[] = []
/** What the row band's count reads, and how many times it read. */
let recordCount = 0
let countReads = 0
/** What the byte band answers; null lets the row band decide alone. */
let mockStorageRefusal: { includedMb: number; basis: string } | null = null
/** The stored row the update step's email lookup finds, when one exists. */
let existingValues: Record<string, any> | null = null
/** The dataset document the lookup answers with. */
let datasetData: Record<string, any> = {}
/** Every announce the step made. */
let announced: Record<string, any>[] = []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => 'server-timestamp',
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
        existingValues
          ? {
              empty: false,
              docs: [
                {
                  get: (field: string) => (field === 'values' ? existingValues : undefined),
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

const datasetDoc = {
  id: 'dataset-1',
  exists: true,
  get: (field: string) => datasetData[field],
  ref: { collection: () => recordsHandle() },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({ doc: (id: string) => ({ id }) }),
      }),
    }),
  },
  dataStorageRefusal: async () => mockStorageRefusal,
  orgDataCollectionForHost: async () => ({ path: 'orgs/org-1/datasets' }),
}))

// The lookup is not what is being tested; a fixture that failed to resolve the
// dataset would make every "nothing was written" assertion below pass without
// the step ever running. `resolve-dataset.spec.ts` holds the lookup.
jest.mock('./resolve-dataset', () => ({
  __esModule: true,
  resolveDatasetDoc: async () => datasetDoc,
}))

jest.mock('./dataset-live-pages', () => ({
  __esModule: true,
  announceDatasetRecordChange: async (options: Record<string, any>) => {
    announced.push(options)
  },
}))

import { registerCustomFieldType } from '@aglyn/aglyn/plugin-manager/custom-fields'
import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-declarations-repair'
import { runDatasetStep } from './dataset-steps.server'

type DatasetStepType = 'datasetAppend' | 'updateDataset'

/** One step as the engine hands it over, on the org whose plan is under test. */
const run = (
  type: DatasetStepType,
  payload: Record<string, unknown>,
  org: Record<string, unknown> = { plan: 'pro' },
  step: Record<string, unknown> = { datasetName: 'Leads' },
) =>
  runDatasetStep({
    hostId: HOST_ID,
    org,
    orgId: 'org-1',
    run: { kind: 'action', id: 'action-1', name: 'Capture the lead' },
    event: 'formSubmission',
    payload,
    step: { type, ...step },
  } as ServerStepRequest)

beforeEach(() => {
  addedRecords = []
  mergedRecords = []
  recordCount = 0
  countReads = 0
  mockStorageRefusal = null
  existingValues = null
  announced = []
  datasetData = { displayName: 'Leads', fields: ['email', 'name'] }
})

describe('the row and byte bands', () => {
  it('THE CONTROL: appends a record when the dataset is under its band, and refreshes its pages', async () => {
    recordCount = 5
    expect(await run('datasetAppend', { email: 'a@b.co' })).toEqual({ detail: 'Leads' })
    expect(addedRecords).toHaveLength(1)
    expect(addedRecords[0].values).toEqual({ email: 'a@b.co' })
    expect(announced).toEqual([expect.objectContaining({ orgId: 'org-1', datasetId: 'dataset-1' })])
  })

  it('REFUSES an append past the row band, and says why', async () => {
    // Pro includes 10,000 records per dataset. The step used to write the
    // 10,001st and every one after it, forever, with no check of any kind.
    recordCount = 10_000
    const answer = await run('datasetAppend', { email: 'a@b.co' })
    expect(addedRecords).toEqual([])
    expect(answer.error).toContain('dataset is full')
    expect(announced).toEqual([])
  })

  it('refuses the APPEND leg of update-or-append too', async () => {
    // `updateDataset` appends when nothing matches, which is a new row by
    // another name — gating one leg and not the other would leave the door
    // open to any action willing to rename its step.
    recordCount = 10_000
    const answer = await run('updateDataset', { email: 'a@b.co' })
    expect(addedRecords).toEqual([])
    expect(answer.error).toContain('dataset is full')
  })

  it('reads the band from the ORG, not from the plan name', async () => {
    // A per-org override is how a shrunken capacity actually arrives, and it
    // is the input `resolveOrgEntitlements` exists to apply. A gate that read
    // `PLAN_ENTITLEMENTS[plan]` alone would let this write.
    recordCount = 2
    const answer = await run(
      'datasetAppend',
      { email: 'a@b.co' },
      { plan: 'pro', entitlements: { recordsPerDataset: 2 } },
    )
    expect(addedRecords).toEqual([])
    expect(answer.error).toContain('dataset is full (2 records on this plan)')
  })

  it('is refused by the BYTE band even when the rows fit', async () => {
    recordCount = 1
    mockStorageRefusal = { includedMb: 5120, basis: 'measured' }
    const answer = await run('datasetAppend', { email: 'a@b.co' })
    expect(addedRecords).toEqual([])
    expect(answer.error).toBe('dataset storage is full (5120 MB on this plan)')
  })

  it('still merges into a record that already exists when the capacity SHRANK', async () => {
    // An org sitting above its band is over it; that is not the same as being
    // in the act of exceeding it. The merge leg adds no row, so refusing it
    // would refuse the state of being over.
    recordCount = 40
    existingValues = { email: 'a@b.co', name: 'Old' }
    const answer = await run(
      'updateDataset',
      { email: 'a@b.co', name: 'New' },
      { plan: 'pro', entitlements: { recordsPerDataset: 1 } },
    )
    expect(answer).toEqual({})
    expect(mergedRecords).toHaveLength(1)
    expect(mergedRecords[0].values).toEqual({ email: 'a@b.co', name: 'New' })
    expect(addedRecords).toEqual([])
    expect(announced).toHaveLength(1)
  })

  it('deletes nothing and truncates nothing on the refused path', async () => {
    recordCount = 40
    await run(
      'datasetAppend',
      { email: 'a@b.co' },
      { plan: 'pro', entitlements: { recordsPerDataset: 0 } },
    )
    expect(addedRecords).toEqual([])
    expect(mergedRecords).toEqual([])
    expect(recordCount).toBe(40)
  })

  it('never reads the record count on an uncapped plan, and writes', async () => {
    // Agency's `recordsPerDataset` is UNLIMITED: the read is only worth paying
    // where it can change the answer.
    recordCount = 9_000_000
    await run('datasetAppend', { email: 'a@b.co' }, { plan: 'agency' })
    expect(countReads).toBe(0)
    expect(addedRecords).toHaveLength(1)
  })
})

describe('the dataset it names', () => {
  it('refuses a dataset the lookup cannot find, by the name the step carries', async () => {
    datasetData = { deletedAt: 'ts' }
    expect(await run('datasetAppend', { email: 'a@b.co' }, undefined, { datasetName: 'Gone' })).toEqual({
      error: 'unknown dataset "Gone"',
    })
    expect(addedRecords).toEqual([])
  })
})

describe.each(['datasetAppend', 'updateDataset'] as const)('%s with no matching field', (type) => {
  it('THE CONTROL: writes a record when an event field matches', async () => {
    expect((await run(type, { email: 'a@b.co' }, undefined, { datasetId: 'dataset-1' })).error).toBeUndefined()
    expect(addedRecords).toHaveLength(1)
    expect(addedRecords[0].values).toEqual({ email: 'a@b.co' })
  })

  it('writes nothing and REFUSES, naming the dataset, when no field matches', async () => {
    const answer = await run(type, { phone: '555-0100' }, undefined, { datasetId: 'dataset-1' })
    expect(addedRecords).toHaveLength(0)
    expect(mergedRecords).toHaveLength(0)
    expect(answer.detail).toBeUndefined()
    expect(answer.error).toBe('no event field matches a field in dataset "Leads"')
  })
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

const VALID = {
  email: 'a@b.co',
  seats: '3',
  subscribed: 'yes',
  startsOn: '2026-10-01',
  tier: 'Gold',
  stars: 4,
}

describe('the record, held to the model', () => {
  /**
   * The plugin's field type, registered by the app's boot step the first time
   * a write asks for it — the path a process whose boot declarations did not
   * run takes.
   */
  const bootStep = jest.fn(async () => {
    registerCustomFieldType({
      name: 'spec-rating',
      pluginId: 'spec',
      label: 'Rating',
      baseType: 'int32',
      validate: (value) =>
        Number(value) >= 0 && Number(value) <= 5 ? null : 'must be a whole number from 0 to 5',
    })
  })

  beforeEach(() => {
    datasetData = { displayName: 'Leads', model: MODEL, fields: MODEL.order }
    registerPluginDeclarationsRepair(bootStep)
  })

  afterAll(() => {
    resetPluginDeclarationsRepairForTests()
  })

  describe.each(['datasetAppend', 'updateDataset'] as const)('%s', (type) => {
    it('writes each value in its field’s type', async () => {
      expect((await run(type, VALID, undefined, { datasetId: 'dataset-1' })).error).toBeUndefined()
      expect(addedRecords).toHaveLength(1)
      expect(addedRecords[0].values).toEqual({
        email: 'a@b.co',
        seats: 3,
        subscribed: true,
        startsOn: Date.parse('2026-10-01'),
        tier: 'Gold',
        stars: 4,
      })
    })

    it.each([
      ['a number field', { seats: 'three' }, /Seats must be a whole number/],
      ['a boolean field', { subscribed: 'perhaps' }, /Subscribed must be true or false/],
      ['a date field', { startsOn: 'soon' }, /Starts on must be a date/],
      ['a select field', { tier: 'Bronze' }, /Tier must be one of: Gold, Silver/],
      ['a required field', { email: '' }, /Email is required/],
      ['a plugin field type', { stars: 9 }, /Stars: must be a whole number from 0 to 5/],
    ])('refuses %s, naming the dataset and the field', async (_label, override, reason) => {
      const answer = await run(type, { ...VALID, ...override }, undefined, { datasetId: 'dataset-1' })
      expect(addedRecords).toHaveLength(0)
      expect(mergedRecords).toHaveLength(0)
      expect(answer.detail).toBeUndefined()
      expect(answer.error).toContain('"Leads"')
      expect(answer.error).toMatch(reason)
    })
  })

  it('merges only the fields it sent, keeping legacy text it did not touch', async () => {
    // A row a form wrote before AGL-2773: every value is text.
    existingValues = { email: 'a@b.co', seats: '2', tier: 'Platinum' }
    const answer = await run(
      'updateDataset',
      { email: 'a@b.co', subscribed: 'no' },
      undefined,
      { datasetId: 'dataset-1' },
    )
    expect(answer).toEqual({})
    expect(addedRecords).toHaveLength(0)
    expect(mergedRecords).toHaveLength(1)
    expect(mergedRecords[0].values).toEqual({
      email: 'a@b.co',
      seats: '2',
      tier: 'Platinum',
      subscribed: false,
    })
  })

  it('refuses a merge whose own value does not fit', async () => {
    existingValues = { email: 'a@b.co' }
    const answer = await run(
      'updateDataset',
      { email: 'a@b.co', seats: 'lots' },
      undefined,
      { datasetId: 'dataset-1' },
    )
    expect(mergedRecords).toHaveLength(0)
    expect(answer.error).toMatch(/Seats must be a whole number/)
  })
})

describe('a step this plugin does not run', () => {
  it('is refused rather than guessed at', async () => {
    expect(
      await runDatasetStep({
        hostId: HOST_ID,
        org: null,
        orgId: null,
        run: { kind: 'action', id: 'a', name: 'a' },
        event: 'formSubmission',
        payload: {},
        step: { type: 'sendEmail' },
      }),
    ).toEqual({ error: '"sendEmail" is not a dataset step' })
  })
})

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
 * AGL-2171 — what a run WRITES.
 *
 * The presenter is unit-tested next door; this is the half that decides
 * whether there is anything for it to present. Two claims:
 *
 * 1. A successful run records what each step did, not just that it ran.
 * 2. A run stopped by a condition records a `skipped` row — **except on
 *    `pageView`**, which fires on every visitor of every published site
 *    and would turn a run history into a write amplifier.
 */

const HOST_ID = 'site-1'

/** Everything added to `hosts/{id}/activity`. */
let mockActivity: Record<string, any>[] = []
/** Actions returned by the trigger query, swapped per case. */
let mockActions: { id: string; data: Record<string, any> }[] = []
let mockCounters: Record<string, any> = {}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
}))

const docSnapshot = (id: string, data: Record<string, any>) => ({
  id,
  exists: true,
  data: () => data,
  get: (field: string) =>
    field.split('.').reduce<any>((value, key) => value?.[key], data),
  ref: { collection: () => collectionHandle('nested') },
})

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
      ? mockActions.map((action) => docSnapshot(action.id, action.data))
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
  getOrgForHost: async () => ({ org: { plan: 'business' } }),
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () => collectionHandle('orgs/o1/datasets'),
  orgDataQueryForHost: async () => collectionHandle('orgs/o1/contacts'),
  resolveOrgIdForHost: async () => 'o1',
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  // `{ sent: true }`, not `undefined`: the step branch reads `result.sent`
  // and pushes `email delivery failed` when it is falsy. A double that
  // returns nothing turns every email step into a FAILED run and would
  // have made this file assert the opposite of what it means to.
  sendEmail: async () => ({ sent: true }),
}))

import { runEventActions } from './run-event-actions'

/** An action that always matches, with the given steps. */
const action = (steps: Record<string, any>[], trigger: Record<string, any> = {}) => ({
  id: 'action-1',
  data: {
    name: 'Notify the team',
    enabled: true,
    trigger: { event: 'formSubmission', ...trigger },
    steps,
  },
})

beforeEach(() => {
  mockActivity = []
  mockActions = []
  mockCounters = {}
})

describe('a recorded run', () => {
  it('says what each step DID, not just that it ran', async () => {
    // The defect: `Action ran on formSubmission` was written whether the
    // action sent three things or nothing at all.
    mockActions = [
      action([
        { type: 'sendEmail', subject: 'x', body: 'y' },
        { type: 'notifyAdmins', message: 'new lead' },
      ]),
    ]
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(mockActivity).toHaveLength(1)
    const run = mockActivity[0]
    expect(run.result).toBe('succeeded')
    expect(run.trigger).toBe('formSubmission')
    expect(run.summary).toBe('sent email · notified admins')
    // The prose line is unchanged — `activityPrimaryText` and three other
    // renderers read it, and this collection feeds more than the run table.
    expect(run.action).toBe('Action ran on formSubmission')
  })

  it('marks a run that hit an error as failed', async () => {
    mockActions = [
      action([{ type: 'runWorkflow', workflowName: 'nope' }]),
    ]
    await runEventActions(HOST_ID, 'formSubmission', {})

    expect(mockActivity).toHaveLength(1)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('with errors:')
  })

  it('records nothing for a step that runs in the visitor browser', async () => {
    // Client steps never execute here, so claiming them would be a run
    // summary describing work the server did not do.
    mockActions = [
      action([
        { type: 'addClass', selector: '.x', className: 'y' },
        { type: 'sendEmail', subject: 'x', body: 'y' },
      ]),
    ]
    // The recipient comes from the PAYLOAD (`step.toField`, default
    // `email`), not from the step — a step with no payload email is an
    // error, not a silent success.
    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(mockActivity[0].summary).toBe('sent email')
  })
})

describe('a skipped run', () => {
  it('is RECORDED, with the condition that stopped it', async () => {
    // This was a bare `continue`. "Why didn't my automation fire?" had no
    // answer anywhere in the product.
    mockActions = [
      action([{ type: 'sendEmail', subject: 'x', body: 'y' }], {
        conditions: [{ field: 'budget', op: 'notEmpty' }],
      }),
    ]
    await runEventActions(HOST_ID, 'formSubmission', { budget: '' })

    expect(mockActivity).toHaveLength(1)
    expect(mockActivity[0].result).toBe('skipped')
    expect(mockActivity[0].summary).toContain('budget')
    expect(mockActivity[0].trigger).toBe('formSubmission')
  })

  it('names the field on a PRE-AGL-565 single-condition action too', async () => {
    // Those docs carry `condition`, not `conditions`; reading only the
    // array would give every legacy action the nameless fallback.
    mockActions = [
      action([{ type: 'sendEmail', subject: 'x', body: 'y' }], {
        condition: { field: 'budget', op: 'notEmpty' },
      }),
    ]
    await runEventActions(HOST_ID, 'formSubmission', { budget: '' })

    expect(mockActivity[0].result).toBe('skipped')
    expect(mockActivity[0].summary).toContain('budget')
  })

  it('writes NOTHING on a pageView skip', async () => {
    // `runEventActions` fires on every page view of every published site.
    // A Firestore write per visitor per non-matching action is not a run
    // history, it is an outage.
    mockActions = [
      {
        id: 'action-1',
        data: {
          name: 'Promo',
          enabled: true,
          trigger: {
            event: 'pageView',
            conditions: [{ field: 'path', op: 'equals', value: '/pricing' }],
          },
          steps: [{ type: 'notifyAdmins', message: 'x' }],
        },
      },
    ]
    await runEventActions(HOST_ID, 'pageView', { path: '/about' })

    expect(mockActivity).toEqual([])
  })

  it('still records a pageView run that actually HAPPENED', async () => {
    // The exclusion is about skips only — a page-view action that fires is
    // as loggable as any other.
    mockActions = [
      {
        id: 'action-1',
        data: {
          name: 'Promo',
          enabled: true,
          trigger: { event: 'pageView' },
          steps: [{ type: 'notifyAdmins', message: 'x' }],
        },
      },
    ]
    await runEventActions(HOST_ID, 'pageView', { path: '/pricing' })

    expect(mockActivity).toHaveLength(1)
    expect(mockActivity[0].result).toBe('succeeded')
  })

  it('does not count a skip against the run quota', async () => {
    // Nothing executed. Charging for a condition that said no would be its
    // own bug.
    mockActions = [
      action([{ type: 'notifyAdmins', message: 'x' }], {
        conditions: [{ field: 'budget', op: 'notEmpty' }],
      }),
    ]
    await runEventActions(HOST_ID, 'formSubmission', { budget: '' })

    const monthKey = new Date().toISOString().slice(0, 7)
    expect(
      mockCounters[`hosts/${HOST_ID}/counters/actionRuns`]?.[monthKey],
    ).toBeUndefined()
  })
})

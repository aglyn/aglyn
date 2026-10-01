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
 * AGL-3458 — EVERY ACTION ON THE EVENT RUNS, and another form's action is
 * not a skip.
 *
 * The dispatch read ten documents for the event, unordered, and dropped the
 * deleted and the switched-off ones after the limit: a site with one
 * auto-reply per form ran some ten of them. The store below answers the
 * query the way Firestore does — the equality, the document-id order, the
 * page size and the cursor — so a dispatch that stopped at the first page,
 * or let a dead document take a live one's place, fails here.
 *
 * Each action's one step is a `siteAlert` carrying its own id, so the alerts
 * the dispatch returns are the actions that ran, in the order they ran.
 */

const HOST_ID = 'site-1'

/** `hosts/site-1/actions`, by id. */
let mockActions: Record<string, Record<string, any>> = {}
/** Everything added to `hosts/{id}/activity`. */
let mockActivity: Record<string, any>[] = []
/** Every page the actions query was asked for: its limit and its cursor. */
let mockPages: Array<{ limit: number; after: string | null }> = []
let mockCounters: Record<string, any> = {}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const readField = (data: Record<string, any>, field: string) =>
  field.split('.').reduce<any>((value, key) => value?.[key], data)

const snapshotOf = (id: string, data: Record<string, any>) => ({
  id,
  exists: true,
  data: () => data,
  get: (field: string) => readField(data, field),
})

/** The actions collection, answering equality, `__name__` order, a page and a cursor. */
function actionsQuery(
  filters: Array<[string, unknown]>,
  ordered: boolean,
  limit: number,
  after: string | null,
): any {
  return {
    where: (field: string, _op: string, value: unknown) =>
      actionsQuery([...filters, [field, value]], ordered, limit, after),
    orderBy: (field: string) => {
      if (field !== '__name__') throw new Error(`ordered by ${field}, not the document id`)
      return actionsQuery(filters, true, limit, after)
    },
    limit: (count: number) => actionsQuery(filters, ordered, count, after),
    startAfter: (cursor: { id: string }) => actionsQuery(filters, ordered, limit, cursor.id),
    get: async () => {
      if (!ordered) throw new Error('an unordered page is not a page')
      mockPages.push({ limit, after })
      const docs = Object.keys(mockActions)
        .sort()
        .filter((id) => after === null || id > after)
        .filter((id) => filters.every(([field, value]) => readField(mockActions[id], field) === value))
        .slice(0, limit)
        .map((id) => snapshotOf(id, mockActions[id]))
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
}

const collectionHandle = (path: string): any => {
  if (path.endsWith('/actions')) return actionsQuery([], false, Infinity, null)
  return {
    doc: (id: string) => ({
      get: async () => ({
        exists: Boolean(mockCounters[`${path}/${id}`]),
        get: (field: string) => mockCounters[`${path}/${id}`]?.[field],
        data: () => mockCounters[`${path}/${id}`],
      }),
      set: async (patch: Record<string, any>) => {
        mockCounters[`${path}/${id}`] = { ...(mockCounters[`${path}/${id}`] ?? {}), ...patch }
      },
      collection: (name: string) => collectionHandle(`${path}/${id}/${name}`),
    }),
    where: () => collectionHandle(path),
    orderBy: () => collectionHandle(path),
    limit: () => collectionHandle(path),
    get: async () => ({ docs: [], empty: true, size: 0 }),
    add: async (data: Record<string, any>) => {
      if (path.endsWith('activity')) mockActivity.push(data)
      return { id: 'new' }
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({ collection: (name: string) => collectionHandle(name) }),
    }),
  },
  // A plan whose allowance cannot be what stops a run here.
  getOrgForHost: async () => ({ org: { plan: 'business' } }),
  notifyHostManagers: async () => undefined,
  resolveOrgIdForHost: async () => null,
}))

import { conditionsNameAnotherForm, runEventActions } from './run-event-actions'

/** An action on `formSubmission` whose one step says which action it was. */
function seed(id: string, overrides: Record<string, any> = {}) {
  mockActions[id] = {
    name: `Action ${id}`,
    enabled: true,
    trigger: { event: 'formSubmission' },
    steps: [{ type: 'siteAlert', message: id }],
    ...overrides,
  }
}

const ran = (alerts: Array<{ message: string }>) => alerts.map((alert) => alert.message)

beforeEach(() => {
  mockActions = {}
  mockActivity = []
  mockPages = []
  mockCounters = {}
})

describe('every live action on the event runs (AGL-3458)', () => {
  it('runs all twelve of a twelve-form site’s auto-replies, in document-id order', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `reply-${String(index).padStart(2, '0')}`)
    // Seeded out of order: the order is the store's, by id, not insertion.
    for (const id of [...ids].reverse()) seed(id)

    const alerts = await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(ran(alerts)).toEqual(ids)
  })

  it('lets no deleted or switched-off action take a live one’s place', async () => {
    // The ten that sort first are dead; the old read stopped at ten.
    for (let index = 0; index < 6; index += 1) seed(`a-deleted-${index}`, { deletedAt: 'yesterday' })
    for (let index = 0; index < 4; index += 1) seed(`b-off-${index}`, { enabled: false })
    seed('c-live-1')
    seed('c-live-2')

    const alerts = await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(ran(alerts)).toEqual(['c-live-1', 'c-live-2'])
  })

  it('pages past a full first page, so the hundred-and-first action runs too', async () => {
    const ids = Array.from({ length: 130 }, (_, index) => `act-${String(index).padStart(3, '0')}`)
    for (const id of ids) seed(id)

    const alerts = await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(ran(alerts)).toEqual(ids)
    expect(mockPages).toEqual([
      { limit: 100, after: null },
      { limit: 100, after: 'act-099' },
    ])
  })

  it('reads one page for a site with a handful, as it always did', async () => {
    seed('only')

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(mockPages).toHaveLength(1)
  })

  it('runs only the actions on THIS event', async () => {
    seed('mine')
    seed('other', { trigger: { event: 'booking' } })

    const alerts = await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co' })

    expect(ran(alerts)).toEqual(['mine'])
  })
})

describe('another form’s action is not a skip (AGL-3458)', () => {
  const onForm = (formId: string) => ({
    trigger: {
      event: 'formSubmission',
      conditions: [{ field: 'formId', op: 'equals', value: formId }],
      combinator: 'and',
    },
  })

  it('runs the matching form’s reply and writes no row for the other forms’', async () => {
    seed('reply-a', onForm('form-a'))
    seed('reply-b', onForm('form-b'))
    seed('reply-c', onForm('form-c'))

    const alerts = await runEventActions(HOST_ID, 'formSubmission', {
      email: 'a@b.co',
      formId: 'form-b',
    })

    expect(ran(alerts)).toEqual(['reply-b'])
    expect(mockActivity.filter((row) => row.result === 'skipped')).toEqual([])
    expect(mockActivity.filter((row) => row.result === 'succeeded')).toHaveLength(1)
  })

  it('still records a skip for a hand-typed form name that did not match', async () => {
    // A typo in a name never matches anything, and the row is how anybody
    // finds out — so only a picked id is quiet.
    seed('typed', {
      trigger: {
        event: 'formSubmission',
        conditions: [{ field: 'formName', op: 'equals', value: 'Contcat' }],
      },
    })

    await runEventActions(HOST_ID, 'formSubmission', {
      email: 'a@b.co',
      formId: 'form-a',
      formName: 'Contact',
    })

    expect(mockActivity.map((row) => row.result)).toEqual(['skipped'])
  })

  it('still records a skip for any other condition beside the form', async () => {
    seed('field', {
      trigger: {
        event: 'formSubmission',
        conditions: [{ field: 'subscribe', op: 'notEmpty' }],
      },
    })

    await runEventActions(HOST_ID, 'formSubmission', { email: 'a@b.co', formId: 'form-a' })

    expect(mockActivity.map((row) => row.result)).toEqual(['skipped'])
  })
})

describe('conditionsNameAnotherForm', () => {
  const formId = (value: string) => ({ field: 'formId', op: 'equals' as const, value })
  const formName = (value: string) => ({ field: 'formName', op: 'equals' as const, value })

  it('is another form when a picked id names a different one', () => {
    expect(conditionsNameAnotherForm({ event: 'formSubmission', conditions: [formId('a')] }, { formId: 'b' })).toBe(true)
  })

  it('is not, for the same form, or a submission that names none', () => {
    expect(conditionsNameAnotherForm({ event: 'formSubmission', conditions: [formId('a')] }, { formId: 'a' })).toBe(false)
    expect(conditionsNameAnotherForm({ event: 'formSubmission', conditions: [formId('a')] }, {})).toBe(false)
  })

  it('with OR, only when every clause is about which form it was', () => {
    const fallback = { event: 'formSubmission', combinator: 'or' as const }
    expect(
      conditionsNameAnotherForm({ ...fallback, conditions: [formId('a'), formName('A')] }, { formId: 'b' }),
    ).toBe(true)
    expect(
      conditionsNameAnotherForm(
        { ...fallback, conditions: [formId('a'), { field: 'vip', op: 'notEmpty' as const }] },
        { formId: 'b' },
      ),
    ).toBe(false)
  })
})

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
 * WHAT ONE DISPATCHED ACTION DID (AGL-3309).
 *
 * `runSingleAction` answers a page's dispatch with alerts and nothing else, so
 * every gate that stops a run reads as an empty list. The console's test run
 * asks `runSingleActionOutcome` instead, which runs the same body and says
 * which gate stopped it. Pinned here, against the real gates and a Firestore
 * double: each refusal names its gate and neither meters nor records a run,
 * the run that goes ahead is metered and recorded once, and the page's
 * answer is unchanged.
 */

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'
const MONTH = new Date().toISOString().slice(0, 7)
const RUNS = `hosts/${HOST_ID}/counters/actionRuns`

/** Every document, by full path. */
let store: Record<string, Record<string, any>> = {}
/** The owning org's billing doc — the plan every gate reads. */
let mockOrg: Record<string, any> = { plan: 'business' }
/** Makes the org lookup throw, for the one refusal that is a failure. */
let mockOrgLookupFails = false

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

/** A patch applied the way Firestore applies one: increments add up. */
const applyPatch = (
  existing: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> => {
  const next = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    next[key] =
      value && typeof value === 'object' && '__increment' in value
        ? Number(existing[key] ?? 0) + value.__increment
        : value
  }
  return next
}

const snapshotOf = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  exists: store[path] !== undefined,
  data: () => store[path],
  get: (field: string) => store[path]?.[field],
})

const docRef = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get: async () => snapshotOf(path),
  set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
    store[path] = applyPatch(options?.merge ? (store[path] ?? {}) : {}, data)
  },
  collection: (name: string) => collectionRef(`${path}/${name}`),
})

const collectionRef = (path: string): any => ({
  doc: (id: string) => docRef(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    const id = `auto-${Object.keys(store).length + 1}`
    store[`${path}/${id}`] = { ...data }
    return docRef(`${path}/${id}`)
  },
})

const firestoreHandle: any = { collection: (name: string) => collectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestoreHandle }) },
  getOrgForHost: async () => {
    if (mockOrgLookupFails) throw new Error('org lookup failed')
    return { orgId: ORG_ID, org: mockOrg }
  },
}))

import { resolveOrgEntitlements } from '@aglyn/aglyn/server'
import { runSingleAction, runSingleActionOutcome } from './run-event-actions'

/** The run history rows the engine wrote. */
const history = () =>
  Object.entries(store)
    .filter(([path]) => path.startsWith(`hosts/${HOST_ID}/activity/`))
    .map(([, row]) => row)

/** The month's metered action runs. */
const metered = () => Number(store[RUNS]?.[MONTH] ?? 0)

const seedAction = (overrides: Record<string, unknown> = {}) => {
  store[`hosts/${HOST_ID}/actions/act-1`] = {
    name: 'Offer at half way',
    enabled: true,
    trigger: { event: 'scrollDepth', threshold: 50 },
    steps: [{ type: 'siteAlert', message: 'Half way there' }],
    ...overrides,
  }
}

beforeEach(() => {
  store = {}
  mockOrg = { plan: 'business' }
  mockOrgLookupFails = false
})

describe('runSingleActionOutcome', () => {
  it('runs the steps, meters and records the run once, and says it ran', async () => {
    seedAction()
    expect(
      await runSingleActionOutcome(HOST_ID, 'act-1', 'scrollDepth', { path: '/pricing' }),
    ).toEqual({
      ran: true,
      skipped: null,
      alerts: [{ message: 'Half way there', severity: 'info' }],
    })
    expect(metered()).toBe(1)
    expect(history()).toEqual([
      expect.objectContaining({
        result: 'succeeded',
        trigger: 'scrollDepth',
        target: { type: 'workflow', id: 'act-1', name: 'Offer at half way' },
      }),
    ])
  })

  it.each([
    ['missing', () => undefined, 'scrollDepth'],
    ['missing', () => seedAction({ deletedAt: 'ts' }), 'scrollDepth'],
    ['disabled', () => seedAction({ enabled: false }), 'scrollDepth'],
    ['event', () => seedAction(), 'elementClick'],
    [
      'conditions',
      () =>
        seedAction({
          trigger: {
            event: 'scrollDepth',
            conditions: [{ field: 'path', op: 'contains', value: '/pricing' }],
          },
        }),
      'scrollDepth',
    ],
    [
      'plan',
      () => {
        seedAction()
        mockOrg = { plan: 'free' }
      },
      'scrollDepth',
    ],
  ])('says %s, and neither meters nor records a run', async (reason, arrange, event) => {
    arrange()
    expect(
      await runSingleActionOutcome(HOST_ID, 'act-1', event, { path: '/console-test' }),
    ).toEqual({ ran: false, skipped: reason, alerts: [] })
    expect(metered()).toBe(0)
    expect(history()).toEqual([])
  })

  it('says the allowance is spent, and which allowance', async () => {
    seedAction()
    const limit = resolveOrgEntitlements(mockOrg as never).actionRunsPerMonth
    store[RUNS] = { [MONTH]: limit }
    expect(await runSingleActionOutcome(HOST_ID, 'act-1', 'scrollDepth', {})).toEqual({
      ran: false,
      skipped: 'allowance',
      alerts: [],
      limit,
    })
    expect(metered()).toBe(limit)
    expect(history()).toEqual([])
  })

  it('says it failed when a read before the first step throws, and logs it', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    seedAction()
    mockOrgLookupFails = true
    expect(await runSingleActionOutcome(HOST_ID, 'act-1', 'scrollDepth', {})).toEqual({
      ran: false,
      skipped: 'failed',
      alerts: [],
    })
    expect(logged).toHaveBeenCalledWith(
      'runSingleAction failed',
      HOST_ID,
      'act-1',
      expect.any(Error),
    )
    logged.mockRestore()
    expect(metered()).toBe(0)
  })
})

describe('runSingleAction, the page’s dispatch', () => {
  it('still answers with the alerts alone, and with nothing when a gate stops the run', async () => {
    seedAction()
    expect(await runSingleAction(HOST_ID, 'act-1', 'scrollDepth', {})).toEqual([
      { message: 'Half way there', severity: 'info' },
    ])
    seedAction({ enabled: false })
    expect(await runSingleAction(HOST_ID, 'act-1', 'scrollDepth', {})).toEqual([])
    expect(metered()).toBe(1)
  })
})

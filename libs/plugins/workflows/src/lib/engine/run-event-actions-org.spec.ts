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
 * WHAT AN ORG AUTOMATION DOES WHEN AN EVENT ARRIVES (AGL-3302).
 *
 * The organization writes one automation and places it on the sites it
 * chooses; each run is the event's SITE running it for itself. So this file
 * holds the engine to four things: it runs on a site it is placed on and on
 * no other; it stops when it is paused there, switched off or deleted —
 * including for the people already waiting inside it; it runs as the site
 * (its email, its meter, its feed); and asking costs nothing on the events an
 * org automation cannot start on, the page view above all.
 *
 * The store below honours the three filters the engine's query carries —
 * equality on `trigger.event` and `enabled`, `array-contains-any` on
 * `visibleTo` — so "not placed on this site" is decided by the query, as it is
 * in production, rather than by a fake that returns everything.
 */

const ORG_ID = 'org-1'
const SITE = 'site-a'
const SIBLING = 'site-b'
const NOW = 1_700_000_000_000

/** Every document, by full path. */
let mockDocs: Map<string, Record<string, any>> = new Map()
/** Every collection a query was run against, by path. */
let mockQueried: string[] = []
/** What `getOrgForHost` answers, swapped per case. */
let mockOrg: Record<string, any> | null = { plan: 'pro' }
/** Every message the run handed to the sender. */
let mockSent: Record<string, any>[] = []
let mockAutoId = 0

const mockResolveOrgIdForHost = jest.fn<Promise<string>, [string]>(
  async () => ORG_ID,
)
const mockMeterHostEmail = jest.fn<Promise<undefined>, [string]>(
  async () => undefined,
)
const mockHostSendingIdentity = jest.fn(async (hostId: string) => ({
  from: `hello@${hostId}.mail.aglyn.app`,
  source: 'custom',
  domain: `${hostId}.mail.aglyn.app`,
  summary: '',
  refusal: null,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    delete: () => ({ __delete: true }),
  },
}))

/** A dotted field read, the way `DocumentSnapshot.get` answers it. */
function mockRead(data: Record<string, any> | undefined, field: string): any {
  return field
    .split('.')
    .reduce<any>((value, key) => (value == null ? undefined : value[key]), data)
}

/** Merge a patch the way `set(…, { merge: true })` does, increments included. */
function mockMerge(
  previous: Record<string, any> | undefined,
  patch: Record<string, any>,
): Record<string, any> {
  const next: Record<string, any> = { ...(previous ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && '__increment' in value) {
      next[key] = Number(next[key] ?? 0) + Number(value.__increment)
    } else if (value && typeof value === 'object' && '__delete' in value) {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  return next
}

function mockSnapshot(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() ?? '',
    ref: mockDocRef(path),
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => mockRead(data, field),
  }
}

function mockDocRef(path: string): any {
  return {
    path,
    id: path.split('/').pop() ?? '',
    get firestore() {
      return mockFirestore
    },
    get: async () => mockSnapshot(path),
    set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
      mockDocs.set(
        path,
        options?.merge ? mockMerge(mockDocs.get(path), patch) : mockMerge({}, patch),
      )
    },
    update: async (patch: Record<string, any>) => {
      mockDocs.set(path, mockMerge(mockDocs.get(path), patch))
    },
    delete: async () => {
      mockDocs.delete(path)
    },
    collection: (name: string) => mockCollection(`${path}/${name}`),
  }
}

type MockFilter = [string, string, any]

function mockQuery(path: string, filters: MockFilter[], cap?: number): any {
  return {
    where: (field: string, op: string, value: any) =>
      mockQuery(path, [...filters, [field, op, value]], cap),
    limit: (n: number) => mockQuery(path, filters, n),
    get: async () => {
      mockQueried.push(path)
      const prefix = `${path}/`
      const docs = [...mockDocs.keys()]
        .filter(
          (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
        )
        .map(mockSnapshot)
        .filter((snapshot) =>
          filters.every(([field, op, value]) => {
            const actual = snapshot.get(field)
            if (op === '==') return actual === value
            if (op === 'array-contains-any') {
              return Array.isArray(actual) && actual.some((one) => value.includes(one))
            }
            throw new Error(`the fake store does not answer "${op}"`)
          }),
        )
        .slice(0, cap ?? Infinity)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
}

function mockCollection(path: string): any {
  return {
    ...mockQuery(path, []),
    doc: (id: string) => mockDocRef(`${path}/${id}`),
    add: async (data: Record<string, any>) => {
      mockAutoId += 1
      const ref = mockDocRef(`${path}/auto-${mockAutoId}`)
      await ref.set(data)
      return ref
    },
  }
}

const mockFirestore: any = {
  collection: (name: string) => mockCollection(name),
  doc: (path: string) => mockDocRef(path),
  runTransaction: async (body: (transaction: any) => Promise<any>) =>
    await body({
      get: async (ref: any) => await ref.get(),
      set: async (ref: any, data: any) => {
        await ref.set(data)
      },
      update: async (ref: any, patch: any) => {
        await ref.update(patch)
      },
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  UNSUBSCRIBE_SUPPRESSION_REASON: 'unsubscribe',
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore }),
    firestore: {
      FieldValue: { increment: (by: number) => ({ __increment: by }) },
    },
  },
  getOrgForHost: async () => (mockOrg ? { orgId: ORG_ID, org: mockOrg } : null),
  resolveOrgIdForHost: (hostId: string) => mockResolveOrgIdForHost(hostId),
  hostSendingIdentity: (hostId: string) => mockHostSendingIdentity(hostId),
  meterHostEmail: (hostId: string) => mockMeterHostEmail(hostId),
  flowEmailRefusal: async () => null,
  dataStorageRefusal: async () => null,
  enrollListMember: async () => ({ enrolled: true, created: true }),
  notifyHostManagers: async () => undefined,
  consentGroupForSite: async (hostId: string) => ({ groupId: hostId }),
  orgDataCollectionForHost: async () => mockCollection(`orgs/${ORG_ID}/datasets`),
  orgDataQueryForHost: async () => ({ ref: mockCollection(`orgs/${ORG_ID}/contacts`) }),
}))

jest.mock('@aglyn/tenant-data-admin/server/dataset-live-pages', () => ({
  __esModule: true,
  announceDatasetRecordChange: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin/server/contact-email-index', () => ({
  __esModule: true,
  findContactByEmail: async () => null,
}))

jest.mock('@aglyn/tenant-runtime/resolve-dataset', () => ({
  __esModule: true,
  resolveDatasetDoc: async () => null,
}))

// The CRM steps are held to their own suites; here a CRM write is a line in
// the run history, and the email's timeline row is somebody else's question.
jest.mock('./crm-action-steps', () => ({
  __esModule: true,
  prepareCrmEmailActivity: async () => null,
  logCrmEmailActivity: async () => undefined,
  runCrmActionStep: async () => ({ detail: 'tagged' }),
}))

jest.mock('@aglyn/shared-util-email', () => {
  const actual = jest.requireActual('@aglyn/shared-util-email')
  return {
    __esModule: true,
    ...actual,
    isEmailConfigured: () => true,
    sendEmail: async (message: Record<string, any>) => {
      mockSent.push(message)
      return { sent: true }
    },
  }
})

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import type { FlowEnrollment } from './flow-enrollments'
import {
  resumeFlowEnrollment,
  runEventActions,
} from './run-event-actions'
import { resetOrgAutomationLookupsForTests } from './run-org-automations'

const automationPath = (id: string) => `orgs/${ORG_ID}/automations/${id}`
const siteActivity = (hostId: string) =>
  [...mockDocs.entries()]
    .filter(([key]) => key.startsWith(`hosts/${hostId}/activity/`))
    .map(([, row]) => row)
const enrollmentsOf = (hostId: string) =>
  [...mockDocs.entries()].filter(([key]) =>
    key.startsWith(`hosts/${hostId}/flowEnrollments/`),
  )
const monthKey = new Date().toISOString().slice(0, 7)
const actionRuns = (hostId: string) =>
  Number(mockDocs.get(`hosts/${hostId}/counters/actionRuns`)?.[monthKey] ?? 0)

/** An org automation as the save route stores one. */
function seedOrgAutomation(
  id: string,
  overrides: Record<string, any> = {},
): void {
  mockDocs.set(automationPath(id), {
    name: 'Welcome every lead',
    trigger: { event: 'formSubmission', conditions: null, combinator: null },
    steps: [{ type: 'sendEmail', subject: 'Welcome', body: 'Thanks for writing' }],
    enabled: true,
    visibleTo: ['org'],
    pausedHostIds: [],
    deletedAt: null,
    ...overrides,
  })
}

beforeEach(() => {
  mockDocs = new Map()
  mockQueried = []
  mockOrg = { plan: 'pro' }
  mockSent = []
  mockAutoId = 0
  mockResolveOrgIdForHost.mockClear()
  mockMeterHostEmail.mockClear()
  mockHostSendingIdentity.mockClear()
  resetOrgAutomationLookupsForTests()
})

describe('an org automation runs on the sites it is placed on', () => {
  it('CONTROL: placed on every site, it runs on this one', async () => {
    seedOrgAutomation('org-auto-1')

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    expect(mockSent.map((message) => message.subject)).toEqual(['Welcome'])
  })

  it('runs AS the event’s site: its sender, its meter, its feed', async () => {
    seedOrgAutomation('org-auto-1')

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    expect(mockHostSendingIdentity).toHaveBeenCalledWith(SITE)
    expect(mockSent[0]?.sendingIdentity?.from).toBe(`hello@${SITE}.mail.aglyn.app`)
    expect(mockSent[0]?.marketing?.hostId).toBe(SITE)
    expect(mockMeterHostEmail).toHaveBeenCalledWith(SITE)
    const [row] = siteActivity(SITE)
    expect(row?.target).toEqual({
      type: 'orgAutomation',
      id: 'org-auto-1',
      name: 'Welcome every lead',
    })
    expect(row?.result).toBe('succeeded')
    expect(row?.action).toBe('Org automation ran on formSubmission')
    // Nothing lands on the sibling's feed, or on the organization's.
    expect(siteActivity(SIBLING)).toEqual([])
  })

  it('placed on this site by name, it runs; placed only on a sibling, it does not', async () => {
    seedOrgAutomation('mine', { visibleTo: [`host:${SITE}`] })
    seedOrgAutomation('theirs', {
      name: 'Sibling only',
      visibleTo: [`host:${SIBLING}`],
      steps: [{ type: 'sendEmail', subject: 'Not for site A', body: 'x' }],
    })

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    expect(mockSent.map((message) => message.subject)).toEqual(['Welcome'])
  })

  it('does not run where it is paused, and still runs where it is not', async () => {
    seedOrgAutomation('org-auto-1', { pausedHostIds: [SITE] })

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })
    expect(mockSent).toEqual([])

    await runEventActions(SIBLING, 'formSubmission', { email: 'a@b.co' })
    expect(mockSent.map((message) => message.subject)).toEqual(['Welcome'])
  })

  it('does not run switched off, or deleted', async () => {
    seedOrgAutomation('off', { enabled: false })
    seedOrgAutomation('gone', { enabled: false, deletedAt: 'yesterday' })

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    expect(mockSent).toEqual([])
    expect(siteActivity(SITE)).toEqual([])
  })

  it('does not run on another trigger', async () => {
    seedOrgAutomation('org-auto-1', {
      trigger: { event: 'booking', conditions: null, combinator: null },
    })

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    expect(mockSent).toEqual([])
  })

  it('records a skip when its condition is not met, filed as the org automation', async () => {
    seedOrgAutomation('org-auto-1', {
      trigger: {
        event: 'formSubmission',
        conditions: [{ field: 'subscribe', op: 'notEmpty' }],
        combinator: 'and',
      },
    })

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    expect(mockSent).toEqual([])
    const [row] = siteActivity(SITE)
    expect(row?.result).toBe('skipped')
    expect(row?.target?.type).toBe('orgAutomation')
    // A skip is not a run, so it moves no meter.
    expect(actionRuns(SITE)).toBe(0)
  })

  it('refuses, at run time, a step the save route would have refused', async () => {
    seedOrgAutomation('org-auto-1', {
      steps: [
        { type: 'webhookPost', webhookId: 'hook-1' },
        { type: 'sendEmail', subject: 'Welcome', body: 'x' },
      ],
    })

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    // The allowed step still runs; the site's webhook is never reached.
    expect(mockSent.map((message) => message.subject)).toEqual(['Welcome'])
    const [row] = siteActivity(SITE)
    expect(row?.result).toBe('failed')
    expect(row?.action).toContain('belongs to one site')
  })

  it('needs the actions plan, as a site action does', async () => {
    seedOrgAutomation('org-auto-1')
    mockOrg = { plan: 'free' }

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    expect(mockSent).toEqual([])
  })
})

describe('what asking costs', () => {
  it('a page view never asks for the organization or its automations', async () => {
    seedOrgAutomation('org-auto-1', {
      trigger: { event: 'pageView', conditions: null, combinator: null },
    })

    await runEventActions(SITE, 'pageView', { path: '/pricing' })

    expect(mockResolveOrgIdForHost).not.toHaveBeenCalled()
    expect(mockQueried.filter((path) => path.startsWith('orgs/'))).toEqual([])
    expect(mockSent).toEqual([])
  })

  it('a custom event never asks either — it is no org trigger', async () => {
    await runEventActions(SITE, 'newsletterJoined', { email: 'a@b.co' })

    expect(mockResolveOrgIdForHost).not.toHaveBeenCalled()
    expect(mockQueried.filter((path) => path.startsWith('orgs/'))).toEqual([])
  })

  it('CONTROL: an org trigger does ask, once, for this site’s organization', async () => {
    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    expect(mockResolveOrgIdForHost).toHaveBeenCalledWith(SITE)
    expect(mockQueried).toContain(`orgs/${ORG_ID}/automations`)
  })

  it('remembers the organization between a site’s events', async () => {
    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })
    await runEventActions(SITE, 'lead', { email: 'a@b.co' })

    expect(mockResolveOrgIdForHost).toHaveBeenCalledTimes(1)
  })
})

describe('one meter, the site’s', () => {
  function seedSiteAction(): void {
    mockDocs.set(`hosts/${SITE}/actions/site-action-1`, {
      name: 'Site welcome',
      enabled: true,
      trigger: { event: 'formSubmission' },
      steps: [{ type: 'sendEmail', subject: 'From the site', body: 'x' }],
    })
  }

  it('counts an org run on the site’s action runs, beside the site’s own', async () => {
    seedSiteAction()
    seedOrgAutomation('org-auto-1')

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    expect(mockSent.map((message) => message.subject)).toEqual([
      'From the site',
      'Welcome',
    ])
    expect(actionRuns(SITE)).toBe(2)
  })

  it('never lets the organization’s automations stop the site’s own', async () => {
    seedSiteAction()
    seedOrgAutomation('org-auto-1')
    // Room for exactly one more run this month.
    const limit = 1000
    mockOrg = { plan: 'pro', entitlements: { actionRunsPerMonth: limit } }
    mockDocs.set(`hosts/${SITE}/counters/actionRuns`, { [monthKey]: limit - 1 })

    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })

    // The site's action fits and runs; the org automation would go over.
    expect(mockSent.map((message) => message.subject)).toEqual(['From the site'])
    expect(actionRuns(SITE)).toBe(limit)
  })
})

describe('waiting inside an org automation', () => {
  const WAITING_STEPS = [
    { type: 'sendEmail', subject: 'Welcome', body: 'x' },
    { type: 'wait', delayMinutes: 60 * 24 },
    { type: 'sendEmail', subject: 'Day two', body: 'y' },
  ]

  async function enrollOne(): Promise<[string, FlowEnrollment]> {
    seedOrgAutomation('org-auto-1', { steps: WAITING_STEPS })
    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })
    const rows = enrollmentsOf(SITE)
    expect(rows).toHaveLength(1)
    const [path, row] = rows[0]
    return [path, row as FlowEnrollment]
  }

  it('enrolls on the event’s site, under the org prefix, naming the organization', async () => {
    const [path, enrollment] = await enrollOne()

    expect(path).toBe(
      `hosts/${SITE}/flowEnrollments/org-org-auto-1__${personKey('a@b.co')}`,
    )
    expect(enrollment.automation).toBe('org')
    expect(enrollment.orgId).toBe(ORG_ID)
    expect(enrollment.hostId).toBe(SITE)
    expect(enrollment.nextStepIndex).toBe(2)
    expect(mockSent.map((message) => message.subject)).toEqual(['Welcome'])
  })

  it('resumes against the organization’s document and finishes the flow', async () => {
    const [path, enrollment] = await enrollOne()
    mockSent = []

    // This month, so the resume's run lands on the same month key the first
    // run's did.
    const ending = await resumeFlowEnrollment(enrollment, mockDocRef(path), {
      nowMs: Date.now(),
    })

    expect(ending).toBe('ran')
    expect(mockSent.map((message) => message.subject)).toEqual(['Day two'])
    expect(enrollmentsOf(SITE)).toEqual([])
    // Counted on the site's meter: the first run and the resume.
    expect(actionRuns(SITE)).toBe(2)
  })

  it.each([
    ['deleted', (id: string) => mockDocs.delete(automationPath(id))],
    [
      'switched off',
      (id: string) =>
        mockDocs.set(automationPath(id), {
          ...mockDocs.get(automationPath(id)),
          enabled: false,
        }),
    ],
    [
      'paused on this site',
      (id: string) =>
        mockDocs.set(automationPath(id), {
          ...mockDocs.get(automationPath(id)),
          pausedHostIds: [SITE],
        }),
    ],
    [
      'taken off this site',
      (id: string) =>
        mockDocs.set(automationPath(id), {
          ...mockDocs.get(automationPath(id)),
          visibleTo: [`host:${SIBLING}`],
        }),
    ],
  ])('STOPS the people already inside when it is %s', async (_label, change) => {
    const [path, enrollment] = await enrollOne()
    change('org-auto-1')
    mockSent = []

    const ending = await resumeFlowEnrollment(enrollment, mockDocRef(path), {
      nowMs: NOW,
    })

    expect(ending).toBe('stopped')
    expect(mockSent).toEqual([])
    expect(enrollmentsOf(SITE)).toEqual([])
    const stopped = siteActivity(SITE).find((row) =>
      String(row.action).startsWith('Flow stopped mid-wait'),
    )
    expect(stopped?.target?.type).toBe('orgAutomation')
  })

  it('stops a site that has left the organization', async () => {
    const [path, enrollment] = await enrollOne()
    mockSent = []

    const ending = await resumeFlowEnrollment(
      { ...enrollment, orgId: 'some-other-org' },
      mockDocRef(path),
      { nowMs: NOW },
    )

    expect(ending).toBe('stopped')
    expect(mockSent).toEqual([])
  })

  it('wakes on the awaited event, like a site action’s wait', async () => {
    seedOrgAutomation('org-auto-1', {
      steps: [
        { type: 'waitForEvent', eventName: 'booking', timeoutMinutes: 60 * 24 },
        { type: 'sendEmail', subject: 'Thanks for booking', body: 'x' },
      ],
    })
    await runEventActions(SITE, 'formSubmission', { email: 'a@b.co' })
    expect(enrollmentsOf(SITE)).toHaveLength(1)
    expect(mockSent).toEqual([])

    await runEventActions(SITE, 'booking', { email: 'a@b.co' })

    expect(mockSent.map((message) => message.subject)).toEqual([
      'Thanks for booking',
    ])
    expect(enrollmentsOf(SITE)).toEqual([])
  })
})

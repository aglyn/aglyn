/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom.
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
 * AN AUTOMATION'S CRM STEPS, RUN BY THE ENGINE THROUGH THE CRM (AGL-2605,
 * AGL-3080).
 *
 * The workflows engine runs an automation and the CRM runs its five steps —
 * `setContactStage`, `addContactTag`, `assignContactOwner`, `createCrmTask`
 * and `logCrmActivity` — and files an automation's email on the contact's
 * timeline; the two meet at the platform's server-step and record-timeline
 * seams and import nothing of each other. Each plugin's spec holds its own
 * half against a stand-in for the other. This one runs both REAL halves, the
 * way the console boots them — its own server-declarations manifest, then a
 * page's dispatch through the host-event listeners — over one Firestore
 * double:
 *
 *  1. **The person is the event's.** `contactId` resolves by a read, `email`
 *     through the address index, and a document the id names but this site
 *     cannot see is treated as absent; when nothing resolves the step writes
 *     nothing and the run says why.
 *  2. **Facet writes are dotted `update()`s inside the site's facet**, never
 *     top-level fields.
 *  3. **A task or an activity is stamped with the create path's scope**, so a
 *     record an automation made is visible to exactly the sites a record a
 *     person made would be.
 *  4. **A stage set by an automation is a stage change**, raised by the engine
 *     under its nesting cap; a stage set to what it already is announces
 *     nothing.
 *  5. **The CRM's plan gate** refuses every step into the run history.
 *  6. **An email to the contact is filed on the contact's timeline**, tagged
 *     so the delivery webhook finds it — and only that email.
 *
 * ⚑ It imports no plugin: an app may not depend on one.
 */

const MOCK_HOST_ID = 'site-1'
const MOCK_GROUP_ID = 'group-1'
const MOCK_ORG_ID = 'org-1'
const DAY_MS = 24 * 60 * 60 * 1000

/** Every document, by full path. */
let store: Record<string, Record<string, any>> = {}
/** Every `update()`, in order, by the path it wrote. */
let updates: { path: string; data: Record<string, any> }[] = []
/** The owning org's billing doc — the plan both halves read. */
let mockOrg: Record<string, any> = { plan: 'business' }
/** Activities the record already carries, as the ceiling's aggregate answers. */
let mockActivityCount = 0
/** Every owner assignment handed to the assignment helper (AGL-2618), in order. */
let mockAssignments: Record<string, any>[] = []
/** What the helper answers the next assignment with. */
let mockAssignment: Record<string, any> = {}
/** Every message handed to the mail provider, and what it answers. */
let mockSentMessages: Record<string, any>[] = []
let mockSendResult: Record<string, any> = { sent: true }
let minted = 0

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    delete: () => ({ __delete: true }),
  },
}))

const readField = (data: Record<string, any> | undefined, field: string) =>
  field.split('.').reduce<any>((value, key) => value?.[key], data)

const lastSegment = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const snapshotOf = (path: string): any => ({
  id: lastSegment(path),
  exists: store[path] !== undefined,
  data: () => store[path],
  get: (field: string) => readField(store[path], field),
  ref: docRef(path),
})

/** A patch applied the way Firestore applies one: increments add up. */
const applyPatch = (existing: Record<string, any>, patch: Record<string, any>) => {
  const next = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    next[key] =
      value && typeof value === 'object' && '__increment' in value
        ? Number(existing[key] ?? 0) + value.__increment
        : value
  }
  return next
}

function docRef(path: string): any {
  return {
    id: lastSegment(path),
    path,
    get: async () => snapshotOf(path),
    set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
      store[path] = applyPatch(options?.merge ? (store[path] ?? {}) : {}, data)
    },
    update: async (data: Record<string, any>) => {
      updates.push({ path, data })
      store[path] = applyPatch(store[path] ?? {}, data)
    },
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get parent() {
      return mockCollectionRef(path.slice(0, path.lastIndexOf('/')))
    },
  }
}

/** The documents directly under a collection path. */
const childrenOf = (path: string) =>
  Object.keys(store).filter(
    (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
  )

function mockCollectionRef(path: string): any {
  const query = (matchers: ((data: Record<string, any>) => boolean)[]): any => ({
    where: (field: string, op: string, value: any) =>
      query([
        ...matchers,
        op === 'array-contains-any'
          ? (data) => {
              const held = readField(data, field)
              return Array.isArray(held) && value.some((token: unknown) => held.includes(token))
            }
          : (data) => readField(data, field) === value,
      ]),
    limit: () => query(matchers),
    orderBy: () => query(matchers),
    select: () => query(matchers),
    get: async () => {
      const docs = childrenOf(path)
        .filter((key) => matchers.every((matcher) => matcher(store[key])))
        .map(snapshotOf)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: childrenOf(path).length }) }),
    }),
  })
  return {
    ...query([]),
    id: lastSegment(path),
    path,
    // Minted when no id is given, as the SDK mints one — the email row's id
    // is allocated before the send so it can ride the message (AGL-2615).
    doc: (id?: string) => docRef(`${path}/${id ?? `minted-${(minted += 1)}`}`),
    add: async (data: Record<string, any>) => {
      const id = `auto-${(minted += 1)}`
      store[`${path}/${id}`] = { ...data }
      return docRef(`${path}/${id}`)
    },
    get parent() {
      const parentPath = path.slice(0, path.lastIndexOf('/'))
      return parentPath ? docRef(parentPath) : null
    },
  }
}

const mockFirestore: any = {
  collection: (name: string) => mockCollectionRef(name),
  /*
   * The run meter (AGL-3472) seeds the workspace's run counter in a
   * transaction and counts each run on the site's and the workspace's
   * counters in one batch — both over this same store, with their writes
   * applied at commit, as Firestore applies them.
   */
  runTransaction: async (body: (transaction: any) => Promise<unknown>) => {
    const writes: Array<() => Promise<void>> = []
    const result = await body({
      get: (ref: any) => ref.get(),
      getAll: (...refs: any[]) => Promise.all(refs.map((ref) => ref.get())),
      set: (ref: any, data: Record<string, any>, options?: { merge?: boolean }) => {
        writes.push(() => ref.set(data, options))
      },
      update: (ref: any, data: Record<string, any>) => {
        writes.push(() => ref.update(data))
      },
    })
    for (const write of writes) await write()
    return result
  },
  batch: () => {
    const writes: Array<() => Promise<void>> = []
    return {
      set: (ref: any, data: Record<string, any>, options?: { merge?: boolean }) => {
        writes.push(() => ref.set(data, options))
      },
      commit: async () => {
        for (const write of writes) await write()
      },
    }
  },
}

const mockRecomputeNextActivity = jest.fn(async () => ({ records: 0, missing: 0 }))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
  getOrgForHost: async () => ({ orgId: MOCK_ORG_ID, org: mockOrg }),
  resolveOrgIdForHost: async () => MOCK_ORG_ID,
  consentGroupForSite: async () => ({
    hostId: MOCK_HOST_ID,
    groupId: MOCK_GROUP_ID,
    name: null,
    hostIds: [MOCK_HOST_ID],
    declared: false,
  }),
  // `{ ref, query }`, with the query SCOPED the way the real helper scopes
  // it — a double that answered the unscoped collection would let the email
  // fallback reach a contact the site may not see.
  orgDataQueryForHost: async (_hostId: string, name: string) => ({
    ref: mockCollectionRef(`orgs/${MOCK_ORG_ID}/${name}`),
    query: mockCollectionRef(`orgs/${MOCK_ORG_ID}/${name}`).where('visibleTo', 'array-contains-any', [
      'org',
      `host:${MOCK_HOST_ID}`,
    ]),
  }),
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    mockCollectionRef(`orgs/${MOCK_ORG_ID}/${name}`),
  // The list-fields restamp (AGL-3321) is `crm-records`' own spec's; here a no-op.
  restampCrmListFieldsAt: async () => 'current',
  // The per-record activity ceiling's one read (AGL-2611), answered from the
  // fixture so a case can stand a record at the ceiling without seeding five
  // thousand documents.
  countCrmActivitiesForRecord: async () => mockActivityCount,
  // The `nextTaskAtMs` writer (AGL-2661): a spy, the recompute is the data layer's suite.
  recomputeCrmNextTaskAt: (...args: unknown[]) => mockRecomputeNextActivity(...(args as [])),
  // The email row's reference and write (AGL-2615), faithful to the real
  // pair: a minted document under the org's activities, set with the server
  // clock on both stamps.
  newCrmActivityRef: (_firestore: unknown, orgId: string) =>
    mockCollectionRef(`orgs/${orgId}/crmActivities`).doc(),
  writeCrmEmailActivity: async (ref: any, activity: Record<string, any>) =>
    ref.set({ ...activity, createdAt: 'server-timestamp', updatedAt: 'server-timestamp' }),
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async () => undefined,
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  flowEmailRefusal: async () => null,
  // A reply to the person's own act is transactional (AGL-3458): it asks
  // only the suppression lists, which hold nobody here.
  filterSendableForHost: async (_hostId: string, emails: string[]) => emails,
  hostDisplayName: (_host: unknown, hostId: string) => hostId,
  enrollListMember: async () => undefined,
}))

jest.mock('../../../libs/plugins/crm/src/lib/server/assign-contact-owner', () => ({
  __esModule: true,
  OWNER_ASSIGNMENT_REFUSALS: {
    'no-org': 'this site has no organization',
    'no-contact': 'the contact no longer exists',
    'no-rule': 'no assignment rule matched and the site has no default owner',
    'empty-pool': 'the round-robin pool has nobody on the roster in it',
    'not-a-member': 'the owner named is not on the team',
    failed: 'the owner could not be assigned',
  },
  reassignContactOwner: async (input: Record<string, any>) => {
    mockAssignments.push(input)
    return mockAssignment
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  isDeferrableSendResult: () => false,
  sendEmail: async (message: Record<string, any>) => {
    mockSentMessages.push(message)
    return mockSendResult
  },
  sendFailureReason: (result: { sent?: boolean; reason?: string } | null) =>
    !result || result.sent ? null : (result.reason ?? null),
}))

import {
  CRM_ACTIVITIES_PER_RECORD_CEILING,
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
} from '@aglyn/aglyn/app-utils/crm'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import {
  declaredServerSteps,
  registeredServerStepExecutor,
} from '@aglyn/aglyn/plugin-manager/plugin-server-steps'
import { dispatchHostAutomation } from '@aglyn/tenant-runtime/host-event-listeners'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'

const CRM_STEPS = [
  'setContactStage',
  'addContactTag',
  'assignContactOwner',
  'createCrmTask',
  'logCrmActivity',
] as const

const hostPath = `hosts/${MOCK_HOST_ID}`
const contactPath = `orgs/${MOCK_ORG_ID}/contacts/contact-1`
const facetPath = (field: string) => `facets.${MOCK_GROUP_ID}.${field}`

/** Seeds the one action a case dispatches, plus any listening for what it raises. */
const seedActions = (step: Record<string, any>, ...listening: Array<{ id: string; data: Record<string, any> }>) => {
  store[`${hostPath}/actions/action-1`] = {
    name: 'Work the lead',
    enabled: true,
    trigger: { event: 'formSubmission' },
    steps: [step],
  }
  for (const { id, data } of listening) store[`${hostPath}/actions/${id}`] = data
}

/** Dispatches action-1 on a form submission carrying `payload`. */
const run = (payload: Record<string, string | number | boolean>) =>
  dispatchHostAutomation(MOCK_HOST_ID, 'action-1', 'formSubmission', payload)

/** The rows the run history holds, oldest first. */
const history = () => childrenOf(`${hostPath}/activity`).map((key) => store[key])

/** The documents of one org collection. */
const orgRows = (name: string): Record<string, any>[] =>
  childrenOf(`orgs/${MOCK_ORG_ID}/${name}`).map((key) => ({ $id: lastSegment(key), ...store[key] }))

/** The updates the run made to the contact. */
const contactUpdates = () => updates.filter((entry) => entry.path === contactPath).map((entry) => entry.data)

beforeAll(async () => {
  await registerPluginServerDeclarations()
})

beforeEach(() => {
  store = {}
  updates = []
  minted = 0
  mockOrg = { plan: 'business' }
  mockActivityCount = 0
  mockAssignments = []
  mockAssignment = {
    outcome: 'assigned',
    ownerUid: 'uid-sam',
    by: 'member',
    leadMirrored: false,
    notified: true,
  }
  mockSentMessages = []
  mockSendResult = { sent: true }
  mockRecomputeNextActivity.mockClear()
  store[hostPath] = { orgId: MOCK_ORG_ID }
  store[`orgs/${MOCK_ORG_ID}`] = mockOrg
  store[`orgs/${MOCK_ORG_ID}/members/uid-sam`] = { email: 'sam@example.com', role: 'editor' }
  store[contactPath] = {
    email: 'ada@example.com',
    visibleTo: [`host:${MOCK_HOST_ID}`],
    facets: {
      [MOCK_GROUP_ID]: {
        lifecycleStage: 'lead',
        ownerUid: 'uid-owner',
        companyId: 'company-1',
        tags: ['newsletter'],
      },
    },
  }
})

describe('the CRM steps, in this console', () => {
  it('are each declared by the CRM, and run by the CRM once the boot has run', () => {
    for (const type of CRM_STEPS) {
      expect(declaredServerSteps().find((row) => row.type === type)?.pluginId).toBe('crm')
      expect(registeredServerStepExecutor(type)?.pluginId).toBe('crm')
    }
  })
})

describe('finding the person (claim 1)', () => {
  it('resolves by contactId', async () => {
    seedActions({ type: 'addContactTag', tag: 'vip' })
    await run({ contactId: 'contact-1' })
    expect(contactUpdates()).toHaveLength(1)
  })

  it('resolves an alternate address through the email index to the survivor (AGL-2633)', async () => {
    // Two records merged: the survivor's `email` is the work address, and the
    // personal one lives only in the index and `alternateEmails`.
    store[contactPath]['alternateEmails'] = ['ada@gmail.com']
    store[`orgs/${MOCK_ORG_ID}/emailIndex/${personKey('ada@gmail.com')}`] = {
      email: 'ada@gmail.com',
      contactId: 'contact-1',
    }
    seedActions({ type: 'addContactTag', tag: 'vip' })
    await run({ email: 'ada@gmail.com' })
    expect(contactUpdates()).toHaveLength(1)
  })

  it('treats an alternate whose survivor this site cannot see as absent', async () => {
    store[contactPath]['visibleTo'] = ['host:other-site']
    store[`orgs/${MOCK_ORG_ID}/emailIndex/${personKey('ada@gmail.com')}`] = {
      email: 'ada@gmail.com',
      contactId: 'contact-1',
    }
    seedActions({ type: 'addContactTag', tag: 'vip' })
    await run({ email: 'ada@gmail.com' })
    expect(contactUpdates()).toHaveLength(0)
    expect(history()[0]).toMatchObject({ result: 'failed' })
    expect(history()[0].action).toContain('no contact or lead this site can see for ada@gmail.com')
  })

  it('falls back to the email when the id names nothing this site can see', async () => {
    // The document exists but is scoped to a sibling site: the id lookup must
    // answer "absent", exactly as the scoped query would — and the address
    // lookup is scoped too, so it also finds nothing here.
    store[contactPath]['visibleTo'] = ['host:other-site']
    seedActions({ type: 'addContactTag', tag: 'vip' })
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(contactUpdates()).toHaveLength(0)
    expect(history()[0].action).toContain('no contact or lead this site can see for contact-1')
  })

  it('resolves by email, normalized, for an event that carries no contactId', async () => {
    seedActions({ type: 'addContactTag', tag: 'vip' })
    await run({ email: 'Ada@Example.com' })
    expect(contactUpdates()).toHaveLength(1)
  })

  it('writes nothing and says why when the event names nobody', async () => {
    seedActions({ type: 'setContactStage', lifecycleStage: 'customer' })
    await run({ path: '/pricing' })
    expect(contactUpdates()).toHaveLength(0)
    expect(history()[0]).toMatchObject({ result: 'failed' })
    expect(history()[0].action).toContain('the event names no contact')
  })

  it('writes nothing and says why when the address is not a contact', async () => {
    seedActions({ type: 'createCrmTask', title: 'Call', kind: 'call', dueInDays: 1 })
    await run({ email: 'nobody@example.com' })
    expect(orgRows('crmTasks')).toEqual([])
    expect(history()[0].action).toContain('no contact or lead this site can see for nobody@example.com')
  })
})

describe('facet writes (claim 2)', () => {
  it('sets the lifecycle stage inside the site’s facet', async () => {
    seedActions({ type: 'setContactStage', lifecycleStage: 'customer' })
    await run({ email: 'ada@example.com' })
    expect(contactUpdates()).toHaveLength(1)
    expect(contactUpdates()[0][facetPath('lifecycleStage')]).toBe('customer')
    expect(Object.keys(contactUpdates()[0])).not.toContain('lifecycleStage')
    expect(history()[0]).toMatchObject({ result: 'succeeded', summary: 'set stage Customer' })
  })

  it('adds a tag with arrayUnion, trimmed, and keeps the ones beside it', async () => {
    seedActions({ type: 'addContactTag', tag: '  vip ' })
    await run({ email: 'ada@example.com' })
    expect(contactUpdates()[0][facetPath('tags')]).toEqual({ __arrayUnion: ['vip'] })
    expect(history()[0].summary).toBe('tagged vip')
  })

  it('assigns an owner named by address, resolved to the member’s uid, through the assignment', async () => {
    seedActions({ type: 'assignContactOwner', ownerEmail: 'Sam@Example.com' })
    await run({ email: 'ada@example.com' })
    expect(mockAssignments).toEqual([
      { hostId: MOCK_HOST_ID, contactId: 'contact-1', email: 'ada@example.com', assign: { memberUid: 'uid-sam' } },
    ])
    expect(history()[0].summary).toBe('assigned owner sam@example.com')
  })

  it('assigns an owner named by uid, once the roster has them', async () => {
    // A member whose document carries no address: nameable by uid alone,
    // which is the case the uid slot exists for.
    store[`orgs/${MOCK_ORG_ID}/members/uid-direct`] = { displayName: 'Grace' }
    seedActions({ type: 'assignContactOwner', ownerUid: 'uid-direct' })
    await run({ email: 'ada@example.com' })
    expect(mockAssignments[0].assign).toEqual({ memberUid: 'uid-direct' })
  })

  it('refuses a uid nobody on the roster has, and asks for no assignment', async () => {
    seedActions({ type: 'assignContactOwner', ownerUid: 'uid-stranger' })
    await run({ email: 'ada@example.com' })
    expect(mockAssignments).toHaveLength(0)
    expect(history()[0]).toMatchObject({ result: 'failed' })
    expect(history()[0].action).toContain('no team member with the id')
  })

  it('reads a uid typed into the address slot as a uid', async () => {
    store[`orgs/${MOCK_ORG_ID}/members/uid-direct`] = { displayName: 'Grace' }
    seedActions({ type: 'assignContactOwner', ownerEmail: 'uid-direct' })
    await run({ email: 'ada@example.com' })
    expect(mockAssignments[0].assign).toEqual({ memberUid: 'uid-direct' })
  })

  it('refuses an address nobody on the roster has, and asks for no assignment', async () => {
    seedActions({ type: 'assignContactOwner', ownerEmail: 'ghost@example.com' })
    await run({ email: 'ada@example.com' })
    expect(mockAssignments).toHaveLength(0)
    expect(history()[0]).toMatchObject({ result: 'failed' })
    expect(history()[0].action).toContain('no team member with the address')
  })

  it('rotates through the pool when the step says round robin, and records who got it', async () => {
    seedActions({ type: 'assignContactOwner', roundRobin: true })
    mockAssignment = { outcome: 'assigned', ownerUid: 'uid-kim', by: 'roundRobin', leadMirrored: false, notified: true }
    await run({ email: 'ada@example.com' })
    expect(mockAssignments[0].assign).toEqual({ roundRobin: true })
    expect(history()[0].summary).toBe('assigned owner round robin → uid-kim')
  })

  it('records the assignment’s refusal as the step’s failure', async () => {
    seedActions({ type: 'assignContactOwner', roundRobin: true })
    mockAssignment = { outcome: 'none', reason: 'empty-pool' }
    await run({ email: 'ada@example.com' })
    expect(history()[0]).toMatchObject({ result: 'failed' })
    expect(history()[0].action).toContain('the round-robin pool has nobody')
  })

  it('reports an owner the contact already had as already', async () => {
    seedActions({ type: 'assignContactOwner', ownerEmail: 'sam@example.com' })
    mockAssignment = { outcome: 'unchanged', ownerUid: 'uid-sam' }
    await run({ email: 'ada@example.com' })
    expect(history()[0].summary).toBe('assigned owner sam@example.com (already)')
  })
})

describe('records beside the contact (claim 3)', () => {
  it('creates a task in the site’s scope, dated ahead, assigned to the contact’s owner', async () => {
    const before = Date.now()
    seedActions({ type: 'createCrmTask', title: ' Call them back ', kind: 'call', dueInDays: 2 })
    await run({ email: 'ada@example.com' })
    const [task] = orgRows('crmTasks')
    expect(task).toMatchObject({
      title: 'Call them back',
      kind: 'call',
      priority: 'normal',
      status: 'open',
      // The step named nobody, so the follow-up goes to whoever holds the relationship.
      assigneeUid: 'uid-owner',
      createdByUid: '',
      sourceActionId: 'action-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      hostId: MOCK_HOST_ID,
      visibleTo: [`host:${MOCK_HOST_ID}`],
      createdAt: 'server-timestamp',
    })
    expect(task.dueAtMs).toBeGreaterThanOrEqual(before + 2 * DAY_MS)
    expect(task.dueAtMs).toBeLessThanOrEqual(Date.now() + 2 * DAY_MS)
    // The reminder a person's task gets by default (AGL-2659): its due time.
    expect(task.remindAtMs).toBe(task.dueAtMs)
    expect(history()[0].summary).toBe('created task Call them back')
    // The contact and company it names carry `nextTaskAtMs` (AGL-2661).
    expect(mockRecomputeNextActivity).toHaveBeenCalledWith(expect.anything(), MOCK_ORG_ID, [
      { contactId: 'contact-1', companyId: 'company-1' },
    ])
  })

  it('files the task’s priority, with the org’s label beside each meaning (AGL-3517)', async () => {
    seedActions({ type: 'createCrmTask', title: 'Walk the site', kind: 'meeting', priority: 'high', dueInDays: 1 })
    await run({ email: 'ada@example.com' })
    expect(orgRows('crmTasks')[0]).toMatchObject({
      kind: 'meeting',
      typeLabel: 'Meeting',
      priority: 'high',
      priorityLabel: 'High',
      status: 'open',
      statusLabel: 'Not Started',
    })
  })

  it('logs which way a call went, and no direction on a kind that takes none (AGL-3517)', async () => {
    seedActions({ type: 'logCrmActivity', kind: 'call', body: 'They rang in', direction: 'inbound' })
    await run({ email: 'ada@example.com' })
    expect(orgRows('crmActivities')[0]).toMatchObject({ kind: 'call', direction: 'inbound' })
    seedActions({ type: 'logCrmActivity', kind: 'note', body: 'Noted', direction: 'inbound' })
    await run({ email: 'ada@example.com' })
    const note = orgRows('crmActivities').find((row) => row.kind === 'note')
    expect(note).toBeTruthy()
    expect(note).not.toHaveProperty('direction')
  })

  it('prefers the assignee the step names', async () => {
    seedActions({ type: 'createCrmTask', title: 'Send the deck', kind: 'email', dueInDays: 0, assigneeUid: 'uid-sam' })
    await run({ email: 'ada@example.com' })
    expect(orgRows('crmTasks')[0].assigneeUid).toBe('uid-sam')
  })

  it('assigns the task to the assignee named by address', async () => {
    seedActions({ type: 'createCrmTask', title: 'Send the deck', kind: 'email', dueInDays: 0, assigneeEmail: 'Sam@Example.com' })
    await run({ email: 'ada@example.com' })
    expect(orgRows('crmTasks')[0].assigneeUid).toBe('uid-sam')
  })

  it('creates no task for an assignee address nobody on the team has', async () => {
    // Named on purpose and unresolvable: an error, not a quiet fallback to
    // the contact's owner.
    seedActions({ type: 'createCrmTask', title: 'Send the deck', kind: 'email', dueInDays: 0, assigneeEmail: 'ghost@example.com' })
    await run({ email: 'ada@example.com' })
    expect(orgRows('crmTasks')).toEqual([])
    expect(history()[0]).toMatchObject({ result: 'failed' })
    expect(history()[0].action).toContain('no team member with the address')
  })

  it('stamps the org-wide scope when the org chose it', async () => {
    mockOrg = { plan: 'business', defaultResourceScope: 'org' }
    seedActions({ type: 'logCrmActivity', kind: 'note', body: 'Signed up' })
    await run({ email: 'ada@example.com' })
    expect(orgRows('crmActivities')[0].visibleTo).toEqual(['org'])
  })

  it('logs an activity with the automation as its source and no person as its author', async () => {
    seedActions({ type: 'logCrmActivity', kind: 'note', body: ' Came in via the pricing form ' })
    await run({ email: 'ada@example.com' })
    expect(orgRows('crmActivities')[0]).toMatchObject({
      kind: 'note',
      body: 'Came in via the pricing form',
      byUid: '',
      sourceActionId: 'action-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      hostId: MOCK_HOST_ID,
      visibleTo: [`host:${MOCK_HOST_ID}`],
    })
    expect(history()[0].summary).toBe('logged activity note')
  })

  it('refuses to log onto a record at the activity ceiling, and says so (AGL-2611)', async () => {
    mockActivityCount = CRM_ACTIVITIES_PER_RECORD_CEILING
    seedActions({ type: 'logCrmActivity', kind: 'note', body: 'One more' })
    await run({ email: 'ada@example.com' })
    expect(orgRows('crmActivities')).toEqual([])
    expect(history()[0]).toMatchObject({ result: 'failed' })
    expect(history()[0].action).toContain(CRM_ACTIVITY_LOG_FULL_MESSAGE)
    // BOTH SIDES: one under the ceiling still writes, so the refusal is the
    // boundary and not a step that refuses everything.
    mockActivityCount = CRM_ACTIVITIES_PER_RECORD_CEILING - 1
    await run({ email: 'ada@example.com' })
    expect(orgRows('crmActivities')).toHaveLength(1)
  })
})

describe('a stage change fans out (claim 4)', () => {
  const listening = (steps: Record<string, any>[], conditions?: Record<string, any>[]) => ({
    id: 'action-2',
    data: {
      name: 'Welcome the customer',
      enabled: true,
      trigger: { event: 'contactStageChanged', ...(conditions ? { conditions } : {}) },
      steps,
    },
  })

  it('runs the actions listening for contactStageChanged, with the change in their payload', async () => {
    seedActions(
      { type: 'setContactStage', lifecycleStage: 'customer' },
      listening([{ type: 'addContactTag', tag: 'became-customer' }], [
        { field: 'lifecycleStage', op: 'equals', value: 'customer' },
      ]),
    )
    await run({ email: 'ada@example.com' })
    // The stage write, then the tag the nested run wrote.
    expect(contactUpdates()).toHaveLength(2)
    expect(contactUpdates()[0][facetPath('lifecycleStage')]).toBe('customer')
    expect(contactUpdates()[1][facetPath('tags')]).toEqual({ __arrayUnion: ['became-customer'] })
    const nested = history().find((row) => row.trigger === 'contactStageChanged')
    expect(nested?.result).toBe('succeeded')
    expect(nested?.target).toMatchObject({ id: 'action-2' })
  })

  it('does not fan out, or write, a stage the contact already has', async () => {
    seedActions(
      { type: 'setContactStage', lifecycleStage: 'lead' },
      listening([{ type: 'addContactTag', tag: 'ran' }]),
    )
    await run({ email: 'ada@example.com' })
    expect(contactUpdates()).toHaveLength(0)
    expect(history().some((row) => row.trigger === 'contactStageChanged')).toBe(false)
    expect(history()[0]).toMatchObject({ result: 'succeeded', summary: 'set stage Lead (already)' })
  })
})

describe('the CRM’s plan gate (claim 5, AGL-2611)', () => {
  /*
   * REACHABLE ONLY THROUGH AN OVERRIDE: every plan that carries `actions` also
   * carries `crm`, and the plans without the suite run no server automations
   * at all. A staff override that withdraws the suite from a paid workspace
   * reaches it, and the step must say so rather than read as if it ran.
   */
  it('refuses every CRM step on an org whose suite was withdrawn, into the run history', async () => {
    mockOrg = { plan: 'business', entitlements: { features: { crm: false } } }
    seedActions({ type: 'setContactStage', lifecycleStage: 'customer' })
    await run({ email: 'ada@example.com' })
    expect(contactUpdates()).toHaveLength(0)
    expect(history()[0]).toMatchObject({ result: 'failed' })
    expect(history()[0].action).toContain('CRM steps require the Starter plan')
  })

  it('CONTROL: the same step on the plan as sold runs', async () => {
    seedActions({ type: 'setContactStage', lifecycleStage: 'customer' })
    await run({ email: 'ada@example.com' })
    expect(contactUpdates()).toHaveLength(1)
    expect(history()[0].result).not.toBe('failed')
  })

  it('never reaches a stock Free or Starter workspace — the actions gate answers first', async () => {
    for (const plan of ['free', 'starter']) {
      mockOrg = { plan }
      seedActions({ type: 'setContactStage', lifecycleStage: 'customer' })
      await run({ email: 'ada@example.com' })
      expect(contactUpdates()).toHaveLength(0)
      expect(history()).toHaveLength(0)
    }
  })
})

describe('an email to the contact, on the contact’s timeline (claim 6, AGL-2615)', () => {
  const welcome = (extra: Record<string, any> = {}) =>
    seedActions({ type: 'sendEmail', subject: 'Welcome aboard', body: 'Glad to have you.', ...extra })

  it('files an email activity with the automation as its source, and tags the message with it', async () => {
    welcome()
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(mockSentMessages).toHaveLength(1)
    const [row] = orgRows('crmActivities')
    expect(row).toMatchObject({
      kind: 'email',
      subject: 'Welcome aboard',
      body: 'Glad to have you.',
      to: 'ada@example.com',
      direction: 'outbound',
      deliveryState: 'sent',
      byUid: '',
      sourceActionId: 'action-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      hostId: MOCK_HOST_ID,
      visibleTo: [`host:${MOCK_HOST_ID}`],
      createdAt: 'server-timestamp',
    })
    // The id on the row is the id on the message, which is how the delivery
    // webhook finds the row.
    expect(mockSentMessages[0].tags).toEqual([
      { name: 'orgId', value: MOCK_ORG_ID },
      { name: 'activityId', value: row.$id },
      { name: 'hostId', value: MOCK_HOST_ID },
    ])
    expect(history()[0].result).not.toBe('failed')
  })

  it('resolves the contact by address when the event carries no id', async () => {
    welcome()
    await run({ email: 'Ada@Example.com' })
    expect(orgRows('crmActivities')).toHaveLength(1)
  })

  it('files nothing when the message goes to somebody other than the contact', async () => {
    welcome({ toField: 'managerEmail' })
    await run({ contactId: 'contact-1', email: 'ada@example.com', managerEmail: 'boss@acme.com' })
    expect(mockSentMessages).toHaveLength(1)
    expect(mockSentMessages[0].to).toBe('boss@acme.com')
    expect(mockSentMessages[0].tags).toBeUndefined()
    expect(orgRows('crmActivities')).toEqual([])
  })

  it('files nothing when the provider refused the message', async () => {
    mockSendResult = { sent: false, reason: 'rejected' }
    welcome()
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(orgRows('crmActivities')).toEqual([])
  })

  it('files nothing when the address is nobody the site can see', async () => {
    delete store[contactPath]
    welcome()
    await run({ email: 'stranger@example.com' })
    expect(mockSentMessages).toHaveLength(1)
    expect(orgRows('crmActivities')).toEqual([])
  })

  it('still sends, untagged, and files nothing at the activity ceiling', async () => {
    mockActivityCount = CRM_ACTIVITIES_PER_RECORD_CEILING
    welcome()
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(mockSentMessages).toHaveLength(1)
    expect(mockSentMessages[0].tags).toBeUndefined()
    expect(orgRows('crmActivities')).toEqual([])
    expect(history()[0].result).not.toBe('failed')
  })

  it('still sends, untagged, and files nothing on an org whose suite was withdrawn', async () => {
    mockOrg = { plan: 'business', entitlements: { features: { crm: false } } }
    welcome()
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(mockSentMessages).toHaveLength(1)
    expect(mockSentMessages[0].tags).toBeUndefined()
    expect(orgRows('crmActivities')).toEqual([])
  })
})

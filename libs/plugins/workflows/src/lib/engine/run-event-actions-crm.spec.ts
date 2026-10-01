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
 * THE CRM STEPS OF AN ACTION RUN (AGL-2605).
 *
 * Five steps, one resolver, one scope. The claims a mocked Firestore can
 * hold them to:
 *
 *  1. **The person is the event's.** `contactId` resolves by a read, `email`
 *     by the scoped query, and a document the id names but this site cannot
 *     see is treated as absent — the address is tried next, and when nothing
 *     resolves the step writes nothing and the run says why.
 *  2. **Facet writes are dotted `update()`s inside the site's facet**, never
 *     top-level fields: a stage, a tag and an owner are one holder's
 *     business record on a row every site in the org shares.
 *  3. **A task or an activity is stamped with `crmScopeTokens`** — the
 *     contact create path's own scope expression — so a record an automation
 *     made is visible to exactly the sites a record a person made would be.
 *  4. **A stage set by an automation is a stage change.** `contactStageChanged`
 *     fans out to whatever listens, under the nesting guard, and a stage set
 *     to what it already is changes nothing and announces nothing.
 */

const HOST_ID = 'site-1'
const GROUP_ID = 'group-1'
const ORG_ID = 'o1'
const DAY_MS = 24 * 60 * 60 * 1000

/** Actions returned by the trigger query, filtered by `trigger.event`. */
let mockActions: { id: string; data: Record<string, any> }[] = []
/** The one contact the org holds, or null. */
let mockContact: { id: string; data: Record<string, any> } | null = null
/** `orgs/o1/members` — the roster an owner address resolves against. */
let mockMembers: Record<string, Record<string, any>> = {}
/** Auth accounts, uid → address, for the roster document that has none. */
/** The org's billing doc, as the run's gate read it. */
let mockOrg: Record<string, any> = { plan: 'business' }
/** Activities the record already carries, as the ceiling's aggregate answers. */
let mockActivityCount = 0
/** Every `update()` the run made on the contact, in order. */
let contactUpdates: Record<string, any>[] = []
/** Every `add()` by collection path. */
let added: Record<string, Record<string, any>[]> = {}
/** Everything added to `hosts/{id}/activity`. */
let mockActivity: Record<string, any>[] = []
/** How many times the contacts query ran (the email lookup). */
let emailLookups = 0
/** `orgs/{org}/emailIndex/{personKey}` → `{ email, contactId }` (AGL-2625). */
let mockEmailIndex: Record<string, Record<string, any>> = {}
/** Every owner assignment handed to the runtime helper (AGL-2618), in order. */
let assignments: Record<string, any>[] = []
/** The one lead the org holds (AGL-3458), keyed by its person key, or null. */
let mockLead: { id: string; data: Record<string, any> } | null = null
/** Every `update()` the run made on the lead, in order. */
let leadUpdates: Record<string, any>[] = []
/** Every LEAD owner assignment handed to the runtime helper, in order. */
let leadAssignments: Record<string, any>[] = []
/** What the helper answers the next assignment with. */
let mockAssignment: Record<string, any> = {
  outcome: 'assigned',
  ownerUid: 'uid-sam',
  by: 'member',
  leadMirrored: false,
  notified: true,
}

jest.mock('@aglyn/tenant-runtime/assign-contact-owner', () => ({
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
    assignments.push(input)
    return mockAssignment
  },
  // The lead's twin (AGL-3458): the owner lands on the lead, as the helper's
  // own spec holds; here, what the step hands it.
  reassignLeadOwner: async (input: Record<string, any>) => {
    leadAssignments.push(input)
    if (mockAssignment['outcome'] === 'assigned' && mockLead) {
      mockLead.data['ownerUid'] = mockAssignment['ownerUid']
    }
    return mockAssignment
  },
}))
/** Ids `doc()` minted without one, in order. */
let minted = 0
/** Every message handed to `sendEmail`, and what it answers. */
let sentMessages: Record<string, any>[] = []
let sendResult: Record<string, any> = { sent: true }

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
}))

const readField = (data: Record<string, any>, field: string) =>
  field.split('.').reduce<any>((value, key) => value?.[key], data)

const docSnapshot = (id: string, data: Record<string, any>) => ({
  id,
  exists: true,
  data: () => data,
  get: (field: string) => readField(data, field),
  ref: contactRef,
})

const missingSnapshot = (id: string) => ({
  id,
  exists: false,
  data: () => undefined,
  get: () => undefined,
})

/**
 * `update` only, because a dotted field path is a PATH to `update()` and a
 * literal key with dots in it to `set()`; a double offering both would let
 * a write of the wrong shape pass.
 */
const contactRef = {
  update: async (patch: Record<string, any>) => {
    contactUpdates.push(patch)
  },
}

/** The lead's document, recording what the run writes on it. */
const leadRef = (id: string): any => ({
  id,
  get: async () =>
    mockLead?.id === id ? docSnapshot(id, mockLead.data) : missingSnapshot(id),
  update: async (patch: Record<string, any>) => {
    leadUpdates.push(patch)
  },
})

const collectionHandle = (path: string): any => {
  const query = (
    matchers: ((data: Record<string, any>) => boolean)[],
  ): any => ({
    where: (field: string, op: string, value: unknown) =>
      query([
        ...matchers,
        op === 'array-contains-any'
          ? (data) => {
              const held = readField(data, field)
              return (
                Array.isArray(held) &&
                (value as unknown[]).some((token) => held.includes(token))
              )
            }
          : (data) => readField(data, field) === value,
      ]),
    orderBy: () => query(matchers),
    limit: () => query(matchers),
    get: async () => {
      const matches = (data: Record<string, any>) =>
        matchers.every((matcher) => matcher(data))
      if (path.endsWith('actions')) {
        const docs = mockActions
          .filter((entry) => matches(entry.data))
          .map((entry) => docSnapshot(entry.id, entry.data))
        return { docs, empty: docs.length === 0 }
      }
      if (path.endsWith('contacts')) {
        emailLookups += 1
        const docs =
          mockContact && matches(mockContact.data)
            ? [docSnapshot(mockContact.id, mockContact.data)]
            : []
        return { docs, empty: docs.length === 0 }
      }
      if (path.endsWith('members')) {
        const docs = Object.entries(mockMembers)
          .filter(([, data]) => matches(data))
          .map(([id, data]) => docSnapshot(id, data))
        return { docs, empty: docs.length === 0 }
      }
      return { docs: [], empty: true }
    },
  })
  return {
    ...query([]),
    // The org document a subcollection hangs off, so the address lookup can
    // find `emailIndex` beside `contacts` the way it does in production.
    get parent() {
      const parentPath = path.slice(0, path.lastIndexOf('/'))
      return parentPath
        ? { collection: (name: string) => collectionHandle(`${parentPath}/${name}`) }
        : null
    },
    // Minted when no id is given, as the SDK mints one — the email row's id
    // is allocated before the send so it can ride the message (AGL-2615).
    doc: (given?: string) => {
      const id = given ?? `minted-${(minted += 1)}`
      if (path.endsWith('leads')) {
        return {
          id,
          get: async () =>
            mockLead?.id === id
              ? { ...docSnapshot(id, mockLead.data), ref: leadRef(id) }
              : missingSnapshot(id),
          update: async (patch: Record<string, any>) => leadRef(id).update(patch),
        }
      }
      return {
        id,
        get: async () =>
          path.endsWith('contacts') && mockContact?.id === id
            ? docSnapshot(id, mockContact.data)
            : path.endsWith('members') && mockMembers[id]
              ? docSnapshot(id, mockMembers[id])
              : path.endsWith('emailIndex') && mockEmailIndex[id]
                ? docSnapshot(id, mockEmailIndex[id])
                : missingSnapshot(id),
        set: async (data: Record<string, any>) => {
          if (path.endsWith('emailIndex')) {
            mockEmailIndex[id] = { ...(mockEmailIndex[id] ?? {}), ...data }
            return
          }
          const key = path.split('/').at(-1) ?? path
          ;(added[key] ??= []).push({ ...data, $id: id })
        },
        collection: (name: string) => collectionHandle(`${path}/${id}/${name}`),
      }
    },
    add: async (data: Record<string, any>) => {
      if (path.endsWith('activity')) mockActivity.push(data)
      const key = path.split('/').at(-1) ?? path
      ;(added[key] ??= []).push(data)
      return { id: 'new' }
    },
  }
}

const mockRecomputeNextActivity = jest.fn(async () => ({ records: 0, missing: 0 }))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The list-fields restamp (AGL-3321) is `crm-records`' own spec's; here a no-op.
  restampCrmListFieldsAt: async () => 'current',
  restampCrmListFieldsOf: async () => ({ restamped: 0, current: 0, missing: 0 }),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => collectionHandle(name),
      }),
    }),
  },
  consentGroupForSite: async () => ({
    hostId: HOST_ID,
    groupId: GROUP_ID,
    name: null,
    hostIds: [HOST_ID],
    declared: false,
  }),
  getOrgForHost: async () => ({ orgId: ORG_ID, org: mockOrg }),
  // The per-record activity ceiling's one read (AGL-2611), answered from the
  // fixture so a case can stand a record at the ceiling without seeding
  // five thousand documents.
  countCrmActivitiesForRecord: async () => mockActivityCount,
  // The `nextTaskAtMs` writer (AGL-2661): a spy, the recompute is the admin library's suite.
  recomputeCrmNextTaskAt: (...args: unknown[]) => mockRecomputeNextActivity(...(args as [])),
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () =>
    collectionHandle(`orgs/${ORG_ID}/datasets`),
  // `{ ref, query }`, with the query SCOPED the way the real helper scopes
  // it — a double that answered the unscoped collection would let the
  // email fallback reach a contact the site may not see.
  orgDataQueryForHost: async (_hostId: string, name = 'contacts') => ({
    ref: collectionHandle(`orgs/${ORG_ID}/${name}`),
    query: collectionHandle(`orgs/${ORG_ID}/${name}`).where(
      'visibleTo',
      'array-contains-any',
      ['org', `host:${HOST_ID}`],
    ),
  }),
  resolveOrgIdForHost: async () => ORG_ID,
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  // A transactional reply's suppression check (AGL-3458): every address is
  // sendable here; `run-event-actions-flow.spec.ts` holds the refusal.
  filterSendableForHost: async (_hostId: string, emails: string[]) => emails,
  hostDisplayName: (host: Record<string, unknown> | undefined, hostId: string) =>
    String(host?.['displayName'] ?? '') || hostId,
  flowEmailRefusal: async () => null,
  enrollListMember: async () => undefined,
  // The email row's reference and write (AGL-2615), faithful to the real
  // pair: a minted document under the org's activities, set with the
  // server clock on both stamps.
  newCrmActivityRef: (_firestore: unknown, orgId: string) =>
    collectionHandle(`orgs/${orgId}/crmActivities`).doc(),
  writeCrmEmailActivity: async (ref: any, activity: Record<string, any>) =>
    ref.set({
      ...activity,
      createdAt: 'server-timestamp',
      updatedAt: 'server-timestamp',
    }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, any>) => {
    sentMessages.push(message)
    return sendResult
  },
  sendFailureReason: (result: { sent?: boolean; reason?: string } | null) =>
    !result || result.sent ? null : (result.reason ?? null),
}))

import {
  CRM_ACTIVITIES_PER_RECORD_CEILING,
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
} from '@aglyn/aglyn/app-utils/crm'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import type { HostActionStep } from '@aglyn/aglyn/app-utils/actions'
import { CRM_ACTION_STEP_TYPES, isCrmActionStep } from './crm-action-steps'
import { HOST_ACTION_STEP_OUTCOMES } from '../model/step-outcomes'
import { runEventActions } from './run-event-actions'

/** An action on `formSubmission` carrying one CRM step. */
const acting = (step: Record<string, any>, event = 'formSubmission') => ({
  id: 'action-1',
  data: {
    name: 'Work the lead',
    enabled: true,
    trigger: { event },
    steps: [step],
  },
})

const run = (payload: Record<string, string | number | boolean>) =>
  runEventActions(HOST_ID, 'formSubmission', payload)

const facetPath = (field: string) => `facets.${GROUP_ID}.${field}`

beforeEach(() => {
  mockActions = []
  mockActivity = []
  contactUpdates = []
  mockLead = null
  leadUpdates = []
  leadAssignments = []
  added = {}
  emailLookups = 0
  mockEmailIndex = {}
  assignments = []
  mockAssignment = {
    outcome: 'assigned',
    ownerUid: 'uid-sam',
    by: 'member',
    leadMirrored: false,
    notified: true,
  }
  minted = 0
  sentMessages = []
  sendResult = { sent: true }
  mockMembers = { 'uid-sam': { email: 'sam@example.com', role: 'editor' } }
  mockOrg = { plan: 'business' }
  mockActivityCount = 0
  mockContact = {
    id: 'contact-1',
    data: {
      email: 'ada@example.com',
      visibleTo: [`host:${HOST_ID}`],
      facets: {
        [GROUP_ID]: {
          lifecycleStage: 'lead',
          ownerUid: 'uid-owner',
          companyId: 'company-1',
          tags: ['newsletter'],
        },
      },
    },
  }
})

describe('finding the person (claim 1)', () => {
  it('resolves by contactId with a read, not the email query', async () => {
    mockActions = [acting({ type: 'addContactTag', tag: 'vip' })]

    await run({ contactId: 'contact-1' })

    expect(emailLookups).toBe(0)
    expect(contactUpdates).toHaveLength(1)
  })

  it('resolves an alternate address through the email index to the survivor (AGL-2633)', async () => {
    // Two records merged: the survivor's `email` is the work address, and
    // the personal one lives only in the index and `alternateEmails`.
    mockContact!.data['alternateEmails'] = ['ada@gmail.com']
    mockEmailIndex[personKey('ada@gmail.com')!] = {
      email: 'ada@gmail.com',
      contactId: 'contact-1',
    }
    mockActions = [acting({ type: 'addContactTag', tag: 'vip' })]

    await run({ email: 'ada@gmail.com' })

    // The index answered; the `email ==` query, which could not have, never ran.
    expect(emailLookups).toBe(0)
    expect(contactUpdates).toHaveLength(1)
  })

  it('treats an alternate whose survivor this site cannot see as absent', async () => {
    mockContact!.data['visibleTo'] = ['host:other-site']
    mockContact!.data['alternateEmails'] = ['ada@gmail.com']
    mockEmailIndex[personKey('ada@gmail.com')!] = {
      email: 'ada@gmail.com',
      contactId: 'contact-1',
    }
    mockActions = [acting({ type: 'addContactTag', tag: 'vip' })]

    await run({ email: 'ada@gmail.com' })

    expect(contactUpdates).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('no contact or lead this site can see for ada@gmail.com')
  })

  it('falls back to the email when the id names nothing this site can see', async () => {
    // The document exists but is scoped to a sibling site: the id lookup
    // must answer "absent", exactly as the scoped query would.
    mockContact!.data['visibleTo'] = ['host:other-site']
    mockActions = [acting({ type: 'addContactTag', tag: 'vip' })]

    await run({ contactId: 'contact-1', email: 'ada@example.com' })

    // The email query is scoped too, so it also finds nothing here…
    expect(emailLookups).toBe(1)
    expect(contactUpdates).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain(
      'no contact or lead this site can see for contact-1',
    )
  })

  it('resolves by email for an event that carries no contactId', async () => {
    mockActions = [acting({ type: 'addContactTag', tag: 'vip' })]

    await run({ email: 'Ada@Example.com' })

    // Normalized before the query, so the address the row holds matches.
    expect(contactUpdates).toHaveLength(1)
  })

  it('writes nothing and says why when the event names nobody', async () => {
    mockActions = [acting({ type: 'setContactStage', lifecycleStage: 'customer' })]

    await run({ path: '/pricing' })

    expect(contactUpdates).toHaveLength(0)
    expect(added['crmTasks']).toBeUndefined()
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('the event names no contact')
  })

  it('writes nothing and says why when the address is not a contact', async () => {
    mockContact = null
    mockActions = [acting({ type: 'createCrmTask', title: 'Call', kind: 'call', dueInDays: 1 })]

    await run({ email: 'nobody@example.com' })

    expect(added['crmTasks']).toBeUndefined()
    expect(mockActivity[0].action).toContain(
      'no contact or lead this site can see for nobody@example.com',
    )
  })
})

describe('facet writes (claim 2)', () => {
  it('sets the lifecycle stage inside the site’s facet', async () => {
    mockActions = [acting({ type: 'setContactStage', lifecycleStage: 'customer' })]

    await run({ email: 'ada@example.com' })

    expect(contactUpdates).toHaveLength(1)
    expect(contactUpdates[0][facetPath('lifecycleStage')]).toBe('customer')
    expect(Object.keys(contactUpdates[0])).not.toContain('lifecycleStage')
    expect(mockActivity.at(-1)?.summary).toBe('set stage Customer')
  })

  it('adds a tag with arrayUnion, trimmed, and keeps the ones beside it', async () => {
    mockActions = [acting({ type: 'addContactTag', tag: '  vip ' })]

    await run({ email: 'ada@example.com' })

    expect(contactUpdates[0][facetPath('tags')]).toEqual({
      __arrayUnion: ['vip'],
    })
    expect(mockActivity.at(-1)?.summary).toBe('tagged vip')
  })

  /*
   * The owner is written by the runtime's one assignment (AGL-2618), which
   * moves the pool's pointer, mirrors the lead and tells the owner; what
   * this step owes it is the resolved member, or the rotation, for the
   * person the event names.
   */
  it('assigns an owner named by address, resolved to the member’s uid, through the assignment', async () => {
    mockActions = [acting({ type: 'assignContactOwner', ownerEmail: 'Sam@Example.com' })]

    await run({ email: 'ada@example.com' })

    expect(assignments).toEqual([
      { hostId: HOST_ID, contactId: 'contact-1', email: 'ada@example.com', assign: { memberUid: 'uid-sam' } },
    ])
    expect(contactUpdates).toHaveLength(0)
    expect(mockActivity.at(-1)?.summary).toBe('assigned owner sam@example.com')
  })

  it('assigns an owner named by uid, once the roster has them', async () => {
    // A member whose document carries no address: nameable by uid alone,
    // which is the case the uid slot exists for.
    mockMembers = { 'uid-direct': { displayName: 'Grace' } }
    mockActions = [acting({ type: 'assignContactOwner', ownerUid: 'uid-direct' })]

    await run({ email: 'ada@example.com' })

    expect(assignments[0].assign).toEqual({ memberUid: 'uid-direct' })
  })

  it('refuses a uid nobody on the roster has, and asks for no assignment', async () => {
    mockMembers = {}
    mockActions = [acting({ type: 'assignContactOwner', ownerUid: 'uid-stranger' })]

    await run({ email: 'ada@example.com' })

    expect(assignments).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('no team member with the id')
  })

  it('reads a uid typed into the address slot as a uid', async () => {
    mockMembers = { 'uid-direct': { displayName: 'Grace' } }
    mockActions = [acting({ type: 'assignContactOwner', ownerEmail: 'uid-direct' })]

    await run({ email: 'ada@example.com' })

    expect(assignments[0].assign).toEqual({ memberUid: 'uid-direct' })
  })

  it('refuses an address nobody on the roster has, and asks for no assignment', async () => {
    mockActions = [acting({ type: 'assignContactOwner', ownerEmail: 'ghost@example.com' })]

    await run({ email: 'ada@example.com' })

    expect(assignments).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('no team member with the address')
  })

  it('rotates through the pool when the step says round robin, and records who got it', async () => {
    mockActions = [acting({ type: 'assignContactOwner', roundRobin: true })]
    mockAssignment = { outcome: 'assigned', ownerUid: 'uid-kim', by: 'roundRobin', leadMirrored: false, notified: true }

    await run({ email: 'ada@example.com' })

    expect(assignments).toEqual([
      { hostId: HOST_ID, contactId: 'contact-1', email: 'ada@example.com', assign: { roundRobin: true } },
    ])
    expect(mockActivity.at(-1)?.summary).toBe('assigned owner round robin → uid-kim')
  })

  it('records the assignment’s refusal as the step’s failure', async () => {
    mockActions = [acting({ type: 'assignContactOwner', roundRobin: true })]
    mockAssignment = { outcome: 'none', reason: 'empty-pool' }

    await run({ email: 'ada@example.com' })

    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('the round-robin pool has nobody')
  })

  it('reports an owner the contact already had as already', async () => {
    mockActions = [acting({ type: 'assignContactOwner', ownerEmail: 'sam@example.com' })]
    mockAssignment = { outcome: 'unchanged', ownerUid: 'uid-sam' }

    await run({ email: 'ada@example.com' })

    expect(mockActivity.at(-1)?.summary).toBe('assigned owner sam@example.com (already)')
  })
})

describe('records beside the contact (claim 3)', () => {
  it('creates a task in the site’s scope, dated ahead, assigned to the contact’s owner', async () => {
    const before = Date.now()
    mockActions = [
      acting({ type: 'createCrmTask', title: ' Call them back ', kind: 'call', dueInDays: 2 }),
    ]

    await run({ email: 'ada@example.com' })

    const task = added['crmTasks']?.[0]
    expect(task).toMatchObject({
      title: 'Call them back',
      kind: 'call',
      priority: 'normal',
      status: 'open',
      // The step named nobody, so the follow-up goes to whoever holds the
      // relationship.
      assigneeUid: 'uid-owner',
      createdByUid: '',
      sourceActionId: 'action-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      hostId: HOST_ID,
      visibleTo: [`host:${HOST_ID}`],
      createdAt: 'server-timestamp',
    })
    expect(task.dueAtMs).toBeGreaterThanOrEqual(before + 2 * DAY_MS)
    expect(task.dueAtMs).toBeLessThanOrEqual(Date.now() + 2 * DAY_MS)
    // The reminder a person's task gets by default (AGL-2659): its due time.
    expect(task.remindAtMs).toBe(task.dueAtMs)
    expect(mockActivity.at(-1)?.summary).toBe('created task Call them back')
    // The contact and company it names carry `nextTaskAtMs` (AGL-2661).
    expect(mockRecomputeNextActivity).toHaveBeenCalledWith(expect.anything(), ORG_ID, [
      { contactId: 'contact-1', companyId: 'company-1' },
    ])
  })

  it('prefers the assignee the step names', async () => {
    mockActions = [
      acting({
        type: 'createCrmTask',
        title: 'Send the deck',
        kind: 'email',
        dueInDays: 0,
        assigneeUid: 'uid-sam',
      }),
    ]

    await run({ email: 'ada@example.com' })

    expect(added['crmTasks']?.[0].assigneeUid).toBe('uid-sam')
  })

  it('assigns the task to the assignee named by address', async () => {
    mockActions = [
      acting({
        type: 'createCrmTask',
        title: 'Send the deck',
        kind: 'email',
        dueInDays: 0,
        assigneeEmail: 'Sam@Example.com',
      }),
    ]

    await run({ email: 'ada@example.com' })

    expect(added['crmTasks']?.[0].assigneeUid).toBe('uid-sam')
  })

  it('creates no task for an assignee address nobody on the team has', async () => {
    // Named on purpose and unresolvable: an error, not a quiet fallback to
    // the contact's owner.
    mockActions = [
      acting({
        type: 'createCrmTask',
        title: 'Send the deck',
        kind: 'email',
        dueInDays: 0,
        assigneeEmail: 'ghost@example.com',
      }),
    ]

    await run({ email: 'ada@example.com' })

    expect(added['crmTasks']).toBeUndefined()
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('no team member with the address')
  })

  it('stamps the org-wide scope when the org chose it', async () => {
    mockOrg = { plan: 'business', defaultResourceScope: 'org' }
    mockActions = [acting({ type: 'logCrmActivity', kind: 'note', body: 'Signed up' })]

    await run({ email: 'ada@example.com' })

    expect(added['crmActivities']?.[0].visibleTo).toEqual(['org'])
  })

  it('logs an activity with the automation as its source and no person as its author', async () => {
    mockActions = [acting({ type: 'logCrmActivity', kind: 'note', body: ' Came in via the pricing form ' })]

    await run({ email: 'ada@example.com' })

    expect(added['crmActivities']?.[0]).toMatchObject({
      kind: 'note',
      body: 'Came in via the pricing form',
      byUid: '',
      sourceActionId: 'action-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      hostId: HOST_ID,
      visibleTo: [`host:${HOST_ID}`],
    })
    expect(added['crmActivities']?.[0].atMs).toEqual(expect.any(Number))
    expect(mockActivity.at(-1)?.summary).toBe('logged activity note')
  })

  it('refuses to log onto a record at the activity ceiling, and says so (AGL-2611)', async () => {
    mockActivityCount = CRM_ACTIVITIES_PER_RECORD_CEILING
    mockActions = [acting({ type: 'logCrmActivity', kind: 'note', body: 'One more' })]

    await run({ email: 'ada@example.com' })

    expect(added['crmActivities']).toBeUndefined()
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain(CRM_ACTIVITY_LOG_FULL_MESSAGE)
    // BOTH SIDES: one under the ceiling still writes, so the refusal is the
    // boundary and not a step that refuses everything.
    mockActivityCount = CRM_ACTIVITIES_PER_RECORD_CEILING - 1
    mockActivity = []
    await run({ email: 'ada@example.com' })
    expect(added['crmActivities']).toHaveLength(1)
  })
})

describe('the CRM suite gate (AGL-2611)', () => {
  /*
   * REACHABLE ONLY THROUGH AN OVERRIDE, and that is worth stating. Every
   * plan that carries `actions` — the gate the whole executor runs behind —
   * also carries `crm`, and the two plans without the suite (Free, Starter)
   * run no server automations at all, so a stock plan never reaches this
   * refusal. A staff override that withdraws the suite from a paid
   * workspace does, and the executor must answer it the way it answers a
   * withdrawn `webhooks` flag rather than treat the step as if it ran.
   */
  it('refuses every CRM step on an org whose suite was withdrawn, into the run history', async () => {
    mockOrg = { plan: 'business', entitlements: { features: { crm: false } } }
    mockActions = [
      acting({ type: 'setContactStage', lifecycleStage: 'customer' }),
    ]

    await run({ email: 'ada@example.com' })

    expect(contactUpdates).toHaveLength(0)
    expect(added['crmTasks']).toBeUndefined()
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('CRM steps require the Starter plan')
  })

  it('CONTROL: the same step on the plan as sold runs', async () => {
    mockOrg = { plan: 'business' }
    mockActions = [
      acting({ type: 'setContactStage', lifecycleStage: 'customer' }),
    ]

    await run({ email: 'ada@example.com' })

    expect(contactUpdates).toHaveLength(1)
    expect(mockActivity[0].result).not.toBe('failed')
  })

  it('never reaches a stock Free or Starter workspace — the actions gate answers first', async () => {
    // Both halves of the composition: no server automation runs on either
    // tier, so no history row is written and nothing is touched. A test
    // that seeded a Free org and expected the suite sentence would be
    // asserting a refusal the product never issues.
    for (const plan of ['free', 'starter']) {
      mockOrg = { plan }
      mockActions = [
        acting({ type: 'setContactStage', lifecycleStage: 'customer' }),
      ]
      mockActivity = []
      await run({ email: 'ada@example.com' })
      expect(contactUpdates).toHaveLength(0)
      expect(mockActivity).toHaveLength(0)
    }
  })
})

describe('a stage change fans out (claim 4)', () => {
  it('runs the actions listening for contactStageChanged, with the change in their payload', async () => {
    mockActions = [
      acting({ type: 'setContactStage', lifecycleStage: 'customer' }),
      {
        id: 'action-2',
        data: {
          name: 'Welcome the customer',
          enabled: true,
          trigger: {
            event: 'contactStageChanged',
            conditions: [{ field: 'lifecycleStage', op: 'equals', value: 'customer' }],
          },
          steps: [{ type: 'addContactTag', tag: 'became-customer' }],
        },
      },
    ]

    await run({ email: 'ada@example.com' })

    // The stage write, then the tag the nested run wrote.
    expect(contactUpdates).toHaveLength(2)
    expect(contactUpdates[0][facetPath('lifecycleStage')]).toBe('customer')
    expect(contactUpdates[1][facetPath('tags')]).toEqual({
      __arrayUnion: ['became-customer'],
    })
    const nested = mockActivity.find(
      (row) => row.trigger === 'contactStageChanged',
    )
    expect(nested?.result).toBe('succeeded')
    expect(nested?.target).toMatchObject({ id: 'action-2' })
  })

  it('does not fan out, or write, a stage the contact already has', async () => {
    mockActions = [
      acting({ type: 'setContactStage', lifecycleStage: 'lead' }),
      {
        id: 'action-2',
        data: {
          name: 'Should not run',
          enabled: true,
          trigger: { event: 'contactStageChanged' },
          steps: [{ type: 'addContactTag', tag: 'ran' }],
        },
      },
    ]

    await run({ email: 'ada@example.com' })

    expect(contactUpdates).toHaveLength(0)
    expect(mockActivity.some((row) => row.trigger === 'contactStageChanged')).toBe(false)
    expect(mockActivity[0].result).toBe('succeeded')
    expect(mockActivity[0].summary).toBe('set stage Lead (already)')
  })
})

/**
 * A `sendEmail` step's message on the timeline (AGL-2615): logged as the
 * same email activity the console's send logs, on exactly one condition —
 * that it is addressed to the contact the event is about.
 */
describe('a sendEmail step addressed to the contact', () => {
  const welcome = (extra: Record<string, any> = {}) =>
    acting({ type: 'sendEmail', subject: 'Welcome aboard', body: 'Glad to have you.', ...extra })

  it('logs an email activity with the automation as its source, and tags the message with it', async () => {
    mockActions = [welcome()]

    await run({ contactId: 'contact-1', email: 'ada@example.com' })

    expect(sentMessages).toHaveLength(1)
    const row = added['crmActivities']?.[0]
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
      hostId: HOST_ID,
      visibleTo: [`host:${HOST_ID}`],
      createdAt: 'server-timestamp',
    })
    // The id on the row is the id on the message, which is how the
    // delivery webhook finds the row.
    expect(sentMessages[0].tags).toEqual([
      { name: 'orgId', value: ORG_ID },
      { name: 'activityId', value: row.$id },
      { name: 'hostId', value: HOST_ID },
    ])
    expect(mockActivity[0].result).not.toBe('failed')
  })

  it('resolves the contact by address when the event carries no id', async () => {
    mockActions = [welcome()]
    await run({ email: 'Ada@Example.com' })
    expect(added['crmActivities']).toHaveLength(1)
  })

  it('logs nothing when the message goes to somebody other than the contact', async () => {
    mockActions = [welcome({ toField: 'managerEmail' })]

    await run({ contactId: 'contact-1', email: 'ada@example.com', managerEmail: 'boss@acme.com' })

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].to).toBe('boss@acme.com')
    expect(sentMessages[0].tags).toBeUndefined()
    expect(added['crmActivities']).toBeUndefined()
  })

  it('logs nothing when the address is nobody the site can see', async () => {
    mockContact = null
    mockActions = [welcome()]
    await run({ email: 'stranger@example.com' })
    expect(sentMessages).toHaveLength(1)
    expect(added['crmActivities']).toBeUndefined()
  })

  it('logs nothing when the provider refused the message', async () => {
    sendResult = { sent: false, reason: 'rejected' }
    mockActions = [welcome()]
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(added['crmActivities']).toBeUndefined()
  })

  it('still sends, and logs nothing, at the activity ceiling', async () => {
    mockActivityCount = CRM_ACTIVITIES_PER_RECORD_CEILING
    mockActions = [welcome()]
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].tags).toBeUndefined()
    expect(added['crmActivities']).toBeUndefined()
    expect(mockActivity[0].result).not.toBe('failed')
  })

  it('logs nothing on an org whose suite was withdrawn, and still sends', async () => {
    mockOrg = { plan: 'business', entitlements: { features: { crm: false } } }
    mockActions = [welcome()]
    await run({ contactId: 'contact-1', email: 'ada@example.com' })
    expect(sentMessages).toHaveLength(1)
    expect(added['crmActivities']).toBeUndefined()
  })
})

/**
 * A PERSON WHO IS STILL A LEAD (AGL-3458).
 *
 * A lead-routed form files a lead and no contact, so "Welcome a new lead" —
 * assign an owner, book a call, tag them — has only the lead to act on. Each
 * step writes the lead's own equivalent; the contact path is untouched.
 */
describe('the CRM steps on a lead', () => {
  const LEAD_KEY = personKey('lead@example.com')!

  beforeEach(() => {
    mockContact = null
    mockLead = {
      id: LEAD_KEY,
      data: {
        email: 'lead@example.com',
        name: 'Lin Lead',
        visibleTo: [`host:${HOST_ID}`],
        sources: ['form:form-1'],
      },
    }
  })

  const lead = (step: Record<string, any>) => {
    mockActions = [acting(step, 'lead')]
    return runEventActions(HOST_ID, 'lead', {
      leadId: LEAD_KEY,
      email: 'lead@example.com',
      formId: 'form-1',
    })
  }

  it('rotates in an owner on the LEAD, through the lead assignment', async () => {
    await lead({ type: 'assignContactOwner', roundRobin: true })

    expect(assignments).toEqual([])
    expect(leadAssignments).toEqual([
      { hostId: HOST_ID, leadId: LEAD_KEY, assign: { roundRobin: true } },
    ])
    expect(mockActivity.at(-1)?.result).not.toBe('failed')
  })

  it('books the task on the lead, for the owner the step before it just chose', async () => {
    mockActions = [
      {
        id: 'welcome',
        data: {
          name: 'Welcome a new lead',
          enabled: true,
          trigger: { event: 'lead' },
          steps: [
            { type: 'assignContactOwner', roundRobin: true },
            { type: 'createCrmTask', title: 'Call the new lead', kind: 'call', dueInDays: 1 },
          ],
        },
      },
    ]

    await runEventActions(HOST_ID, 'lead', { leadId: LEAD_KEY, email: 'lead@example.com' })

    const task = added['crmTasks']?.[0]
    expect(task).toMatchObject({
      title: 'Call the new lead',
      kind: 'call',
      leadId: LEAD_KEY,
      assigneeUid: 'uid-sam',
      sourceActionId: 'welcome',
      hostId: HOST_ID,
    })
    expect(task?.['contactId']).toBeUndefined()
  })

  it('tags the lead itself, with arrayUnion', async () => {
    await lead({ type: 'addContactTag', tag: 'website' })

    expect(leadUpdates[0]?.['tags']).toEqual({ __arrayUnion: ['website'] })
    expect(contactUpdates).toEqual([])
  })

  it('logs an activity under the lead', async () => {
    await lead({ type: 'logCrmActivity', kind: 'note', body: 'Came in through the draft form' })

    expect(added['crmActivities']?.[0]).toMatchObject({ leadId: LEAD_KEY, kind: 'note' })
  })

  it('refuses a stage on a lead, and says why', async () => {
    await lead({ type: 'setContactStage', lifecycleStage: 'customer' })

    expect(leadUpdates).toEqual([])
    expect(mockActivity.at(-1)?.action).toContain('a lead has no lifecycle stage')
  })

  it('finds the lead by its address when the event carries no leadId', async () => {
    mockActions = [acting({ type: 'addContactTag', tag: 'website' })]

    await run({ email: 'Lead@Example.com' })

    expect(leadUpdates).toHaveLength(1)
  })

  it('treats a lead this site cannot see as nobody', async () => {
    mockLead!.data['visibleTo'] = ['host:other-site']

    await lead({ type: 'addContactTag', tag: 'website' })

    expect(leadUpdates).toEqual([])
    expect(mockActivity.at(-1)?.action).toContain('no contact or lead this site can see')
  })

  it('CONTROL: a contact for the address is still the one acted on', async () => {
    mockContact = {
      id: 'contact-1',
      data: { email: 'lead@example.com', visibleTo: [`host:${HOST_ID}`], facets: {} },
    }

    await lead({ type: 'addContactTag', tag: 'website' })

    expect(contactUpdates).toHaveLength(1)
    expect(leadUpdates).toEqual([])
  })

  it('logs the welcome email on the lead’s timeline, its merge tags filled from the lead', async () => {
    await lead({ type: 'sendEmail', subject: 'Thanks, {{firstName|there}}', body: 'Hi {{lead.firstName}}' })

    expect(sentMessages[0]?.subject).toBe('Thanks, Lin')
    expect(sentMessages[0]?.text).toContain('Hi Lin')
    expect(added['crmActivities']?.[0]).toMatchObject({
      kind: 'email',
      leadId: LEAD_KEY,
      subject: 'Thanks, Lin',
    })
  })
})

describe('an automation email’s merge tags, from the contact (AGL-3458)', () => {
  it('fills both spellings from the contact as this site knows them, with fallbacks', async () => {
    mockContact!.data['name'] = 'Ada Lovelace'
    mockActions = [
      acting({
        type: 'sendEmail',
        subject: 'Hi {{firstName|there}}',
        body: 'Dear {{contact.firstName}} at {{contact.company|your company}}',
      }),
    ]

    await run({ contactId: 'contact-1', email: 'ada@example.com' })

    expect(sentMessages[0]?.subject).toBe('Hi Ada')
    expect(sentMessages[0]?.text).toContain('Dear Ada at your company')
  })
})

/**
 * The five CRM steps are one group the executor hands to one module: a step
 * added to the vocabulary but not to the group would be a server step the
 * executor silently skipped, and one with no outcome would print a bare enum
 * in the run history.
 */
describe('the CRM steps, as the executor groups them', () => {
  it('are each in the group, with an outcome, and nothing else is', () => {
    for (const type of [
      'setContactStage',
      'addContactTag',
      'assignContactOwner',
      'createCrmTask',
      'logCrmActivity',
    ] as const) {
      expect(CRM_ACTION_STEP_TYPES.has(type)).toBe(true)
      expect(isCrmActionStep({ type } as HostActionStep)).toBe(true)
      expect(HOST_ACTION_STEP_OUTCOMES[type]).toBeTruthy()
    }
    expect(isCrmActionStep({ type: 'sendEmail' } as HostActionStep)).toBe(false)
  })
})

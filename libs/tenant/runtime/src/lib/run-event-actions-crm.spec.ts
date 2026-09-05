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
/** Every `update()` the run made on the contact, in order. */
let contactUpdates: Record<string, any>[] = []
/** Every `add()` by collection path. */
let added: Record<string, Record<string, any>[]> = {}
/** Everything added to `hosts/{id}/activity`. */
let mockActivity: Record<string, any>[] = []
/** How many times the contacts query ran (the email lookup). */
let emailLookups = 0
/** Every owner assignment handed to the runtime helper (AGL-2618), in order. */
let assignments: Record<string, any>[] = []
/** What the helper answers the next assignment with. */
let mockAssignment: Record<string, any> = {
  outcome: 'assigned',
  ownerUid: 'uid-sam',
  by: 'member',
  leadMirrored: false,
  notified: true,
}

jest.mock('./assign-contact-owner', () => ({
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
}))

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
    doc: (id: string) => ({
      id,
      get: async () =>
        path.endsWith('contacts') && mockContact?.id === id
          ? docSnapshot(id, mockContact.data)
          : path.endsWith('members') && mockMembers[id]
            ? docSnapshot(id, mockMembers[id])
            : missingSnapshot(id),
      set: async () => undefined,
      collection: (name: string) => collectionHandle(`${path}/${id}/${name}`),
    }),
    add: async (data: Record<string, any>) => {
      if (path.endsWith('activity')) mockActivity.push(data)
      const key = path.split('/').at(-1) ?? path
      ;(added[key] ??= []).push(data)
      return { id: 'new' }
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
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
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () =>
    collectionHandle(`orgs/${ORG_ID}/datasets`),
  // `{ ref, query }`, with the query SCOPED the way the real helper scopes
  // it — a double that answered the unscoped collection would let the
  // email fallback reach a contact the site may not see.
  orgDataQueryForHost: async () => ({
    ref: collectionHandle(`orgs/${ORG_ID}/contacts`),
    query: collectionHandle(`orgs/${ORG_ID}/contacts`).where(
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
  flowEmailRefusal: async () => null,
  enrollListMember: async () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async () => ({ sent: true }),
  sendFailureReason: () => null,
}))

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
  added = {}
  emailLookups = 0
  assignments = []
  mockAssignment = {
    outcome: 'assigned',
    ownerUid: 'uid-sam',
    by: 'member',
    leadMirrored: false,
    notified: true,
  }
  mockMembers = { 'uid-sam': { email: 'sam@example.com', role: 'editor' } }
  mockOrg = { plan: 'business' }
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
      'no contact this site can see for contact-1',
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
      'no contact this site can see for nobody@example.com',
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

  it('hands a uid named on the step straight to the assignment', async () => {
    mockMembers = {}
    mockActions = [acting({ type: 'assignContactOwner', ownerUid: 'uid-direct' })]

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
    expect(mockActivity.at(-1)?.summary).toBe('created task Call them back')
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

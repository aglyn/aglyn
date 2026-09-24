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
 * THE LEAD CEILING REFUSES, AND REFUSES BECAUSE OF THAT CEILING (AGL-1529).
 *
 * Three ways, the discipline `free-tier-caps-refuse.spec.ts` established, and
 * the third is the load-bearing one:
 *
 *  1. **REFUSED** at `LEADS_MAX_PER_HOST`.
 *  2. **ALLOWED** one below it.
 *  3. **CAUSATION**: the SAME count, driven again against a ceiling one
 *     higher, must succeed. A refusal that survives its own ceiling being
 *     raised was never that ceiling's refusal — it is equally true of a
 *     writer that refuses everything.
 *
 * Plus the two properties that are the whole point of enforcing it HERE and
 * not at the call sites: the count is taken INSIDE the transaction that
 * writes (so it cannot be laundered by concurrency), and a refusal is
 * reported rather than thrown (so it cannot take a booking or a sign-up down
 * with it).
 */

const mockNotifications: Array<Record<string, unknown>> = []

/**
 * The org leads collection the current harness is standing up (AGL-3275).
 *
 * A lead is written to `orgs/{orgId}/leads` now, so the doubles below reach
 * the harness through here rather than through `hostRef.collection('leads')`.
 * Module-level because `jest.mock` factories are hoisted above `harness()`.
 */
let mockLeads: any = null
/** Every `scopedToHost` narrowing asked for — the ceiling claim reads this. */
let mockScopeNarrowings: string[] = []
/**
 * The declared consent group the site is in, when a case declares one;
 * `null` is the site alone, which every other case in this file is.
 */
let mockGroup: {
  groupId: string
  name: string
  hostIds: string[]
} | null = null

jest.mock('./notifications', () => ({
  __esModule: true,
  notifyHostManagers: async (hostId: string, payload: Record<string, unknown>) => {
    mockNotifications.push({ hostId, ...payload })
  },
}))

/*
 * The seam lives in the module under test (AGL-3275), so the doubles go one
 * layer down: the org collection it resolves, and the legacy read behind its
 * carry. No legacy row exists in this file — the carry is
 * `host-lead-seam.spec.ts`'s claim — so the host path answers empty.
 */
jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('./organizations', () => ({
  __esModule: true,
  orgDataCollectionForHost: async () => mockLeads,
  resolveOrgIdForHost: async () => 'org-1',
  consentGroupForSite: async (hostId: string) =>
    mockGroup
      ? { hostId, ...mockGroup, declared: true, awaitsConfirmation: false }
      : {
          hostId,
          groupId: hostId,
          name: null,
          hostIds: [hostId],
          declared: false,
        },
  /*
   * Identity, but RECORDED. The ceiling now counts what a site may see rather
   * than the whole org collection, and a double that silently dropped the
   * narrowing would let an unscoped count pass this file — which is the
   * regression that would charge one agency client for another's leads.
   */
  scopedToHost: (ref: any, hostId: string) => {
    mockScopeNarrowings.push(hostId)
    return ref
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => 'NOW',
    increment: (by: number) => ({ __increment: by }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
}))

import {
  LEADS_MAX_PER_HOST,
  submissionMonthKey,
  visitorRecordRefusedCounterId,
} from '@aglyn/aglyn/server'
import { addHostLead, recordVisitorRecordCeilingTrip } from './host-visitor-records'

interface Harness {
  hostRef: any
  written: Array<Record<string, unknown>>
  counters: Record<string, Record<string, unknown>>
  /** Reads of the lead count that went through the transaction. */
  countsInsideTransaction: number
  /** Reads of the lead count taken outside it — must stay at zero. */
  countsOutsideTransaction: number
}

/**
 * A Firestore double that models the ONE semantic this file turns on: an
 * aggregate `count()` is answered differently depending on whether it was
 * asked through `tx.get` or through the collection directly. A double that
 * answered both the same could not tell a transactional count from the
 * read-then-decide-then-add shape that laundered, so it would go green
 * against the very bug this closes.
 */
function harness(existingLeads: number): Harness {
  const state: Harness = {
    hostRef: null,
    written: [],
    counters: {},
    countsInsideTransaction: 0,
    countsOutsideTransaction: 0,
  }
  const leadsCollection: any = {
    count: () => ({ __count: true }),
    get: async () => {
      state.countsOutsideTransaction += 1
      return { size: existingLeads + state.written.length }
    },
    doc: (id?: string) => ({
      id: id ?? `lead-${state.written.length + 1}`,
      // Every address in this file is new to the collection, so the lead
      // document read added by the personKey upsert always misses. The
      // dedupe and merge semantics are owned by `host-lead-dedupe.spec.ts`;
      // what THIS file pins is the ceiling and its bookkeeping.
      get: async () => ({
        exists: false,
        get: () => undefined,
        data: () => undefined,
      }),
    }),
  }
  const countersDocs: Record<string, any> = {}
  const countersCollection = {
    doc: (id: string) => {
      countersDocs[id] ??= {
        get: async () => ({
          get: (field: string) => state.counters[id]?.[field],
        }),
        set: async (data: Record<string, unknown>) => {
          state.counters[id] = { ...(state.counters[id] ?? {}), ...data }
        },
      }
      return countersDocs[id]
    },
  }
  const firestore = {
    runTransaction: async (body: (tx: any) => Promise<unknown>) =>
      body({
        get: async (target: any) => {
          // A document read is the upsert's existence probe and is NOT a
          // count. Counting it here would make `countsInsideTransaction` say
          // the aggregate ran when it did not, which is the one thing this
          // double exists to tell apart.
          if (!target?.__count) return target.get()
          state.countsInsideTransaction += 1
          return {
            data: () => ({ count: existingLeads + state.written.length }),
          }
        },
        set: (_ref: unknown, data: Record<string, unknown>) => {
          state.written.push(data)
        },
      }),
  }
  state.hostRef = {
    firestore,
    collection: (name: string) =>
      name === 'leads' ? leadsCollection : countersCollection,
  }
  // What `orgLeadsForHost` hands back — the lead silo is org-scoped now.
  mockLeads = leadsCollection
  return state
}

const add = (state: Harness, ceiling?: number) =>
  addHostLead({
    hostRef: state.hostRef,
    hostId: 'host-1',
    lead: { email: 'dana@example.com', name: 'Dana Reed', source: 'signup' },
    ...(ceiling == null ? {} : { ceiling }),
  })

beforeEach(() => {
  mockNotifications.length = 0
  mockScopeNarrowings = []
  mockGroup = null
})

describe('addHostLead is bounded by LEADS_MAX_PER_HOST (AGL-1529)', () => {
  it('REFUSES at the ceiling, and writes nothing', async () => {
    const state = harness(LEADS_MAX_PER_HOST)
    await expect(add(state)).resolves.toBe(false)
    expect(state.written).toHaveLength(0)
  })

  it('ALLOWS one below the ceiling', async () => {
    const state = harness(LEADS_MAX_PER_HOST - 1)
    await expect(add(state)).resolves.toBe(true)
    expect(state.written).toHaveLength(1)
    // The payload the callers depend on still arrives (AGL-2303). The
    // capture surface is now `sources`, an `arrayUnion` — one lead document
    // per person accumulates the surfaces rather than one row per capture.
    expect(state.written[0]).toMatchObject({
      email: 'dana@example.com',
      name: 'Dana Reed',
      sources: { __arrayUnion: ['signup'] },
    })
  })

  it('CAUSATION: the same count succeeds against a ceiling one higher', async () => {
    // The load-bearing leg. Identical usage to the refused case above; the
    // ONLY thing that changed is the limit it is compared with. A writer that
    // refused for any other reason — a malformed ref, a missing collection, a
    // blanket "no" — fails here.
    const state = harness(LEADS_MAX_PER_HOST)
    await expect(add(state, LEADS_MAX_PER_HOST + 1)).resolves.toBe(true)
    expect(state.written).toHaveLength(1)
  })

  it('takes the count INSIDE the transaction that writes, never before it', async () => {
    // The create-time-quota laundering AGL-2231/2265/2266 closed: count,
    // decide, then write outside any transaction, and N concurrent visitors
    // all find room. Asserted on WHERE the count was read, because that —
    // not the counting rule — is what the fix changed.
    const state = harness(0)
    await add(state)
    expect(state.countsInsideTransaction).toBe(1)
    expect(state.countsOutsideTransaction).toBe(0)
  })

  it('a refused lead is reported, never thrown', async () => {
    // A lead is a side effect of a sign-up or a booking. Refusing one must
    // not take down the thing the visitor actually did.
    const state = harness(LEADS_MAX_PER_HOST)
    await expect(add(state)).resolves.toBe(false)
  })

  it('a Firestore failure is swallowed the way the old .catch() was', async () => {
    const broken: any = {
      firestore: {
        runTransaction: async () => {
          throw new Error('firestore down')
        },
      },
      collection: () => ({ count: () => ({ __count: true }), doc: () => ({}) }),
    }
    await expect(
      addHostLead({
        hostRef: broken,
        hostId: 'host-1',
        lead: { email: 'dana@example.com', source: 'signup' },
      }),
    ).resolves.toBe(false)
  })
})

describe('a trip is visible to the site owner (AGL-1529)', () => {
  it('increments the month-keyed counter and names the ceiling', async () => {
    const state = harness(LEADS_MAX_PER_HOST)
    await add(state)
    const counter = state.counters[visitorRecordRefusedCounterId('leads')]
    expect(counter).toBeTruthy()
    expect(counter[submissionMonthKey()]).toEqual({ __increment: 1 })
    expect(counter['ceiling']).toBe(LEADS_MAX_PER_HOST)
    expect(typeof counter['lastRefusedAtMs']).toBe('number')
  })

  it('notifies the managers on the FIRST refusal of the month only', async () => {
    const state = harness(LEADS_MAX_PER_HOST)
    await add(state)
    expect(mockNotifications).toHaveLength(1)
    expect(mockNotifications[0]['type']).toBe('system.visitorRecordsPaused')
    // Names the site's inbox, which is where the notice is rendered.
    expect(mockNotifications[0]['link']).toBe('/host-1/inbox')
    // …and says the thing that is true and easy to get wrong: this is not a
    // plan limit. AGL-889 promises unlimited member accounts on every plan
    // and an abuse control must not read as a walkback of it.
    expect(String(mockNotifications[0]['body'])).toContain(
      'not part of your plan',
    )

    // A second refusal in the same month writes the counter again and stays
    // quiet. A notification per refused bot request is the flood, delivered.
    state.counters[visitorRecordRefusedCounterId('leads')][
      submissionMonthKey()
    ] = 1
    await add(state)
    expect(mockNotifications).toHaveLength(1)
  })

  it('bookkeeping that fails does not become the caller’s problem', async () => {
    const broken: any = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error('counters unreadable')
          },
        }),
      }),
    }
    await expect(
      recordVisitorRecordCeilingTrip({
        hostRef: broken,
        hostId: 'host-1',
        kind: 'siteMembers',
        ceiling: 10,
      }),
    ).resolves.toBeUndefined()
  })
})

/**
 * The lead silo moved to the org (AGL-3275), and three things had to move
 * with it. Each was correct while `hosts/{hostId}/leads` was private by path,
 * and each is wrong now that the row is shared.
 */
describe('the lead is written as an org-scoped record (AGL-3275)', () => {
  it('counts the ceiling over what the SITE may see, not the whole org', async () => {
    // Without the narrowing, one agency client's leads would fill another
    // client's allowance — and every single-brand org would still look fine,
    // which is why this is asserted on the narrowing and not on a total.
    const state = harness(0)
    await add(state)

    expect(state.countsInsideTransaction).toBe(1)
    expect(mockScopeNarrowings).toEqual(['host-1'])
  })

  it('stamps visibleTo by union, so a capture widens and a lookup does not', async () => {
    const state = harness(0)
    await add(state)

    expect(state.written[0]).toMatchObject({
      visibleTo: { __arrayUnion: ['host:host-1'] },
    })
  })

  it('records every site that captured the person, not only the first', async () => {
    // On a shared row a sibling brand's capture has to appear here or the
    // "Known by" answer silently omits it. `arrayUnion`, as the contact door
    // has always written this field.
    const state = harness(0)
    await add(state)

    expect(state.written[0]).toMatchObject({
      capturedByHostIds: { __arrayUnion: ['host-1'] },
    })
  })
})

/*
 * A LEAD'S OPT-IN COVERS THE SITES ITS FORM NAMED (AGL-3320) — the rule the
 * contact door keeps, on the silo the same capture reaches first.
 */
describe('the sites a lead’s opt-in covers', () => {
  const { consentGroupDisclosureKey } = jest.requireActual(
    '@aglyn/aglyn/app-utils/consent-groups',
  )
  const GROUP = { groupId: 'nw', name: 'Northwind', hostIds: ['host-1', 'host-2'] }
  const optIn = (state: Harness, disclosedConsentGroup?: string) =>
    addHostLead({
      hostRef: state.hostRef,
      hostId: 'host-1',
      lead: {
        email: 'dana@example.com',
        source: 'form:quote',
        marketingConsent: true,
        ...(disclosedConsentGroup ? { disclosedConsentGroup } : {}),
      },
    })

  it('records a grouped capture without a key for the capturing site alone', async () => {
    mockGroup = GROUP
    const state = harness(0)
    await optIn(state)
    expect(Object.keys(state.written[0]['marketingConsentByHost'] as object)).toEqual([
      'host-1',
    ])
    // The row is still the group's to see.
    expect(state.written[0]).toMatchObject({
      visibleTo: { __arrayUnion: ['host:host-1', 'host:host-2'] },
    })
  })

  it('pools it across the group on the current disclosure key', async () => {
    mockGroup = GROUP
    const key = consentGroupDisclosureKey({
      hostId: 'host-1',
      ...GROUP,
      declared: true,
      awaitsConfirmation: false,
    })
    const state = harness(0)
    await optIn(state, key)
    const byHost = state.written[0]['marketingConsentByHost'] as Record<string, any>
    expect(Object.keys(byHost).sort()).toEqual(['host-1', 'host-2'])
    expect(byHost['host-2']).toMatchObject({ consentGroupId: 'nw', consentGroupName: 'Northwind' })
  })

  it('THE CONTROL: a site alone records itself', async () => {
    const state = harness(0)
    await optIn(state, 'any-key')
    expect(Object.keys(state.written[0]['marketingConsentByHost'] as object)).toEqual([
      'host-1',
    ])
  })
})

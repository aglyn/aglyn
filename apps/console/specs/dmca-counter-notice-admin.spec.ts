/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where `Request`/`Response` do
 * not exist and every test here fails on construction.
 */

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
 * AGL-1983 — the staff side of the §512 put-back and the strike ledger.
 *
 * `abuse-reports-admin-route.spec.ts` covers the AGL-1964 queue: staff auth,
 * redaction tiers, the audit row. This file covers what AGL-1983 added to the
 * same route, and it is organised around the three things that would be
 * invisible if they broke.
 *
 *  1. **The clock is computed from RECEIPT.** A `Date.now()` in the wrong
 *     place restarts the statutory window when staff get round to the row, so
 *     a counter-notice that waited a week keeps the customer locked out a week
 *     longer than the law allows — and every test that merely asserted "a
 *     restore date was written" stays green.
 *  2. **A withdrawn takedown withdraws its strike.** A strike surviving the
 *     process that reversed the removal counts an infringement §512(g) just
 *     declined to affirm.
 *  3. **None of it touches a healthy site.** The negative control for the
 *     whole feature. An earlier `hostWritesFrozen` nearly shipped a freeze
 *     that broke publishing for every paying customer; a put-back mechanism
 *     that wrote suspension fields onto sites that were never suspended is
 *     the same failure wearing different clothes.
 */

const mockVerifyIdToken = jest.fn()

/** Path → document. A flat map, because Firestore is one too. */
let store: Record<string, Record<string, any>> = {}
let audit: Record<string, any>[] = []
let nowMs = Date.UTC(2026, 7, 17, 9, 30)

/**
 * The delete sentinel, shared with the `FieldValue` mock below through the
 * global symbol registry.
 *
 * `Symbol.for` rather than `Symbol()` deliberately: jest hoists `jest.mock`
 * factories above this file's bindings, so a module-local symbol would be out
 * of scope inside the factory and the two halves would never compare equal —
 * `FieldValue.delete()` would then store a value instead of removing a key,
 * and the cancel-restoration test would pass for the wrong reason.
 */
const DELETE = Symbol.for('delete-sentinel')

/**
 * A faithful-enough Firestore double.
 *
 * The properties it has to model exactly, because assertions depend on each:
 *
 *  - `set(..., {merge:true})` MERGES; a replacing double would hide every
 *    "the field we did not write survived" bug.
 *  - `FieldValue.delete()` REMOVES the key rather than storing a sentinel —
 *    the cancel path's whole point is that the host ends up in the same shape
 *    an ordinary indefinite takedown produces.
 *  - `select(field)` PROJECTS. Modelled because the route relies on the
 *    projected field being present, and a double that ignored `select` would
 *    green-light a projection that starved the predicate reading it.
 *  - a missing document reports `exists: false` and `get()` undefined, rather
 *    than throwing.
 */
const snapshotOf = (path: string, projection?: string[]) => {
  const raw = store[path]
  const data =
    raw && projection
      ? Object.fromEntries(projection.map((field) => [field, raw[field]]))
      : raw
  return {
    exists: raw != null,
    id: path.split('/').pop() as string,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

const applySet = (
  path: string,
  patch: Record<string, any>,
  options?: { merge?: boolean },
) => {
  const base = options?.merge ? (store[path] ?? {}) : {}
  const next: Record<string, any> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE) delete next[key]
    else next[key] = value
  }
  store[path] = next
}

const docRef = (path: string): any => ({
  __path: path,
  get: async () => snapshotOf(path),
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) =>
    applySet(path, patch, options),
  collection: (name: string) => collectionRef(`${path}/${name}`),
})

const collectionRef = (prefix: string): any => {
  const query = (state: {
    where?: [string, string, any]
    order?: [string, string]
    limit?: number
    projection?: string[]
  }): any => ({
    where: (field: string, op: string, value: any) =>
      query({ ...state, where: [field, op, value] }),
    orderBy: (field: string, direction = 'asc') =>
      query({ ...state, order: [field, direction] }),
    limit: (count: number) => query({ ...state, limit: count }),
    select: (...fields: string[]) => query({ ...state, projection: fields }),
    get: async () => {
      // Direct children of `prefix` only — a subcollection is not a member of
      // its parent collection, and a double that returned one would let the
      // strike ledger read the reports collection.
      let rows = Object.keys(store).filter(
        (path) =>
          path.startsWith(`${prefix}/`) &&
          !path.slice(prefix.length + 1).includes('/'),
      )
      if (state.where) {
        const [field, , value] = state.where
        rows = rows.filter((path) => store[path][field] === value)
      }
      if (state.order) {
        const [field, direction] = state.order
        rows = [...rows].sort((a, b) => {
          const left = store[a][field] ?? 0
          const right = store[b][field] ?? 0
          return direction === 'desc'
            ? Number(right) - Number(left)
            : Number(left) - Number(right)
        })
      }
      if (state.limit != null) rows = rows.slice(0, state.limit)
      return { docs: rows.map((path) => snapshotOf(path, state.projection)) }
    },
  })
  return Object.assign(query({}), {
    doc: (id: string) => docRef(`${prefix}/${id}`),
    add: async (row: Record<string, any>) => {
      if (prefix === 'adminAudit') {
        audit.push(row)
        return { id: `audit-${audit.length}` }
      }
      const id = `auto-${Object.keys(store).length}`
      store[`${prefix}/${id}`] = row
      return { id }
    },
  })
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({ collection: (name: string) => collectionRef(name) }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

// The REAL §512 helpers are spread in. Stubbing them would make this file
// assert that a mock agreed with itself about a statutory deadline.
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/abuse-report'),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/dmca-counter-notice',
  ),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/repeat-infringer'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => 'server-timestamp',
    delete: () => Symbol.for('delete-sentinel'),
  },
}))

import { GET, POST } from '../app/api/admin/abuse-reports/route'
import {
  COUNTER_NOTICE_MAX_BUSINESS_DAYS,
  STRIKE_TERMINATE_AT,
  counterNoticeClock,
} from '@aglyn/aglyn/server'

const NOTICE_ID = 'a'.repeat(40)
const COUNTER_ID = 'c'.repeat(40)
const OTHER_REPORT = 'd'.repeat(40)
const ORG = 'org-acme'
const LOCKED_HOST = 'host-locked'
const HEALTHY_HOST = 'host-healthy'

const post = (body: Record<string, unknown>, token = 'super-token') =>
  POST(
    new Request('https://console.aglyn.com/api/admin/abuse-reports', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )

const get = (token = 'super-token') =>
  GET(
    new Request('https://console.aglyn.com/api/admin/abuse-reports', {
      headers: { authorization: `Bearer ${token}` },
    }),
  )

const strikeRows = () =>
  Object.entries(store).filter(([path]) =>
    path.startsWith(`orgs/${ORG}/dmcaStrikes/`),
  )

const standing = () =>
  strikeRows().filter(([, data]) => data.withdrawnAt == null).length

/** Seed one actioned DMCA report and the counter-notice answering it. */
const seedDispute = (receivedAtMs = nowMs - 3 * 86_400_000) => {
  store[`abuseReports/${NOTICE_ID}`] = {
    reference: 'AR-1A2B3C4D5E',
    category: 'dmca',
    severity: 'high',
    status: 'actioned',
    url: 'https://acme.aglyn.app/gallery',
    reportedHostname: 'acme.aglyn.app',
    hostId: LOCKED_HOST,
    orgId: ORG,
    details: 'These are my photographs.',
  }
  store[`dmcaCounterNotices/${COUNTER_ID}`] = {
    reference: 'CN-9F8E7D6C5B',
    noticeReference: 'AR-1A2B3C4D5E',
    status: 'received',
    url: 'https://acme.aglyn.app/gallery',
    reportedHostname: 'acme.aglyn.app',
    hostId: LOCKED_HOST,
    orgId: ORG,
    material: 'The three product photographs on the gallery page.',
    subscriberName: 'Dana Okonkwo',
    subscriberEmail: 'dana@acme.test',
    subscriberAddress: '128 Rue Example, Austin, TX 78701, United States',
    subscriberPhone: '+1 512 555 0134',
    signature: 'Dana Okonkwo',
    goodFaithMistake: true,
    consentJurisdiction: true,
    acceptService: true,
    submissionCount: 1,
    receivedAtMs,
  }
  store[`hosts/${LOCKED_HOST}`] = {
    displayName: 'Acme',
    orgId: ORG,
    suspendedAt: 'server-timestamp',
    suspendedReasonCode: 'dmca',
  }
  store[`hosts/${HEALTHY_HOST}`] = { displayName: 'Innocent', orgId: ORG }
}

beforeEach(() => {
  store = {}
  audit = []
  nowMs = Date.UTC(2026, 7, 17, 9, 30)
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs)
  mockVerifyIdToken.mockImplementation(async (token: string) => ({
    uid: 'uid-staff',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: token === 'support-token' ? 'support' : 'super',
  }))
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('forwarding a counter-notice schedules the put-back', () => {
  it('stamps the suspension with a restore instant inside the statutory window', async () => {
    seedDispute()
    const response = await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'forwarded',
      resolution: 'Copy sent to the complainant at rights@studio.test.',
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.confirmed).toBe(true)
    expect(body.scheduling).toBe('scheduled')

    // The host's own expiry now carries the date — which is the mechanism
    // AGL-1981 made actually fire in Firestore rules. Before that fix this
    // stamp would have unsuspended the site everywhere except the client SDK,
    // i.e. the whole authoring experience.
    const stamped = store[`hosts/${LOCKED_HOST}`].suspendedUntilMs
    const clock = counterNoticeClock(
      store[`dmcaCounterNotices/${COUNTER_ID}`].receivedAtMs,
    )
    expect(stamped).toBe(clock.restoreAtMs)
    expect(stamped).toBeGreaterThanOrEqual(clock.earliestMs)
    expect(stamped).toBeLessThanOrEqual(clock.latestMs)
  })

  it('computes the clock from RECEIPT, so staff delay never extends the lockout', async () => {
    // The load-bearing assertion of this file. Two runs of the same
    // counter-notice, forwarded eleven days apart, must schedule the SAME
    // restore instant — because §512(g)(2)(C) counts from receipt. A
    // `Date.now()` in `counterNoticeClock`'s argument would make the second
    // one later, and the customer would serve a longer lockout for our
    // slowness.
    const receivedAtMs = nowMs - 3 * 86_400_000
    seedDispute(receivedAtMs)
    await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'forwarded',
      resolution: 'Forwarded promptly.',
    })
    const promptly = store[`hosts/${LOCKED_HOST}`].suspendedUntilMs

    store = {}
    audit = []
    nowMs += 11 * 86_400_000
    seedDispute(receivedAtMs)
    await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'forwarded',
      resolution: 'Forwarded very late.',
    })
    const late = store[`hosts/${LOCKED_HOST}`].suspendedUntilMs

    expect(late).toBe(promptly)
  })

  it('will not extend a suspension that already ends sooner', async () => {
    // A counter-notice is a subscriber asking for their site back. It must
    // never be capable of keeping a site down longer than the takedown staff
    // actually imposed.
    seedDispute()
    const soon = nowMs + 86_400_000
    store[`hosts/${LOCKED_HOST}`].suspendedUntilMs = soon
    const response = await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'forwarded',
      resolution: 'Forwarded; the existing expiry is sooner.',
    })
    expect((await response.json()).scheduling).toBe('alreadySooner')
    expect(store[`hosts/${LOCKED_HOST}`].suspendedUntilMs).toBe(soon)
  })

  it('records what happened to the SITE in the audit row, not just the status', async () => {
    seedDispute()
    await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'forwarded',
      resolution: 'Copy sent to the complainant.',
    })
    const row = audit.find((entry) => entry.action === 'dmcaCounterNotice.forwarded')
    expect(row).toBeTruthy()
    expect(row!.after.scheduling).toBe('scheduled')
    expect(row!.after.scheduledRestoreAtMs).toBe(
      store[`hosts/${LOCKED_HOST}`].suspendedUntilMs,
    )
    expect(row!.note).toContain('complainant')
  })

  it('refuses a transition with no note', async () => {
    seedDispute()
    const response = await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'forwarded',
    })
    expect(response.status).toBe(400)
    expect(store[`hosts/${LOCKED_HOST}`].suspendedUntilMs).toBeUndefined()
  })
})

describe('the healthy-site control', () => {
  it('never writes a suspension field onto a site that is not suspended', async () => {
    // The negative control for the entire feature. Every assertion above
    // would also pass if `scheduleRestoration` wrote `suspendedUntilMs`
    // unconditionally — and that version would be stamping half a takedown
    // onto innocent sites.
    seedDispute()
    store[`dmcaCounterNotices/${COUNTER_ID}`].hostId = HEALTHY_HOST
    const response = await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'forwarded',
      resolution: 'Forwarded; the site was never suspended.',
    })
    expect(response.status).toBe(200)
    expect((await response.json()).scheduling).toBe('notSuspended')
    expect(store[`hosts/${HEALTHY_HOST}`]).toEqual({
      displayName: 'Innocent',
      orgId: ORG,
    })
    expect(store[`hosts/${HEALTHY_HOST}`].suspendedUntilMs).toBeUndefined()
    expect(store[`hosts/${HEALTHY_HOST}`].suspendedAt).toBeUndefined()
  })

  it('leaves a healthy site alone when a counter-notice is cancelled too', async () => {
    seedDispute()
    store[`dmcaCounterNotices/${COUNTER_ID}`].hostId = HEALTHY_HOST
    await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'suitFiled',
      resolution: 'Complainant filed in W.D. Tex.',
    })
    expect(store[`hosts/${HEALTHY_HOST}`]).toEqual({
      displayName: 'Innocent',
      orgId: ORG,
    })
  })

  it('a strike never suspends anything by itself', async () => {
    // §512(i) asks for a policy applied by a person, not an automatic
    // account closure on three assertions by strangers.
    seedDispute()
    delete store[`hosts/${LOCKED_HOST}`].suspendedAt
    for (const reportId of [NOTICE_ID, OTHER_REPORT, 'e'.repeat(40)]) {
      store[`abuseReports/${reportId}`] = {
        ...store[`abuseReports/${NOTICE_ID}`],
        reference: `AR-${reportId.slice(0, 10).toUpperCase()}`,
        status: 'open',
      }
      await post({
        id: reportId,
        status: 'actioned',
        resolution: 'Image removed.',
        repeatInfringerDecision: 'Warned; not terminating yet.',
      })
    }
    expect(standing()).toBe(3)
    // Three strikes, and not one write to the host or the org document.
    expect(store[`hosts/${LOCKED_HOST}`].suspendedAt).toBeUndefined()
    expect(store[`hosts/${LOCKED_HOST}`].suspendedUntilMs).toBeUndefined()
    expect(store[`orgs/${ORG}`]).toBeUndefined()
  })
})

describe('the §512(g)(2)(B) exception cancels the put-back', () => {
  it('clears the scheduled restoration when the complainant files suit', async () => {
    seedDispute()
    await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'forwarded',
      resolution: 'Copy sent.',
    })
    expect(store[`hosts/${LOCKED_HOST}`].suspendedUntilMs).toBeDefined()

    const response = await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'suitFiled',
      resolution: 'Complainant filed in W.D. Tex., case 1:26-cv-0042.',
    })
    expect((await response.json()).scheduling).toBe('cancelled')
    // The field is REMOVED, not pushed far out — the host ends in the same
    // shape an ordinary indefinite takedown produces, so there is one
    // representation of "suspended with no end date" rather than two.
    expect('suspendedUntilMs' in store[`hosts/${LOCKED_HOST}`]).toBe(false)
    // And the takedown itself still stands.
    expect(store[`hosts/${LOCKED_HOST}`].suspendedAt).toBe('server-timestamp')
  })
})

describe('the strike ledger', () => {
  it('records a strike when a copyright report is actioned', async () => {
    seedDispute()
    store[`abuseReports/${NOTICE_ID}`].status = 'open'
    const response = await post({
      id: NOTICE_ID,
      status: 'actioned',
      resolution: 'Image removed from the gallery.',
    })
    const body = await response.json()
    expect(body.strike).toBe('added')
    expect(body.repeatInfringer.strikes).toBe(1)
    expect(standing()).toBe(1)
    expect(store[`orgs/${ORG}/dmcaStrikes/${NOTICE_ID}`].url).toContain('gallery')
  })

  it('does not inflate on a double click', async () => {
    // Keyed by report id precisely so this is a no-op. A counter that could
    // be pumped by clicking twice is not one anybody should terminate an
    // account on.
    seedDispute()
    store[`abuseReports/${NOTICE_ID}`].status = 'open'
    await post({ id: NOTICE_ID, status: 'actioned', resolution: 'Removed.' })
    await post({ id: NOTICE_ID, status: 'actioned', resolution: 'Removed again.' })
    expect(standing()).toBe(1)
  })

  it('does not record a strike for a non-copyright takedown', async () => {
    seedDispute()
    store[`abuseReports/${NOTICE_ID}`].status = 'open'
    store[`abuseReports/${NOTICE_ID}`].category = 'phishing'
    const response = await post({
      id: NOTICE_ID,
      status: 'actioned',
      resolution: 'Site suspended for phishing.',
    })
    expect((await response.json()).strike).toBeNull()
    expect(strikeRows()).toHaveLength(0)
  })

  it('gives the strike back when staff dismiss what they had actioned', async () => {
    seedDispute()
    store[`abuseReports/${NOTICE_ID}`].status = 'open'
    await post({ id: NOTICE_ID, status: 'actioned', resolution: 'Removed.' })
    expect(standing()).toBe(1)

    const response = await post({
      id: NOTICE_ID,
      status: 'dismissed',
      resolution: 'On review the notice did not hold up.',
    })
    expect((await response.json()).strike).toBe('withdrawn')
    expect(standing()).toBe(0)
    // Marked, not deleted: "did we know, and when" is the question this queue
    // answers, and a lifted strike is part of that answer.
    expect(strikeRows()).toHaveLength(1)
    expect(store[`orgs/${ORG}/dmcaStrikes/${NOTICE_ID}`].withdrawnReason).toBe(
      'staffReversed',
    )
  })

  it('withdraws the strike when a counter-notice leads to restoration', async () => {
    // The interlock AGL-1983 turns on: a strike surviving a §512(g)
    // restoration would count an infringement the procedure just declined to
    // affirm.
    seedDispute()
    store[`abuseReports/${NOTICE_ID}`].status = 'open'
    await post({ id: NOTICE_ID, status: 'actioned', resolution: 'Removed.' })
    expect(standing()).toBe(1)

    await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'forwarded',
      resolution: 'Copy sent.',
    })
    const response = await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'restored',
      resolution: 'No suit filed; access restored on the statutory date.',
    })
    expect((await response.json()).strike).toBe('withdrawn')
    expect(standing()).toBe(0)
    expect(store[`orgs/${ORG}/dmcaStrikes/${NOTICE_ID}`].withdrawnReason).toBe(
      'counterNoticeRestored',
    )
    // The REPORT stays actioned — it was actioned, and the history says so.
    expect(store[`abuseReports/${NOTICE_ID}`].status).toBe('actioned')
  })

  it('never invents a strike in order to withdraw one', async () => {
    seedDispute()
    store[`abuseReports/${NOTICE_ID}`].status = 'open'
    await post({
      id: NOTICE_ID,
      status: 'dismissed',
      resolution: 'Not a valid notice.',
    })
    expect(strikeRows()).toHaveLength(0)
  })
})

describe('the threshold does something', () => {
  /** Put the org on the termination threshold. */
  const seedStrikes = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      store[`orgs/${ORG}/dmcaStrikes/prior-${index}`] = {
        reportId: `prior-${index}`,
        withdrawnAt: null,
      }
    }
  }

  it('refuses to close a further copyright report without a recorded decision', async () => {
    seedDispute()
    seedStrikes(STRIKE_TERMINATE_AT)
    store[`abuseReports/${OTHER_REPORT}`] = {
      ...store[`abuseReports/${NOTICE_ID}`],
      reference: 'AR-OTHER00001',
      status: 'open',
    }
    const response = await post({
      id: OTHER_REPORT,
      status: 'actioned',
      resolution: 'Image removed.',
    })
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('repeatInfringerDecisionRequired')
    expect(body.strikes).toBe(STRIKE_TERMINATE_AT)
    expect(body.level).toBe('terminate')
    // The refusal is total: nothing was written, so the queue cannot drift
    // into a state where the report is closed and the decision was skipped.
    expect(store[`abuseReports/${OTHER_REPORT}`].status).toBe('open')
    expect(audit).toHaveLength(0)
  })

  it('lets the decision through and puts it in the audit row', async () => {
    seedDispute()
    seedStrikes(STRIKE_TERMINATE_AT)
    store[`abuseReports/${OTHER_REPORT}`] = {
      ...store[`abuseReports/${NOTICE_ID}`],
      reference: 'AR-OTHER00001',
      status: 'open',
    }
    const response = await post({
      id: OTHER_REPORT,
      status: 'actioned',
      resolution: 'Image removed.',
      repeatInfringerDecision:
        'Terminating the workspace under the repeat-infringer policy; ' +
        'owner notified at dana@acme.test.',
    })
    expect(response.status).toBe(200)
    const row = audit.find((entry) => entry.action === 'abuseReport.actioned')
    // The artefact that shows the policy was APPLIED rather than published.
    expect(row!.repeatInfringerDecision).toContain('Terminating the workspace')
    expect(row!.after.strikesStanding).toBe(STRIKE_TERMINATE_AT + 1)
  })

  it('takes "not this time" as an answer', async () => {
    // §512(i) says "in appropriate circumstances". A gate that only accepted
    // termination would be a product deciding the circumstances for us.
    seedDispute()
    seedStrikes(STRIKE_TERMINATE_AT)
    store[`abuseReports/${OTHER_REPORT}`] = {
      ...store[`abuseReports/${NOTICE_ID}`],
      reference: 'AR-OTHER00001',
      status: 'open',
    }
    const response = await post({
      id: OTHER_REPORT,
      status: 'actioned',
      resolution: 'Image removed.',
      repeatInfringerDecision:
        'Not terminating: two of the three strikes are the same complainant ' +
        'and the same disputed licence. Escalated to counsel.',
    })
    expect(response.status).toBe(200)
    expect(store[`abuseReports/${OTHER_REPORT}`].status).toBe('actioned')
  })

  it('does not jam the queue below the threshold', async () => {
    // A gate that fired on a first strike would block the abuse queue, and a
    // jammed abuse queue is its own safety problem.
    seedDispute()
    seedStrikes(STRIKE_TERMINATE_AT - 1)
    store[`abuseReports/${OTHER_REPORT}`] = {
      ...store[`abuseReports/${NOTICE_ID}`],
      reference: 'AR-OTHER00001',
      status: 'open',
    }
    const response = await post({
      id: OTHER_REPORT,
      status: 'actioned',
      resolution: 'Image removed.',
    })
    expect(response.status).toBe(200)
  })

  it('does not gate a phishing report on a copyright threshold', async () => {
    seedDispute()
    seedStrikes(STRIKE_TERMINATE_AT)
    store[`abuseReports/${OTHER_REPORT}`] = {
      ...store[`abuseReports/${NOTICE_ID}`],
      reference: 'AR-OTHER00001',
      category: 'phishing',
      status: 'open',
    }
    const response = await post({
      id: OTHER_REPORT,
      status: 'actioned',
      resolution: 'Suspended for phishing.',
    })
    expect(response.status).toBe(200)
  })
})

describe('the queue shows the deadline', () => {
  it('lists counter-notices oldest first, with the clock resolved', async () => {
    // Oldest FIRST, unlike the reports beside them: the oldest counter-notice
    // is the one whose statutory deadline is closest, and sorting both the
    // same way would bury the row about to become a violation.
    seedDispute(nowMs - 20 * 86_400_000)
    store['dmcaCounterNotices/' + 'f'.repeat(40)] = {
      ...store[`dmcaCounterNotices/${COUNTER_ID}`],
      reference: 'CN-NEWER00001',
      receivedAtMs: nowMs - 86_400_000,
    }
    const body = await (await get()).json()
    expect(body.counterNotices).toHaveLength(2)
    expect(body.counterNotices[0].reference).toBe('CN-9F8E7D6C5B')
    expect(body.counterNotices[0].restoreAtMs).toBe(
      counterNoticeClock(nowMs - 20 * 86_400_000).restoreAtMs,
    )
    expect(body.awaitingForward).toBe(2)
  })

  it('flags a restoration that is already late', async () => {
    // Restoring late is its own §512(g) violation, and it is the failure that
    // produces the outcome the issue is really about: a customer locked out
    // because a queue was quiet.
    const longAgo = nowMs - 60 * 86_400_000
    seedDispute(longAgo)
    const body = await (await get()).json()
    expect(body.counterNotices[0].overdue).toBe(true)
    expect(body.overdueRestorations).toBe(1)
    expect(body.counterNotices[0].latestRestoreMs).toBe(
      counterNoticeClock(longAgo).latestMs,
    )
    expect(body.counterNotices[0].latestRestoreMs).toBeLessThan(nowMs)
  })

  it('stops flagging once the notice is no longer heading for a put-back', async () => {
    seedDispute(nowMs - 60 * 86_400_000)
    store[`dmcaCounterNotices/${COUNTER_ID}`].status = 'suitFiled'
    const body = await (await get()).json()
    expect(body.counterNotices[0].overdue).toBe(false)
    expect(body.overdueRestorations).toBe(0)
  })

  it('shows the strike verdict beside a copyright report', async () => {
    seedDispute()
    store[`orgs/${ORG}/dmcaStrikes/prior-1`] = { withdrawnAt: null }
    store[`orgs/${ORG}/dmcaStrikes/prior-2`] = { withdrawnAt: null }
    // A withdrawn row must not count, and the projection must carry the field
    // that decides it — a `select()` that dropped `withdrawnAt` would read
    // this as three.
    store[`orgs/${ORG}/dmcaStrikes/prior-3`] = { withdrawnAt: 'server-timestamp' }
    const body = await (await get()).json()
    expect(body.strikes[ORG].strikes).toBe(2)
    expect(body.strikes[ORG].level).toBe('final')
    expect(body.strikesTruncated).toBe(false)
  })

  it('does not attach a strike count to a phishing-only org', async () => {
    seedDispute()
    store[`abuseReports/${NOTICE_ID}`].category = 'phishing'
    const body = await (await get()).json()
    expect(body.strikes[ORG]).toBeUndefined()
  })
})

describe('redaction reaches the counter-notice too', () => {
  it('withholds the subscriber home address and phone from the support tier', async () => {
    // §512(g)(3)(D) forces a counter-notice to carry a home address and a
    // phone number, so this is the most personal data anywhere in the queue —
    // and data the filer had no choice about supplying.
    seedDispute()
    const body = await (await get('support-token')).json()
    const notice = body.counterNotices[0]
    expect(notice.identityVisible).toBe(false)
    expect(notice.subscriberAddress).toBeNull()
    expect(notice.subscriberPhone).toBeNull()
    expect(notice.subscriberName).toBeNull()
    expect(notice.signature).toBeNull()
    // But the deadline and the sworn statements are visible, or the tier that
    // triages could not tell whether the document was even effective.
    expect(notice.restoreAtMs).toBeTruthy()
    expect(notice.goodFaithMistake).toBe(true)
    expect(notice.consentJurisdiction).toBe(true)
    expect(notice.acceptService).toBe(true)
  })

  it('shows a super-tier reader who filed it', async () => {
    seedDispute()
    const body = await (await get()).json()
    const notice = body.counterNotices[0]
    expect(notice.identityVisible).toBe(true)
    expect(notice.subscriberName).toBe('Dana Okonkwo')
    expect(notice.subscriberPhone).toBe('+1 512 555 0134')
  })
})

describe('the staff gate still holds on the new branch', () => {
  it('refuses a non-staff token', async () => {
    seedDispute()
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'uid-customer',
      email: 'customer@acme.test',
      email_verified: true,
    })
    const response = await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'forwarded',
      resolution: 'Trying it on.',
    })
    expect(response.status).toBe(403)
    expect(store[`hosts/${LOCKED_HOST}`].suspendedUntilMs).toBeUndefined()
  })

  it('refuses a status that is not a counter-notice status', async () => {
    seedDispute()
    const response = await post({
      counterNoticeId: COUNTER_ID,
      counterNoticeStatus: 'unsuspended',
      resolution: 'Making it up.',
    })
    expect(response.status).toBe(400)
    expect(store[`hosts/${LOCKED_HOST}`].suspendedUntilMs).toBeUndefined()
  })

  it('404s an unknown counter-notice rather than creating one', async () => {
    seedDispute()
    const response = await post({
      counterNoticeId: 'b'.repeat(40),
      counterNoticeStatus: 'forwarded',
      resolution: 'Nothing here.',
    })
    expect(response.status).toBe(404)
  })
})

describe('the statutory window is what the page is told', () => {
  it('reports the ceiling so the surface can show it', async () => {
    seedDispute()
    const body = await (await get()).json()
    expect(body.restoreBusinessDays).toBeLessThanOrEqual(
      COUNTER_NOTICE_MAX_BUSINESS_DAYS,
    )
    expect(body.counterNoticeStatuses).toContain('suitFiled')
  })
})

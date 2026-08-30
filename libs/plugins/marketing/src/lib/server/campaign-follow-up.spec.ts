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
 * SENDING AN EMAIL AGAIN, WITHOUT SENDING IT TO ANYBODY TWICE.
 *
 * The feature is one line of product — "send to the people who joined since"
 * — and four properties, every one of which is worse than not shipping it if
 * it is wrong:
 *
 *  1. Nobody the email has already reached is addressed again.
 *  2. Every gate the first send passed, the second passes: the consent split,
 *     both suppression lists, the topic filter, the monthly allowance and the
 *     two hourly ceilings.
 *  3. The counters on the report ADD rather than replace, so no rate can come
 *     out over its denominator.
 *  4. The unsubscribe links keep working — the `cid` inside their signature is
 *     the send id, and it does not move.
 *
 * ## What the double models, and why it has to
 *
 * Two Firestore semantics the write depends on, which the doubles in the
 * sibling specs do not have:
 *
 *   - `set(..., {merge: true})` merges a NESTED MAP field by field. That is
 *     the whole reason a follow-up cannot write a plain `stats.sent`: it would
 *     land on top of the first send's figure rather than beside it.
 *   - `FieldValue.increment` and `FieldValue.arrayUnion` are resolved against
 *     what is already stored. A double that kept the sentinel object would let
 *     an assertion pass while the product wrote `{increment: 3}` into the
 *     field a report divides by.
 *
 * A double that flattened either would make every assertion here vacuous.
 */

/*
 * Sentinels as hoisted FUNCTION declarations, not consts: a `jest.mock`
 * factory is hoisted above every binding in the file, and the object literals
 * below are built while a `const` would still be in its temporal dead zone.
 */
function increment(value: number) {
  return { __increment: value }
}
function arrayUnion(...values: string[]) {
  return { __arrayUnion: values }
}
function serverTimestamp() {
  return 'server-timestamp'
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `set(..., {merge: true})`, with the two sentinels resolved. */
function mergeInto(
  existing: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const next = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && '__increment' in value) {
      next[key] = Number(existing[key] ?? 0) + Number(value['__increment'])
    } else if (isPlainObject(value) && '__arrayUnion' in value) {
      const held = Array.isArray(existing[key]) ? existing[key] : []
      next[key] = [...new Set([...held, ...value['__arrayUnion']])]
    } else if (isPlainObject(value) && isPlainObject(existing[key])) {
      next[key] = mergeInto(existing[key], value)
    } else {
      next[key] = value
    }
  }
  return next
}

const store = new Map<string, Record<string, any>>()
const sent: Array<Record<string, any>> = []
/** Every `(orgId, count)` the monthly reservation was asked for. */
const reserved: number[] = []
/** Every `(reservation, delivered)` the reconcile settled. */
const reconciled: Array<{ reserved: number; delivered: number }> = []
/** Addresses the site's suppression list refuses. */
const suppressedAddresses = new Set<string>()
/** Addresses that have left the topic this email opens on. */
const topicOptOuts = new Set<string>()
/** `sendEmail` refuses these, as a provider rejection would. */
const rejectedAddresses = new Set<string>()

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    exists: data !== undefined,
    id: path.split('/').pop() as string,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>) => {
      store.set(path, mergeInto(store.get(path) ?? {}, value))
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

/** The ids directly under `path`, in the `__name__` order the sweep asks for. */
function childIds(path: string): string[] {
  return [...store.keys()]
    .filter(
      (key) =>
        key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
    )
    .map((key) => key.slice(path.length + 1))
    .sort()
}

function queryRef(path: string, after?: string): any {
  return {
    orderBy: () => queryRef(path, after),
    startAfter: (cursor: any) => queryRef(path, cursor?.id ?? String(cursor)),
    limit: (max: number) => ({
      get: async () => {
        const ids = childIds(path).filter((id) => !after || id > after)
        return { docs: ids.slice(0, max).map((id) => snapshotOf(`${path}/${id}`)) }
      },
    }),
  }
}

function collectionRef(path: string): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    ...queryRef(path),
    get parent() {
      return docRef(path.split('/').slice(0, -1).join('/'))
    },
  }
}

function mockFirestore(): any {
  return { collection: (name: string) => collectionRef(name) }
}

/*
 * The leaf `firebase-admin`, so the REAL reach module runs.
 *
 * `email-campaign-reach.ts` is the code under test here and is deliberately
 * NOT doubled — a stub of it could not tell a send that subtracts the right
 * people from one that subtracts none. What it needs from the admin SDK is
 * two field sentinels, and those are supplied here so the double above can
 * resolve them.
 */
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => mockFirestore() }),
    firestore: { FieldValue: { increment, arrayUnion, serverTimestamp } },
  },
}))

let mockUid = 'uid-1'

jest.mock('@aglyn/tenant-data-admin', () => ({
  // The real signer and URL builder: the `cid` a follow-up's links carry is
  // one of the four properties, and a doubled URL would prove nothing.
  ...jest.requireActual(
    '@aglyn/tenant-data-admin/server/email-unsubscribe-link',
  ),
  /*
   * `recordMarketingSends` is deliberately absent from this factory. The
   * sender imports it from the LEAF `email-marketing-gate`, which this barrel
   * mock does not intercept — so the REAL durable counter runs, against the
   * `firebase-admin` double above, and writes the window documents this file
   * asserts on. A stub here would only prove the sender called something.
   */
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockFirestore(),
      auth: () => ({
        verifyIdToken: async () => ({
          uid: mockUid,
          email: 'admin@example.com',
        }),
      }),
    }),
    firestore: {
      FieldValue: { increment, arrayUnion, serverTimestamp },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  /*
   * BOTH suppression lists, as one filter. Written against a real set rather
   * than left permissive: a follow-up that skipped this filter would look
   * identical to one that ran it if nobody in the fixture is suppressed.
   */
  filterSendableForHost: async (_hostId: string, emails: string[]) =>
    emails.filter((email) => !suppressedAddresses.has(email)),
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails.filter((email) => !topicOptOuts.has(email)),
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'starter' } }),
  resolveHostSendingIdentity: async () =>
    jest.requireActual('@aglyn/shared-util-email').resolveSendingIdentity({
      selection: null,
      platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
    }),
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
  meterHostEmail: async () => undefined,
  /*
   * The monthly allowance, backed by the same store the sender writes to, so
   * a follow-up's claim and refund are observable rather than assumed.
   */
  orgCampaignEmailSendsForMonth: async (orgId: string, month: string) =>
    Number(store.get(`orgs/${orgId}/counters/campaignEmailSends`)?.[month] ?? 0),
  reserveCampaignEmailSends: async ({ orgId, month, count, limit }: any) => {
    const path = `orgs/${orgId}/counters/campaignEmailSends`
    const used = Number(store.get(path)?.[month] ?? 0) || 0
    if (used + count > limit) return { ok: false, used, limit }
    store.set(path, { ...(store.get(path) ?? {}), [month]: used + count })
    reserved.push(count)
    return { ok: true, reservation: { orgId, month, reserved: count }, used, limit }
  },
  reconcileCampaignSendReservation: async (
    reservation: any,
    delivered: number,
  ) => {
    if (!reservation) return
    reconciled.push({ reserved: reservation.reserved, delivered })
    const refund = Math.max(0, reservation.reserved - delivered)
    if (refund <= 0) return
    const path = `orgs/${reservation.orgId}/counters/campaignEmailSends`
    const used = Number(store.get(path)?.[reservation.month] ?? 0) || 0
    store.set(path, {
      ...(store.get(path) ?? {}),
      [reservation.month]: Math.max(0, used - refund),
    })
  },
  readEmailSendRateConfig: async () => ({
    perHour: 100_000,
    enabled: true,
    updatedAtMs: null,
    updatedByEmail: null,
    note: '',
  }),
  claimOrgEmailSendBudget: async (options: any = {}) => {
    const ceiling = Math.max(
      1,
      Math.floor((options.platformPerHour ?? 100_000) * 0.25),
    )
    const count = Math.max(0, Math.floor(Number(options.count) || 0))
    return {
      allowed: true,
      used: 0,
      ceiling,
      remaining: Math.max(0, ceiling - count),
      retryAtMs: 3_600_000,
      degraded: false,
    }
  },
  readEmailSendRateWindow: async () => ({
    windowStartMs: 0,
    resetMs: 3_600_000,
    used: 0,
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, any>) => {
    const to = String(message.to ?? '')
    if (rejectedAddresses.has(to)) return { sent: false, reason: 'rejected' }
    sent.push(message)
    return { sent: true }
  },
}))

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { campaignReport } from '@aglyn/shared-ui-email-campaigns/model'
import { CAMPAIGN_REACH_CEILING } from '@aglyn/tenant-data-admin/server/email-campaign-reach'
import { campaignSendHandler, performCampaignSend } from './campaign-send'

const HOST = 'host-1'
const SEND_ID = 'spring-2026'

/** A lead with a recorded opt-in, which the consent join requires. */
function seedLead(id: string, email: string) {
  store.set(`hosts/${HOST}/leads/${id}`, {
    email,
    name: id,
    marketingConsent: true,
    marketingConsentAtMs: Date.UTC(2026, 7, 1),
  })
}

function seed() {
  store.clear()
  sent.length = 0
  reserved.length = 0
  reconciled.length = 0
  suppressedAddresses.clear()
  topicOptOuts.clear()
  rejectedAddresses.clear()
  mockUid = 'uid-1'
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
  })
  seedLead('lead-1', 'ada@example.com')
  seedLead('lead-2', 'bo@example.com')
}

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      /* unused */
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  }
  return { res, result }
}

async function post(body: Record<string, unknown>) {
  const { res, result } = makeResponse()
  await campaignSendHandler(
    {
      method: 'POST',
      query: {},
      body,
      cookies: {},
      headers: { authorization: 'Bearer token' },
    } as any,
    res,
  )
  return result
}

/** The original send: one email, to the leads that exist right now. */
const firstSend = (options: Record<string, unknown> = {}) =>
  performCampaignSend({
    hostId: HOST,
    campaignId: SEND_ID,
    subject: 'Spring sale',
    body: 'Ends Sunday',
    audience: 'leads',
    senderUid: 'uid-1',
    ...options,
  } as any)

/** The follow-up, through the route, which is the only way a merchant asks. */
const followUp = (body: Record<string, unknown> = {}) =>
  post({ hostId: HOST, action: 'followUp', campaignId: SEND_ID, ...body })

/** Who `sendEmail` was actually handed, since the last reset. */
const addressed = () => sent.map((message) => String(message.to)).sort()

/**
 * The key both suppression lists, the frequency window and the reach record
 * derive — `sha256` of the normalized address. Computed here the same way so
 * an assertion names a document the product actually wrote.
 */
const windowKey = (email: string) =>
  require('crypto').createHash('sha256').update(email).digest('hex')

const storedSend = () => store.get(`hosts/${HOST}/campaigns/${SEND_ID}`) ?? {}
const storedReach = () =>
  store.get(`hosts/${HOST}/campaigns/${SEND_ID}/reports/reached`) ?? {}

let previousSecret: string | undefined
beforeAll(() => {
  previousSecret = process.env['EMAIL_UNSUBSCRIBE_SECRET']
  process.env['EMAIL_UNSUBSCRIBE_SECRET'] = 'test-secret'
})
afterAll(() => {
  if (previousSecret === undefined) delete process.env['EMAIL_UNSUBSCRIBE_SECRET']
  else process.env['EMAIL_UNSUBSCRIBE_SECRET'] = previousSecret
})
beforeEach(seed)

// ---------------------------------------------------------------------------
// Property 1 — nobody is mailed twice
// ---------------------------------------------------------------------------

describe('a second send addresses nobody the first reached', () => {
  it('mails only the people who arrived after the first send', async () => {
    await firstSend()
    expect(addressed()).toEqual(['ada@example.com', 'bo@example.com'])

    sent.length = 0
    seedLead('lead-3', 'cy@example.com')
    seedLead('lead-4', 'di@example.com')

    const result = await followUp()

    expect(result.status).toBe(200)
    expect(addressed()).toEqual(['cy@example.com', 'di@example.com'])
    expect(result.body.sent).toBe(2)
    expect(result.body.alreadyReached).toBe(2)
    expect(result.body.followUp).toBe(true)
  })

  it('refuses when the whole audience already has the email', async () => {
    await firstSend()
    sent.length = 0

    const result = await followUp()

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toMatch(/already had this email/)
    expect(sent).toEqual([])
  })

  it('subtracts the people a THIRD send would otherwise re-reach', async () => {
    await firstSend()
    seedLead('lead-3', 'cy@example.com')
    await followUp()
    sent.length = 0

    seedLead('lead-4', 'di@example.com')
    await followUp()

    expect(addressed()).toEqual(['di@example.com'])
    expect(storedReach().count).toBe(4)
  })

  it('subtracts BEFORE the per-send cap, not after it', async () => {
    /*
     * The ordering that decides whether the feature works at all. The cap
     * takes the first N of a stable order, so a follow-up that capped first
     * would be handed the same people the original send took and would find
     * every one of them already reached — forever, for any audience larger
     * than one send.
     *
     * Proven at a cap of two by sending the first two leads, adding a third
     * that sorts LAST by document name, and requiring it to be mailed.
     */
    await firstSend()
    sent.length = 0
    seedLead('lead-9', 'zed@example.com')

    const result = await followUp()

    expect(result.status).toBe(200)
    expect(addressed()).toEqual(['zed@example.com'])
  })

  it('records the reach of the FIRST send, so the second has something to subtract', async () => {
    await firstSend()

    expect(storedReach().count).toBe(2)
    expect(storedReach().keys).toHaveLength(2)
    // Keys, never addresses: the record is a membership test and the send's
    // subcollection is readable by a site member.
    expect(JSON.stringify(storedReach())).not.toContain('ada@example.com')
  })
})

// ---------------------------------------------------------------------------
// Property 2 — every gate still applies
// ---------------------------------------------------------------------------

describe('a follow-up passes every gate the first send passed', () => {
  it('refuses an address on a suppression list', async () => {
    await firstSend()
    sent.length = 0
    seedLead('lead-3', 'cy@example.com')
    seedLead('lead-4', 'di@example.com')
    suppressedAddresses.add('cy@example.com')

    await followUp()

    expect(addressed()).toEqual(['di@example.com'])
  })

  it('refuses when every new recipient is suppressed', async () => {
    await firstSend()
    sent.length = 0
    seedLead('lead-3', 'cy@example.com')
    suppressedAddresses.add('cy@example.com')

    const result = await followUp()

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toMatch(/suppressed/)
    expect(sent).toEqual([])
  })

  it('refuses an address that has left the topic', async () => {
    await firstSend()
    sent.length = 0
    seedLead('lead-3', 'cy@example.com')
    seedLead('lead-4', 'di@example.com')
    topicOptOuts.add('di@example.com')

    await followUp()

    expect(addressed()).toEqual(['cy@example.com'])
  })

  it('withholds a new recipient whose consent is a recorded refusal', async () => {
    await firstSend()
    sent.length = 0
    seedLead('lead-3', 'cy@example.com')
    store.set(`hosts/${HOST}/leads/lead-4`, {
      email: 'di@example.com',
      marketingConsent: false,
      marketingConsentAtMs: Date.UTC(2026, 7, 2),
    })

    await followUp()

    expect(addressed()).toEqual(['cy@example.com'])
    expect(storedSend().stats.consentWithheld).toBe(1)
  })

  it('reserves the monthly allowance for the additional recipients only', async () => {
    await firstSend()
    expect(reserved).toEqual([2])
    seedLead('lead-3', 'cy@example.com')

    await followUp()

    expect(reserved).toEqual([2, 1])
    expect(
      store.get('orgs/org-1/counters/campaignEmailSends')?.[
        new Date().toISOString().slice(0, 7)
      ],
    ).toBe(3)
  })

  it('reconciles the reservation when a follow-up delivers fewer than it claimed', async () => {
    await firstSend()
    seedLead('lead-3', 'cy@example.com')
    seedLead('lead-4', 'di@example.com')
    rejectedAddresses.add('di@example.com')

    await followUp()

    // Claimed for two, delivered one, and the allowance is given the other back.
    expect(reconciled.at(-1)).toEqual({ reserved: 2, delivered: 1 })
    expect(
      store.get('orgs/org-1/counters/campaignEmailSends')?.[
        new Date().toISOString().slice(0, 7)
      ],
    ).toBe(3)
  })

  it('counts the follow-up toward each recipient marketing frequency window', async () => {
    await firstSend()
    seedLead('lead-3', 'cy@example.com')

    await followUp()

    /*
     * The window is COUNTED, not consulted, and both halves of that are the
     * campaign path's existing behavior rather than anything a follow-up
     * changes. A campaign is exempt from the frequency REFUSAL by design — a
     * reviewed, one-shot act whose recipient count is on screen before it
     * goes — and it yields the refusal to the automated paths while still
     * being most of the mail a person feels, so it counts. A follow-up
     * inherits both because it is the same code; what is asserted here is
     * that its recipients reach the durable counter at all, since a send that
     * skipped it would let the automated paths mail somebody who has just had
     * a campaign.
     */
    expect(
      store.get(`hosts/${HOST}/emailFrequency/${windowKey('cy@example.com')}`),
    ).toMatchObject({ email: 'cy@example.com' })
    expect(
      store.get(`hosts/${HOST}/emailFrequency/${windowKey('cy@example.com')}`)
        ?.sentAtMs,
    ).toHaveLength(1)
  })

  it('takes the copy from the record and not from the request', async () => {
    await firstSend()
    sent.length = 0
    seedLead('lead-3', 'cy@example.com')

    await followUp({
      subject: 'Free money',
      body: 'Click here',
      audience: 'members',
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toBe('Spring sale')
    expect(String(sent[0].text)).toContain('Ends Sunday')
  })
})

// ---------------------------------------------------------------------------
// Property 3 — the report's arithmetic
// ---------------------------------------------------------------------------

describe('the recorded populations add rather than replace', () => {
  it('sums what was addressed and what was sent across both sends', async () => {
    await firstSend()
    expect(storedSend().stats).toMatchObject({ recipients: 2, sent: 2 })

    seedLead('lead-3', 'cy@example.com')
    await followUp()

    expect(storedSend().stats).toMatchObject({
      recipients: 3,
      sent: 3,
      audienceSize: 3,
    })
    expect(storedSend().sendCount).toBe(2)
  })

  it('keeps every rate inside its denominator once the webhook has counted both sends', async () => {
    await firstSend()
    seedLead('lead-3', 'cy@example.com')
    await followUp()

    /*
     * The delivery webhook increments against the SAME `campaignId`, so its
     * counters already span both sends. That is the shape that breaks if
     * `sent` is replaced rather than added to: three delivered over one sent
     * is a delivery rate of 300%.
     */
    const path = `hosts/${HOST}/campaigns/${SEND_ID}`
    store.set(
      path,
      mergeInto(store.get(path) ?? {}, {
        stats: {
          delivered: increment(3),
          uniqueOpens: increment(3),
          uniqueClicks: increment(2),
          bounced: increment(0),
          complained: increment(0),
          unsubscribes: increment(1),
        },
      }),
    )

    const report = campaignReport(storedSend().stats)
    // Every rate hangs off `rates` — the report's own top level holds the
    // COUNTS, and a rate read from there is `undefined`, which this loop
    // would have skipped as "not recorded" while asserting nothing.
    const rates = [
      report.rates.delivery,
      report.rates.open,
      report.rates.click,
      report.rates.clickToOpen,
      report.rates.bounce,
      report.rates.complaint,
      report.rates.unsubscribe,
    ]
    expect(rates.some((rate) => rate !== null)).toBe(true)
    for (const rate of rates) {
      if (!rate) continue
      expect(rate.value).toBeLessThanOrEqual(rate.denominator)
      expect(rate.denominator).toBeGreaterThan(0)
    }
  })

  it('leaves `sentAt` on the first send and dates the follow-up separately', async () => {
    await firstSend()
    const firstSentAt = storedSend().sentAt
    seedLead('lead-3', 'cy@example.com')

    await followUp()

    expect(storedSend().sentAt).toBe(firstSentAt)
    expect(storedSend().lastSentAt).toBe('server-timestamp')
    expect(storedSend().status).toBe('sent')
  })
})

// ---------------------------------------------------------------------------
// Property 4 — the unsubscribe link
// ---------------------------------------------------------------------------

describe('the unsubscribe link keeps resolving', () => {
  it('carries the ORIGINAL send id as `cid` on the follow-up messages', async () => {
    await firstSend()
    const firstLink = String(sent[0].headers['List-Unsubscribe'])
    sent.length = 0
    seedLead('lead-3', 'cy@example.com')

    await followUp()

    const followUpLink = String(sent[0].headers['List-Unsubscribe'])
    expect(firstLink).toContain(`cid=${SEND_ID}`)
    expect(followUpLink).toContain(`cid=${SEND_ID}`)
    // Same email, same opt-out scope: one `cid` for one mailing, so an
    // unsubscribe from either send lands on the same record.
    expect(new URL(followUpLink.slice(1, -1)).searchParams.get('cid')).toBe(
      SEND_ID,
    )
  })
})

// ---------------------------------------------------------------------------
// What a follow-up is refused for
// ---------------------------------------------------------------------------

describe('a follow-up is refused when it cannot be made safely', () => {
  it('refuses an email with no record of who it reached', async () => {
    /*
     * Every email sent before the record existed is in this state, and it is
     * the case that MUST refuse: nobody can say who that send went to, so any
     * follow-up is a coin toss on a stranger's inbox.
     */
    await firstSend()
    seedLead('lead-3', 'cy@example.com')
    store.delete(`hosts/${HOST}/campaigns/${SEND_ID}/reports/reached`)
    sent.length = 0

    const result = await followUp()

    expect(result.status).toBe(409)
    expect(String(result.body.error)).toMatch(/complete record/)
    expect(sent).toEqual([])
  })

  it('refuses when the record is short of what the email has sent', async () => {
    await firstSend()
    seedLead('lead-3', 'cy@example.com')
    const path = `hosts/${HOST}/campaigns/${SEND_ID}/reports/reached`
    store.set(path, { keys: [store.get(path)?.keys[0]], count: 1 })
    sent.length = 0

    const result = await followUp()

    expect(result.status).toBe(409)
    expect(sent).toEqual([])
  })

  it('refuses an email that has not been sent', async () => {
    store.set(`hosts/${HOST}/campaigns/${SEND_ID}`, {
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
      status: 'scheduled',
      sendAtMs: Date.now() + 60_000,
    })

    const result = await followUp()

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toMatch(/already been sent/)
    expect(sent).toEqual([])
  })

  it('refuses an email nobody has ever sent under that id', async () => {
    const result = await followUp({ campaignId: 'never-existed' })

    expect(result.status).toBe(404)
    expect(sent).toEqual([])
  })

  it('refuses a send whose addresses were typed into the composer', async () => {
    /*
     * Seeded rather than sent, because a `manual` send's addresses are the one
     * audience this suite cannot produce from a fixture: a hand-typed address
     * is backed by no document, so it carries no consent basis and the join
     * refuses it. What matters here is the SHAPE of the stored record — an
     * audience whose membership was never written down.
     */
    store.set(`hosts/${HOST}/campaigns/${SEND_ID}`, {
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'manual',
      status: 'sent',
      stats: { recipients: 1, sent: 1 },
    })
    store.set(`hosts/${HOST}/campaigns/${SEND_ID}/reports/reached`, {
      keys: [windowKey('ada@example.com')],
      count: 1,
    })
    sent.length = 0

    const result = await followUp()

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toMatch(/typed into the composer/)
    expect(sent).toEqual([])
  })

  it('refuses a campaignId that names a path rather than an id', async () => {
    const result = await followUp({ campaignId: 'a/b/c' })

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toMatch(/Invalid campaignId/)
  })

  it('refuses a reader who is neither an admin nor an editor', async () => {
    await firstSend()
    sent.length = 0
    seedLead('lead-3', 'cy@example.com')
    mockUid = 'uid-stranger'

    const result = await followUp()

    expect(result.status).toBe(403)
    expect(sent).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The count the console asks for before offering the button
// ---------------------------------------------------------------------------

describe('the reach record stays inside what one document can hold', () => {
  it('refuses a follow-up once the email has reached the ceiling', async () => {
    /*
     * The record is one document, and the ceiling is the audience scan
     * ceiling the sender already has — a send cannot resolve more people than
     * that, so an email past it has been re-sent enough times to have
     * addressed more people than any one of its audiences can hold. Refused
     * with a reason rather than left to a write that starts failing at a
     * megabyte.
     */
    await firstSend()
    seedLead('lead-3', 'cy@example.com')
    const path = `hosts/${HOST}/campaigns/${SEND_ID}/reports/reached`
    const filler = Array.from({ length: CAMPAIGN_REACH_CEILING }, (_, index) =>
      windowKey(`filler-${index}@example.com`),
    )
    store.set(path, { keys: filler, count: filler.length })
    store.set(`hosts/${HOST}/campaigns/${SEND_ID}`, {
      ...storedSend(),
      stats: { ...storedSend().stats, sent: filler.length },
    })
    sent.length = 0

    const result = await followUp()

    expect(result.status).toBe(409)
    expect(String(result.body.error)).toMatch(/most one email may reach/)
    expect(sent).toEqual([])
  })
})

describe('a follow-up stays inside the campaign the email belongs to', () => {
  it('keeps the container, so the campaign rollup still covers it', async () => {
    await firstSend({ emailCampaignId: 'camp-1' })
    seedLead('lead-3', 'cy@example.com')

    await followUp()

    // One document, one container, and the rollup that sums this campaign's
    // emails goes on finding it by the field it has always carried.
    expect(storedSend().emailCampaignId).toBe('camp-1')
    expect(storedSend().stats.sent).toBe(3)
  })
})

describe('the dry run answers from the code that would do the sending', () => {
  it('reports how many are left and how many already have it', async () => {
    await firstSend()
    seedLead('lead-3', 'cy@example.com')
    sent.length = 0

    const result = await followUp({ dryRun: true })

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      dryRun: true,
      followUp: true,
      alreadyReached: 2,
      audienceSize: 1,
      sendable: 1,
    })
    // A count is a read. Nothing left, nothing was claimed, nothing recorded.
    expect(sent).toEqual([])
    expect(reserved).toEqual([2])
    expect(storedSend().sendCount).toBe(1)
  })
})

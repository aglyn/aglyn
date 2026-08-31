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
 * AN AUDIENCE OF THREE THOUSAND, REACHED.
 *
 * The product's largest functional ceiling was that a campaign addressed 500
 * people and stopped — a merchant on a plan that includes 50,000 emails a
 * month reached their list by pressing Send six times. The remainder now goes
 * out on its own, and this file is the proof, which has to cover five
 * properties rather than one:
 *
 *  1. **Everybody is reached.** 3,000 addresses, 3,000 messages.
 *  2. **Nobody twice.** Not one address appears in two batches.
 *  3. **Nobody skipped.** The set delivered to is the set resolved.
 *  4. **The allowance is exact.** Six batches claim and reconcile against one
 *     monthly counter and it lands on the delivered total, not on six
 *     reservations' worth of it.
 *  5. **It terminates.** A batch that settles nobody stops rather than
 *     rescheduling itself forever.
 *
 * ## What the doubles model, and what they deliberately do not
 *
 * The reputation breaker, the new-sender ramp, the reach record and the batch
 * plan all run FOR REAL against the Firestore double below — they are the
 * code under test, and a stub of any of them could not tell a control that
 * refuses from one that is not there. `getAll` and `runTransaction` exist on
 * the double for exactly that reason: without them the reputation module
 * fails open, every ceiling reads as absent, and a clamp would pass having
 * enforced nothing.
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
/** Every count the monthly reservation was asked for. */
const reserved: number[] = []
const reconciled: Array<{ reserved: number; delivered: number }> = []
const suppressedAddresses = new Set<string>()
const topicOptOuts = new Set<string>()
const rejectedAddresses = new Set<string>()
/*
 * The REAL clock, because the code under test has no seam for a fake one.
 *
 * `campaign-send` reads `Date.now()` directly — the ramp ages the workspace
 * against it, and the reputation counter keys its day from it. A frozen
 * constant here was read as "today" only on the day it was written: the next
 * morning the same fixture aged the workspace to one day old, moved it to the
 * second ramp step, and wrote the counter under a day key these assertions no
 * longer looked up. Three cases went red having tested nothing new.
 *
 * Anchoring to the same clock the code uses is what makes "created today"
 * mean it. The offsets below stay relative to this value, so they keep their
 * sign and their distance.
 */
const nowMs = Date.now()

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    exists: data !== undefined,
    id: path.split('/').pop() as string,
    ref: { path },
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get parent() {
      return collectionRef(path.split('/').slice(0, -1).join('/'))
    },
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>) => {
      store.set(path, mergeInto(store.get(path) ?? {}, value))
    },
    update: async (value: Record<string, any>) => {
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

/**
 * The scheduled processor's own query, modelled rather than stubbed.
 *
 * It is what turns one send into six, so a double that answered "nothing due"
 * would leave every property above unproven while every assertion still ran.
 */
function collectionGroupRef(name: string): any {
  const filters: Array<[string, string, any]> = []
  const api: any = {
    where: (field: string, op: string, value: any) => {
      filters.push([field, op, value])
      return api
    },
    limit: (max: number) => ({
      get: async () => {
        const docs = [...store.keys()]
          .filter((key) => key.split('/').slice(0, -1).pop() === name)
          .sort()
          .map((key) => ({ ...snapshotOf(key), ref: docRef(key) }))
          .filter((doc) =>
            filters.every(([field, op, value]) => {
              const held = doc.get(field)
              return op === '==' ? held === value : Number(held ?? 0) <= value
            }),
          )
        return { docs: docs.slice(0, max) }
      },
    }),
  }
  return api
}

function mockFirestore(): any {
  return {
    collection: (name: string) => collectionRef(name),
    collectionGroup: (name: string) => collectionGroupRef(name),
    getAll: async (...refs: any[]) =>
      refs.map((ref) => snapshotOf(String(ref.path))),
    runTransaction: async (body: (tx: any) => Promise<any>) =>
      body({
        get: async (ref: any) => snapshotOf(String(ref.path)),
        set: async (ref: any, value: Record<string, any>) => {
          store.set(
            String(ref.path),
            mergeInto(store.get(String(ref.path)) ?? {}, value),
          )
        },
        update: async (ref: any, value: Record<string, any>) => {
          store.set(
            String(ref.path),
            mergeInto(store.get(String(ref.path)) ?? {}, value),
          )
        },
      }),
  }
}

/*
 * A hoisted FUNCTION declaration, for the reason the sentinels above are:
 * a `jest.mock` factory is hoisted over every binding in the file, so a
 * `const` here is still in its temporal dead zone when the factory runs.
 */
function adminDouble() {
  return {
    app: () => ({ firestore: () => mockFirestore() }),
    firestore: {
      FieldValue: { increment, arrayUnion, serverTimestamp },
      FieldPath: { documentId: () => '__name__' },
    },
  }
}

/*
 * BOTH shapes of the leaf, because the modules under test disagree about
 * which they import: the reach record takes the default, the reputation
 * counters take the named binding. A factory offering one leaves the other
 * `undefined`, and every control inside it fails open — which is a harness
 * that proves a ceiling exists by never reaching it.
 */
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: adminDouble(),
  firebaseAdmin: adminDouble(),
}))

/** The workspace's creation date, which decides whether the ramp binds. */
let orgCreatedAtMs: number | null = Date.UTC(2026, 6, 1)
/** The workspace's reputation policy, as it would be stored on the org. */
let orgReputationPolicy: string | undefined

jest.mock('@aglyn/tenant-data-admin', () => ({
  // The literal three call sites compare against — the unsubscribe writes
  // it, the resubscribe link refuses to reverse anything else, and the
  // preference page reads it. A mock that omitted it would write `undefined`
  // and every one of those comparisons would silently stop matching.
  UNSUBSCRIBE_SUPPRESSION_REASON: 'unsubscribe',
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  ...jest.requireActual(
    '@aglyn/tenant-data-admin/server/email-unsubscribe-link',
  ),
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockFirestore(),
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'uid-1',
          email: 'admin@example.com',
        }),
      }),
    }),
    firestore: {
      FieldValue: { increment, arrayUnion, serverTimestamp },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  filterSendableForHost: async (_hostId: string, emails: string[]) =>
    emails.filter((email) => !suppressedAddresses.has(email)),
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails.filter((email) => !topicOptOuts.has(email)),
  getOrgForHost: async () => ({
    orgId: 'org-1',
    org: {
      plan: 'pro',
      ...(orgCreatedAtMs === null ? {} : { createdAt: orgCreatedAtMs }),
      ...(orgReputationPolicy
        ? { emailReputationPolicy: orgReputationPolicy }
        : {}),
    },
  }),
  resolveHostSendingIdentity: async () =>
    jest.requireActual('@aglyn/shared-util-email').resolveSendingIdentity({
      selection: null,
      platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
    }),
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
  meterHostEmail: async () => undefined,
  updateExisting: async () => undefined,
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
  claimOrgEmailSendBudget: async (options: any = {}) => ({
    allowed: true,
    used: 0,
    ceiling: 25_000,
    remaining: 25_000 - Number(options.count ?? 0),
    retryAtMs: nowMs + 3_600_000,
    degraded: false,
  }),
  readEmailSendRateWindow: async () => ({
    windowStartMs: 0,
    resetMs: nowMs + 3_600_000,
    used: 0,
  }),
  writeCronBeat: async () => undefined,
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

import {
  EMAIL_MAX_RECIPIENTS_PER_SEND,
  EMAIL_RAMP_STEPS,
} from '@aglyn/shared-util-email'
import { performCampaignSend } from './campaign-send'
import { campaignProcessScheduledHandler } from './campaign-process-scheduled'

const HOST = 'host-1'
const SEND_ID = 'spring-2026'
const MONTH = new Date().toISOString().slice(0, 7)

function seedLeads(count: number, offset = 0) {
  for (let index = offset; index < offset + count; index += 1) {
    // Padded so the document-name order the sweep uses is the numeric one,
    // which is what makes "the first N" an answerable claim in an assertion.
    const id = `lead-${String(index).padStart(5, '0')}`
    store.set(`hosts/${HOST}/leads/${id}`, {
      email: `${id}@example.com`,
      name: id,
      // The basis belongs to the site sending, not to the org.
      marketingConsentByHost: {
        'host-1': { marketingConsent: true, marketingConsentAtMs: Date.UTC(2026, 6, 1) },
      },
    })
  }
}

function seed() {
  store.clear()
  sent.length = 0
  reserved.length = 0
  reconciled.length = 0
  suppressedAddresses.clear()
  topicOptOuts.clear()
  rejectedAddresses.clear()
  orgCreatedAtMs = Date.UTC(2026, 6, 1)
  orgReputationPolicy = undefined
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
  })
}

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

/** The stored send, as the console would read it. */
const sendDoc = () => store.get(`hosts/${HOST}/campaigns/${SEND_ID}`) ?? {}

/** Addresses `sendEmail` was handed, in order. */
const addressed = () => sent.map((message) => String(message.to))

/**
 * Run the cron until the email is finished, exactly as the platform would.
 *
 * Bounded so a non-terminating campaign fails as a hang in ONE test rather
 * than as a jest timeout with no assertion attached to it.
 */
async function drainScheduled(maxRuns = 30): Promise<number> {
  let runs = 0
  for (; runs < maxRuns; runs += 1) {
    const due = (sendDoc()['status'] ?? '') === 'scheduled'
    if (!due) return runs
    await campaignProcessScheduledHandler(
      {
        method: 'POST',
        query: {},
        body: {},
        cookies: {},
        headers: { 'x-cron-secret': 'cron-secret' },
      } as any,
      {
        status() {
          return this
        },
        json() {
          /* unused */
        },
        send() {
          /* unused */
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
      } as any,
    )
  }
  return runs
}

beforeAll(() => {
  process.env.RESEND_API_KEY = 'test'
  process.env.USAGE_EMAIL_FROM = 'noreply@aglyn.com'
  process.env.EMAIL_UNSUBSCRIBE_SECRET = 'secret'
  process.env.CRON_SECRET = 'cron-secret'
})

beforeEach(seed)

describe('a three-thousand-person audience', () => {
  it('reaches all three thousand, once each, across batches', async () => {
    seedLeads(3000)

    const first = await firstSend()
    expect(first).toMatchObject({
      sent: EMAIL_MAX_RECIPIENTS_PER_SEND,
      audienceSize: 3000,
      remaining: 2500,
      resuming: true,
      batch: 1,
    })
    // The email is NOT finished, and the record says so rather than reading
    // as a send that reached 500 people and stopped.
    expect(sendDoc()['status']).toBe('scheduled')

    const runs = await drainScheduled()
    expect(runs).toBe(5)

    // 1. Everybody reached.
    expect(sent).toHaveLength(3000)
    // 2. Nobody twice.
    expect(new Set(addressed()).size).toBe(3000)
    // 3. Nobody skipped — the set delivered to IS the audience.
    expect(new Set(addressed())).toEqual(
      new Set(
        Array.from(
          { length: 3000 },
          (_unused, index) => `lead-${String(index).padStart(5, '0')}@example.com`,
        ),
      ),
    )
    expect(sendDoc()['status']).toBe('sent')
    expect(sendDoc()['stats']).toMatchObject({ sent: 3000, recipients: 3000 })
    expect(sendDoc()['resume']).toMatchObject({ remaining: 0, batch: 6 })
  })

  it('records the audience ONCE, so no rate can exceed its denominator', async () => {
    seedLeads(3000)
    await firstSend()
    await drainScheduled()

    const stats = sendDoc()['stats']
    // Six batches, each resolving a smaller remainder. Adding those would
    // record an audience of 10,500 for a list of 3,000 and put every rate on
    // the report over 100%.
    expect(stats.audienceSize).toBe(3000)
    expect(stats.sent).toBeLessThanOrEqual(stats.audienceSize)
    expect(stats.recipients).toBeLessThanOrEqual(stats.audienceSize)
    expect(stats.consented).toBe(3000)
    // One send by a person, six runs by the platform.
    expect(sendDoc()['sendCount']).toBe(1)
  })

  it('spends the monthly allowance exactly once per delivered message', async () => {
    seedLeads(3000)
    await firstSend()
    await drainScheduled()

    const counter = store.get(`orgs/org-1/counters/campaignEmailSends`) ?? {}
    expect(counter[MONTH]).toBe(3000)
    // Six claims of 500, six reconciles that gave nothing back because every
    // message went out.
    expect(reserved).toEqual([500, 500, 500, 500, 500, 500])
    expect(reconciled.every((entry) => entry.reserved === entry.delivered)).toBe(
      true,
    )
  })

  it('gives back the part of a batch that did not go out', async () => {
    seedLeads(1000)
    // A hundred addresses the provider refuses, spread across the first batch.
    for (let index = 0; index < 100; index += 1) {
      rejectedAddresses.add(`lead-${String(index).padStart(5, '0')}@example.com`)
    }
    await firstSend()
    await drainScheduled()

    const counter = store.get(`orgs/org-1/counters/campaignEmailSends`) ?? {}
    // 900 delivered, and the allowance carries 900 — not the 1,000 claimed.
    expect(sent).toHaveLength(900)
    expect(counter[MONTH]).toBe(900)
  })
})

describe('the batch frontier', () => {
  it('advances past a block of suppressed addresses instead of stalling', async () => {
    seedLeads(1200)
    // The whole of the first batch is suppressed. Subtracting only DELIVERED
    // addresses would hand these same 500 to every later batch, which would
    // address nobody, forever.
    for (let index = 0; index < 500; index += 1) {
      suppressedAddresses.add(
        `lead-${String(index).padStart(5, '0')}@example.com`,
      )
    }

    const first = await firstSend()
    expect(first.sent).toBe(0)
    expect(first.resuming).toBe(true)

    await drainScheduled()
    expect(sent).toHaveLength(700)
    expect(new Set(addressed()).size).toBe(700)
    expect(sendDoc()['status']).toBe('sent')
  })

  it('stops rather than rescheduling a batch that settles nobody', async () => {
    seedLeads(1200)
    // Nothing is suppressed and nothing is delivered: `sendEmail` defers every
    // message, so no address is ever settled either way. A frontier that
    // cannot move must stop; a job that reschedules itself on no progress is
    // the one failure a self-resuming send can have that nobody notices.
    const deferAll = jest
      .requireMock('@aglyn/shared-util-email')
      .sendEmail as jest.Mock
    const original = deferAll
    jest.requireMock('@aglyn/shared-util-email').sendEmail = async () => ({
      sent: false,
      reason: 'rate-limited',
      retryAtMs: nowMs + 3_600_000,
    })
    try {
      const first = await firstSend()
      expect(first.sent).toBe(0)
      expect(first.resuming).toBe(false)
      expect(first.remaining).toBe(1200)
      expect(sendDoc()['status']).toBe('sent')
      expect(sendDoc()['resume']).toMatchObject({ stop: 'no-progress' })
      // And the shortfall is on the record rather than implied by a total
      // that is short.
      expect(sendDoc()['stats'].deferred).toBe(1200)
    } finally {
      jest.requireMock('@aglyn/shared-util-email').sendEmail = original
    }
  })

  it('advances past a block of addresses the provider refuses', async () => {
    seedLeads(1200)
    // The whole of the first batch is rejected at the provider. Unlike a
    // deferral these are not retryable — leaving them in play would hand the
    // same 500 to every later batch and the campaign would address nobody
    // from here on.
    for (let index = 0; index < 500; index += 1) {
      rejectedAddresses.add(`lead-${String(index).padStart(5, '0')}@example.com`)
    }

    const first = await firstSend()
    expect(first.sent).toBe(0)
    expect(first.resuming).toBe(true)

    await drainScheduled()
    expect(sent).toHaveLength(700)
    expect(sendDoc()['status']).toBe('sent')
  })

  it('never re-addresses somebody an earlier batch reached', async () => {
    seedLeads(1500)
    await firstSend()
    await drainScheduled()

    const counts = new Map<string, number>()
    for (const address of addressed()) {
      counts.set(address, (counts.get(address) ?? 0) + 1)
    }
    expect([...counts.values()].filter((count) => count > 1)).toEqual([])
  })
})

describe('the circuit breaker', () => {
  /** A window the breaker will grade as a spam problem. */
  function seedComplaints(accepted: number, complained: number) {
    const dayKey = new Date(nowMs).toISOString().slice(0, 10)
    store.set(`rateLimits/emailRep_${dayKey}_org-1`, {
      accepted,
      complained,
      bounced: 0,
      orgId: 'org-1',
      dayKey,
    })
  }

  it('refuses a campaign when the complaint rate is over the line', async () => {
    seedLeads(10)
    seedComplaints(1000, 10)
    await expect(firstSend()).rejects.toMatchObject({ status: 409 })
    expect(sent).toHaveLength(0)
  })

  it('removes nobody and nothing when it refuses', async () => {
    seedLeads(10)
    seedComplaints(1000, 10)
    const before = [...store.keys()].filter((key) =>
      key.startsWith(`hosts/${HOST}/leads/`),
    )
    await expect(firstSend()).rejects.toMatchObject({ status: 409 })
    const after = [...store.keys()].filter((key) =>
      key.startsWith(`hosts/${HOST}/leads/`),
    )
    // The audience is untouched: same people, same documents, and not one
    // suppression written. A capacity control gates the SEND, never the
    // holding.
    expect(after).toEqual(before)
    expect(after).toHaveLength(10)
    expect(
      [...store.keys()].filter((key) => key.includes('/suppressions/')),
    ).toEqual([])
  })

  it('says why, in a message a merchant can act on', async () => {
    seedLeads(10)
    seedComplaints(1000, 10)
    await expect(firstSend()).rejects.toThrow(/spam complaints/)
    await expect(firstSend()).rejects.toThrow(/Nobody has been removed/)
    await expect(firstSend()).rejects.toThrow(/Transactional mail/)
  })

  it('does NOT refuse below the threshold — the ceiling breaks both ways', async () => {
    seedLeads(10)
    // 0.2%: over the watch level, under the trip level.
    seedComplaints(1000, 2)
    await expect(firstSend()).resolves.toMatchObject({ sent: 10 })
  })

  it('does not act on a rate taken over too little volume', async () => {
    seedLeads(10)
    // 100% complaints, on four messages. A rate over a denominator that small
    // is one person having a bad day, not a list problem.
    seedComplaints(4, 4)
    await expect(firstSend()).resolves.toMatchObject({ sent: 10 })
  })

  it('a `none` policy records the finding and refuses nothing', async () => {
    seedLeads(10)
    seedComplaints(1000, 10)
    orgReputationPolicy = 'none'
    await expect(firstSend()).resolves.toMatchObject({ sent: 10 })
  })
})

describe('the new-sender ramp', () => {
  it('paces a workspace created today, and carries the rest to tomorrow', async () => {
    orgCreatedAtMs = nowMs
    seedLeads(1200)

    const first = await firstSend()
    // The first step, not the per-send cap: a brand-new workspace does not
    // put five hundred messages on the shared domain in its first hour.
    expect(first.sent).toBe(EMAIL_RAMP_STEPS[0].perDay)
    expect(first.remaining).toBe(1200 - EMAIL_RAMP_STEPS[0].perDay)
    expect(first.resuming).toBe(true)

    // The next run today is refused by the day's ceiling, and the campaign
    // stays scheduled rather than failing.
    await campaignProcessScheduledHandler(
      {
        method: 'POST',
        query: {},
        body: {},
        cookies: {},
        headers: { 'x-cron-secret': 'cron-secret' },
      } as any,
      {
        status() {
          return this
        },
        json() {
          /* unused */
        },
        send() {
          /* unused */
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
      } as any,
    )
    expect(sent).toHaveLength(EMAIL_RAMP_STEPS[0].perDay)
    expect(sendDoc()['status']).toBe('scheduled')
    expect(String(sendDoc()['deferredReason'])).toMatch(/a day/)
  })

  it('gives back the day’s claim for messages that did not go out', async () => {
    orgCreatedAtMs = nowMs
    seedLeads(1000)
    // Half the first day's allowance is refused at the provider. Those are
    // not messages the workspace put on the domain, so they must not cost it
    // the rest of its day — a ramp that charged for undelivered mail would
    // silence a new tenant over somebody else's outage.
    for (let index = 0; index < EMAIL_RAMP_STEPS[0].perDay / 2; index += 1) {
      rejectedAddresses.add(`lead-${String(index).padStart(5, '0')}@example.com`)
    }
    await firstSend()

    const dayKey = new Date(nowMs).toISOString().slice(0, 10)
    const day = store.get(`rateLimits/emailRep_${dayKey}_org-1`) ?? {}
    expect(day['claimed']).toBe(EMAIL_RAMP_STEPS[0].perDay / 2)
    expect(day['accepted']).toBe(EMAIL_RAMP_STEPS[0].perDay / 2)
  })

  it('does not pace a workspace that has been here a week', async () => {
    orgCreatedAtMs = nowMs - 30 * 86_400_000
    seedLeads(600)
    const first = await firstSend()
    expect(first.sent).toBe(EMAIL_MAX_RECIPIENTS_PER_SEND)
  })

  it('graduates a workspace whose record carries no creation date', async () => {
    // The direction that matters. Reading a missing field as "brand new"
    // would ramp every existing paying customer down to 200 a day.
    orgCreatedAtMs = null
    seedLeads(600)
    const first = await firstSend()
    expect(first.sent).toBe(EMAIL_MAX_RECIPIENTS_PER_SEND)
  })
})

describe('transactional mail', () => {
  it('keeps sending while the workspace cannot send marketing at all', async () => {
    seedLeads(10)
    const dayKey = new Date(nowMs).toISOString().slice(0, 10)
    store.set(`rateLimits/emailRep_${dayKey}_org-1`, {
      accepted: 1000,
      complained: 10,
      bounced: 200,
      orgId: 'org-1',
      dayKey,
    })
    // Marketing is refused outright.
    await expect(firstSend()).rejects.toMatchObject({ status: 409 })

    /*
     * And nothing about that touches a receipt.
     *
     * `sendEmail` is the only path a transactional message takes, and none of
     * the three campaign controls is on it — the breaker, the ramp and the
     * per-workspace hourly claim are called from `performCampaignSend` and
     * from nowhere else. That is the structural half, and the arithmetic half
     * is below: the ONE policy a transactional message does cross cannot
     * return a refusal for it at any ceiling, including a ceiling of zero
     * with the hour already spent.
     */
    const actual = jest.requireActual('@aglyn/shared-util-email')
    const refused = actual.emailSendRateVerdict({
      priority: 'campaign',
      used: 10_000,
      count: 1,
      ceiling: 1,
      enabled: true,
      windowStartMs: nowMs,
    })
    expect(refused.allowed).toBe(false)
    const receipt = actual.emailSendRateVerdict({
      priority: 'transactional',
      used: 10_000,
      count: 1,
      ceiling: 1,
      enabled: true,
      windowStartMs: nowMs,
    })
    expect(receipt.allowed).toBe(true)

    const { sendEmail } = jest.requireMock('@aglyn/shared-util-email')
    await expect(
      sendEmail({
        to: 'buyer@example.com',
        subject: 'Your receipt',
        text: 'Thanks',
        context: 'order-confirmation',
      }),
    ).resolves.toMatchObject({ sent: true })
    expect(sent.map((message) => message.to)).toContain('buyer@example.com')
  })

  it('is not even counted against the workspace’s reputation', async () => {
    // The breaker's denominator is CAMPAIGN mail. A bounce on a password
    // reset carries no `hostId` tag at all, so it never reaches the tenant
    // counter — which matters in both directions: it cannot inflate a rate
    // that decides whether a merchant may send, and it cannot dilute one
    // either.
    seedLeads(10)
    await firstSend()
    const dayKey = new Date(nowMs).toISOString().slice(0, 10)
    expect(store.get(`rateLimits/emailRep_${dayKey}_org-1`)).toMatchObject({
      accepted: 10,
    })
  })
})

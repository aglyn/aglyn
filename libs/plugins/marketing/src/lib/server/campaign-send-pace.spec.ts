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
 * THE PACE INSIDE ONE BATCH, AND WHAT A REFUSED REQUEST COSTS.
 *
 * The hourly governor decides how many messages a workspace may put on the
 * sending domain in an hour. It says nothing about how closely together they
 * arrive, and the provider counts the second: Resend documents 10 requests
 * per second per team and answers `429` past it. A batch of five hundred
 * recipients in a sequential `await` loop is paced by nothing but the round
 * trip, so the same code is inside the limit against a slow network and over
 * it against a fast one.
 *
 * ## Why this file does not stub `sendEmail`
 *
 * Every other campaign suite replaces `sendEmail` with a function that
 * returns whatever the fixture queued. That is the right double for testing
 * what the loop does with an outcome, and the wrong one here, because the two
 * things under test — the interval between requests, and how an HTTP 429 is
 * classified — both live BELOW that seam. A queued `{ sent: false }` would
 * certify a loop that paces nothing against a provider that refuses nothing.
 *
 * So the real sender runs and `global.fetch` is the provider: an in-memory
 * Resend that counts requests per second, accepts what fits and refuses the
 * rest with a real 429. It throws on any host but Resend's, so a future edit
 * that reached the network fails here rather than on the domain.
 *
 * ## The assertion every case makes
 *
 * `sent` is the numerator of every rate on a campaign report, and it is its
 * own source — no delivery rate can reveal a message counted into it that
 * never left. So each case below asserts the reported figure against what the
 * fake provider ACCEPTED, which is the only number in the system derived
 * independently of the sender's own bookkeeping.
 */

const mockState: {
  store: Record<string, Record<string, any>>
} = { store: {} }

/**
 * The fake Resend.
 *
 * Two ways to refuse, because the two things under test need different
 * evidence. `limitPerSecond` is the real shape of the control — a rolling
 * window, which is what a pace has to satisfy — and a busy machine can only
 * ever spread requests further apart, so a case built on it cannot flake into
 * a false pass. `acceptAtMost` refuses past a COUNT and is deliberately
 * indifferent to the clock: the cases about what a 429 costs must land the
 * refusal on a known request whether the run took a second or a minute.
 */
const provider: {
  limitPerSecond: number
  /** Refuse everything past this many accepted, whatever the timing. */
  acceptAtMost: number | null
  /** Addresses it took, in order — the independent `sent` figure. */
  accepted: string[]
  /** Addresses it answered 429 to. */
  refused: string[]
  /** Addresses it answers 422 to, whatever the rate. */
  rejects: Set<string>
  /** Every request instant, which is also what the limiter counts. */
  atMs: number[]
} = {
  limitPerSecond: 10,
  acceptAtMost: null,
  accepted: [],
  refused: [],
  rejects: new Set(),
  atMs: [],
}

function fakeResend(): typeof fetch {
  return (async (url: any, init: any) => {
    const target = String(url)
    if (!target.startsWith('https://api.resend.com/')) {
      throw new Error(`Blocked outbound request in a spec: ${target}`)
    }
    const body = JSON.parse(init.body)
    const to = String(Array.isArray(body.to) ? body.to[0] : body.to)
    const nowMs = Date.now()
    // Counted BEFORE this request is recorded, and a refused request still
    // counts — which is how a real limiter behaves, and the reason a loop
    // that keeps hammering after a 429 does not recover on its own.
    const inWindow = provider.atMs.filter((at) => nowMs - at < 1_000).length
    provider.atMs.push(nowMs)

    if (provider.rejects.has(to)) {
      return {
        ok: false,
        status: 422,
        headers: { get: () => null },
        text: async () => '{"name":"validation_error"}',
        json: async () => ({}),
      }
    }
    const overCount =
      provider.acceptAtMost !== null &&
      provider.accepted.length >= provider.acceptAtMost
    if (overCount || inWindow >= provider.limitPerSecond) {
      provider.refused.push(to)
      return {
        ok: false,
        status: 429,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'retry-after' ? '1' : null,
        },
        text: async () => '{"name":"rate_limit_exceeded"}',
        json: async () => ({}),
      }
    }
    provider.accepted.push(to)
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '',
      json: async () => ({ id: `email_${provider.accepted.length}` }),
    }
  }) as unknown as typeof fetch
}

function mockFirestore(): any {
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get: async () => ({
      id: path.split('/').pop(),
      exists: mockState.store[path] !== undefined,
      data: () => mockState.store[path],
      get: (field: string) => mockState.store[path]?.[field],
      ref: docRef(path),
    }),
    set: async (value: any, options?: { merge?: boolean }) => {
      mockState.store[path] = options?.merge
        ? { ...(mockState.store[path] ?? {}), ...value }
        : { ...value }
    },
    update: async (value: any) => {
      mockState.store[path] = { ...(mockState.store[path] ?? {}), ...value }
    },
    delete: async () => {
      delete mockState.store[path]
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get parent() {
      const collectionPath = path.split('/').slice(0, -1).join('/')
      return {
        id: collectionPath.split('/').pop(),
        path: collectionPath,
        get parent() {
          const parentDoc = collectionPath.split('/').slice(0, -1).join('/')
          return parentDoc ? docRef(parentDoc) : null
        },
      }
    },
  })
  const collectionRef = (path: string, after?: string): any => {
    const ref: any = {
      doc: (id: string) => docRef(`${path}/${id}`),
      where: () => ref,
      orderBy: () => ref,
      startAfter: (cursor: any) =>
        collectionRef(path, cursor?.id ?? String(cursor)),
      limit: (max?: number) => ({
        ...ref,
        get: async () => {
          const docs = (await ref.get()).docs
          return { docs: max === undefined ? docs : docs.slice(0, max) }
        },
      }),
      get: async () => ({
        docs: Object.keys(mockState.store)
          .filter(
            (key) =>
              key.startsWith(`${path}/`) &&
              !key.slice(path.length + 1).includes('/'),
          )
          .sort()
          .filter((key) => !after || key.slice(path.length + 1) > after)
          .map((key) => ({
            id: key.split('/').pop(),
            exists: true,
            data: () => mockState.store[key],
            get: (field: string) => mockState.store[key]?.[field],
            ref: docRef(key),
          })),
      }),
    }
    return ref
  }
  return {
    collection: (name: string) => collectionRef(name),
    collectionGroup: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
    }),
    runTransaction: async (body: any) =>
      body({
        get: async (ref: any) => ref.get(),
        update: async (ref: any, value: any) => ref.update(value),
        set: async (ref: any, value: any, options?: any) =>
          ref.set(value, options),
      }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  UNSUBSCRIBE_SUPPRESSION_REASON: 'unsubscribe',
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
  recordMarketingSends: async (_hostId: string, emails: readonly string[]) =>
    emails.length,
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore() }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
      },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails,
  filterSendableForHost: async (_hostId: string, emails: string[]) => emails,
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
  /*
   * A VERIFIED DOMAIN OF THE SITE'S OWN, and it has to be one.
   *
   * The real `sendEmail` refuses marketing mail on the pooled platform
   * address — a campaign's complaint rate would be charged against every
   * other site's password resets. Suites that stub the sender never meet that
   * rule; this one does, and a fixture on the shared identity would refuse
   * all twelve messages before a single request reached the fake provider.
   */
  resolveHostSendingIdentity: async () =>
    jest.requireActual('@aglyn/shared-util-email').resolveSendingIdentity({
      selection: {
        status: 'verified',
        domain: 'mail.acme.test',
        localPart: 'hello',
      },
      audience: 'tenant',
      purpose: 'marketing',
      platformFrom: 'noreply@aglyn.com',
    }),
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
  meterHostEmail: async () => undefined,
  orgCampaignEmailSendsForMonth: async () => 0,
  reserveCampaignEmailSends: async ({ orgId, month, count, limit }: any) => ({
    ok: true,
    reservation: { orgId, month, reserved: count },
    used: 0,
    limit,
  }),
  reconcileCampaignSendReservation: async () => undefined,
  /*
   * The hourly governor is wide open here on purpose. It is the control this
   * file is NOT testing, and a ceiling that bound would defer the batch for
   * its own reasons — leaving the pace and the 429 unexercised behind a green
   * run.
   */
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
    retryAtMs: Date.now() + 3_600_000,
    degraded: false,
  }),
  readEmailSendRateWindow: async () => ({
    windowStartMs: 0,
    resetMs: Date.now() + 3_600_000,
    used: 0,
  }),
}))

import {
  EMAIL_BATCH_REQUESTS_PER_SECOND,
  EMAIL_PROVIDER_REQUESTS_PER_SECOND,
} from '@aglyn/shared-util-email'
import { performCampaignSend } from './campaign-send'

const HOST = 'host-1'

/** How many addresses a case mails. Two more than one second of headroom. */
const AUDIENCE = EMAIL_PROVIDER_REQUESTS_PER_SECOND + 2

/** The most requests any one-second window of a run contained. */
function busiestSecond(atMs: readonly number[]): number {
  return atMs.reduce(
    (busiest, start) =>
      Math.max(
        busiest,
        atMs.filter((at) => at >= start && at - start < 1_000).length,
      ),
    0,
  )
}

function seedHost(count: number) {
  mockState.store[`hosts/${HOST}`] = { subdomain: 'acme', orgId: 'org-1' }
  for (let index = 0; index < count; index += 1) {
    // Padded so document-name order is numeric order, which is what makes
    // "the first three" an answerable claim below.
    const id = `lead-${String(index).padStart(3, '0')}`
    mockState.store[`hosts/${HOST}/leads/${id}`] = {
      email: `${id}@example.com`,
      visibleTo: [HOST],
      marketingConsentByHost: {
        [HOST]: {
          marketingConsent: true,
          marketingConsentAtMs: Date.UTC(2026, 7, 1),
        },
      },
    }
  }
}

const send = () =>
  performCampaignSend({
    hostId: HOST,
    subject: 'Spring sale',
    body: 'plain text',
    audience: 'leads',
    senderUid: 'uid-1',
  })

/** The `sent` a campaign report will divide every rate by. */
function recordedSent(campaignId: string): number {
  return Number(
    mockState.store[`hosts/${HOST}/campaigns/${campaignId}`]?.stats?.sent,
  )
}

const originalFetch = global.fetch
const originalEnv = { ...process.env }

/*
 * Deliberately spending real time is the point of this file, and it runs
 * beside forty other suites on however many cores the machine has. The
 * default five seconds is a budget for a test that waits for nothing.
 */
jest.setTimeout(30_000)

beforeEach(() => {
  mockState.store = {}
  provider.limitPerSecond = EMAIL_PROVIDER_REQUESTS_PER_SECOND
  provider.acceptAtMost = null
  provider.accepted = []
  provider.refused = []
  provider.rejects = new Set()
  provider.atMs = []
  process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret'
  process.env.RESEND_API_KEY = 're_test_key_not_real'
  process.env.USAGE_EMAIL_FROM = 'Aglyn <noreply@aglyn.com>'
  // The shipped pace, explicitly. Sibling suites set this to `0` because they
  // stub the sender; an inherited `0` here would leave the whole file green
  // having paced nothing.
  delete process.env.EMAIL_PROVIDER_REQUESTS_PER_SECOND
  global.fetch = fakeResend()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('the fake provider', () => {
  it('refuses anything that is not Resend', async () => {
    // A control that cannot fail proves nothing about the sends it guards.
    await expect(
      (global.fetch as any)('https://smtp.example.com/send', { body: '{}' }),
    ).rejects.toThrow('Blocked outbound request')
  })

  const call = () =>
    (global.fetch as any)('https://api.resend.com/emails', {
      body: JSON.stringify({ to: 'x@example.com' }),
    })

  it('answers 429 once its per-second limit is passed', async () => {
    provider.limitPerSecond = 1
    expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(429)
  })

  it('answers 429 past a fixed count, whatever the clock did', async () => {
    provider.acceptAtMost = 2
    expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(429)
  })
})

describe('a batch against the provider request rate', () => {
  /**
   * THE PACING CASE, and the control for it in one.
   *
   * The provider accepts exactly one second's worth of requests. An unpaced
   * loop puts all twelve on the wire in under a millisecond, the last two are
   * refused, and the merchant is told about ten. Remove the pacer from
   * `campaign-send.ts` and this is the case that goes red.
   */
  it('delivers a whole batch without ever passing the documented rate', async () => {
    seedHost(AUDIENCE)

    const result = await send()

    expect(provider.refused).toEqual([])
    expect(provider.accepted).toHaveLength(AUDIENCE)
    expect(result.sent).toBe(provider.accepted.length)
    expect(recordedSent(result.campaignId)).toBe(provider.accepted.length)
    expect(result).not.toHaveProperty('deferred')
  })

  it('puts no more into any one second than a batch may take', async () => {
    seedHost(AUDIENCE)
    await send()

    // The rate rather than the gap between two neighbours, because the rate
    // is what the provider counts — and a slow machine cannot make this pass
    // for the wrong reason, since spreading requests further apart is the
    // behavior under test.
    expect(provider.atMs).toHaveLength(AUDIENCE)
    expect(busiestSecond(provider.atMs)).toBeLessThanOrEqual(
      EMAIL_BATCH_REQUESTS_PER_SECOND,
    )
  })
})

describe('a 429 the pace cannot avoid', () => {
  /**
   * A provider stricter than the published rate — a sender whose limit was
   * lowered, or another process on the same team's key spending the second.
   * The pace cannot prevent this one, so what matters is what the batch does
   * with it.
   */
  beforeEach(() => {
    provider.acceptAtMost = 3
  })

  it('counts only what the provider took', async () => {
    seedHost(AUDIENCE)

    const result = await send()

    expect(provider.accepted).toHaveLength(3)
    // THE ASSERTION. A refused recipient counted here is invisible to every
    // rate on the report, because `sent` is the numerator's own source.
    expect(result.sent).toBe(provider.accepted.length)
    expect(recordedSent(result.campaignId)).toBe(provider.accepted.length)
  })

  it('reports the refused recipients as a remainder, not as delivered', async () => {
    seedHost(AUDIENCE)

    const result = await send()

    // Everyone the provider did not take is left for the next batch —
    // including the one it refused, who was never looked at.
    expect((result as any).deferred).toBe(AUDIENCE - provider.accepted.length)
    expect(provider.accepted).not.toContain(provider.refused[0])
  })

  it('stops on the first refusal instead of grinding through the rest', async () => {
    seedHost(AUDIENCE)

    await send()

    // A limiter counts refused requests too, so a loop that kept going would
    // spend nine more of them to be told the same thing nine more times —
    // and would settle nine recipients it never delivered to.
    expect(provider.refused).toHaveLength(1)
    expect(provider.atMs).toHaveLength(provider.accepted.length + 1)
  })
})

describe('a refusal that IS about the recipient', () => {
  it('settles that address and keeps going', async () => {
    // The control on the deferral branch: widening it to every failure would
    // stop a whole batch on one malformed address, and this case would fail
    // with `sent: 0`.
    seedHost(3)
    provider.rejects = new Set(['lead-000@example.com'])

    const result = await send()

    expect(provider.accepted).toEqual([
      'lead-001@example.com',
      'lead-002@example.com',
    ])
    expect(result.sent).toBe(provider.accepted.length)
    expect(result).not.toHaveProperty('deferred')
  })
})

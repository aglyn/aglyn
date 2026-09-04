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
 * WHICH REFUSALS REACH THE CAMPAIGN PATH.
 *
 * `sendEmail`'s marketing gate is guarded by `if (options.marketing)`, and a
 * campaign passes no `marketing` context — it mints its own RFC 8058 links
 * upstream, because the same URL has to reach the template as a merge value
 * long before the message exists. So every control a campaign is subject to
 * has to be reached on THIS path, and this file is about which ones are.
 *
 * Four filters run before the send loop, and they are not interchangeable:
 *
 *  - BOTH suppression lists, the platform's and the site's, which is a
 *    compliance floor and is asserted here rather than assumed from a
 *    docblock;
 *  - the topic opt-outs (`campaign-send-topic.spec.ts` owns those);
 *  - the recipient's own CADENCE, which is the one pace control a campaign is
 *    bound by, because it is a request a person made rather than a conclusion
 *    the platform drew;
 *  - and nothing else. The frequency ceiling and the engagement sunset are
 *    exempt by design, and the last test here is the CONTROL on that: a fix
 *    that pointed every pace control at campaigns would empty a send whose
 *    audience simply has not engaged, which is exactly the win-back campaign.
 *
 * The dry run is asserted alongside every refusal, because a filter that
 * removes people from a send and not from the number on screen has replaced
 * one defect with a quieter one.
 *
 * THE DOUBLE MODELS `.doc()`'s PATH ARITHMETIC (inherited from
 * `campaign-send-ids.spec.ts`): the argument is APPENDED as a slash-separated
 * path, refused only when the resulting component count comes out odd.
 */

const store = new Map<string, Record<string, any>>()
const sent: Array<Record<string, any>> = []

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
      store.set(path, { ...(store.get(path) ?? {}), ...value })
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return {
    doc: (id: string) => {
      if (id === '') {
        throw new Error(
          `Value for argument "documentPath" is not a valid resource path. ` +
            `Path must be a non-empty string.`,
        )
      }
      const full = `${path}/${id}`
      if (full.split('/').length % 2 !== 0) {
        throw new Error(
          `Value for argument "documentPath" must point to a document, ` +
            `but was "${id}".`,
        )
      }
      return docRef(full)
    },
    ...queryRef(path),
    get parent() {
      return docRef(path.split('/').slice(0, -1).join('/'))
    },
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

const mockFirestore = () => ({
  collection: (name: string) => collectionRef(name),
  /*
   * The batched read `filterCadenceSendable` takes. Present here because the
   * REAL filter runs against this double — see the leaf-module note below —
   * and a missing `getAll` would make it throw, fail open, and pass every
   * assertion in this file for the wrong reason.
   */
  getAll: async (...refs: any[]) =>
    refs.map((ref) => snapshotOf(String(ref.path))),
})

let mockUid = 'uid-1'

jest.mock('@aglyn/tenant-data-admin', () => ({
  UNSUBSCRIBE_SUPPRESSION_REASON: 'unsubscribe',
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockFirestore(),
      auth: () => ({
        // Verified, because a host member is one: nothing enters a
        // `memberRoles` map unverified, and the send gate reads this
        // claim directly since AGL-2589.
        verifyIdToken: async () => ({ uid: mockUid, email_verified: true }),
      }),
    }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
      },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  /*
   * BOTH suppression lists, driven from a module-scope set. The real helper
   * consults the platform list and the site's own and fails CLOSED on either;
   * what this double stands in for is the ANSWER, so the assertion below is
   * about whether the campaign path asks the question at all.
   */
  filterSendableForHost: async (_hostId: string, emails: string[]) =>
    emails.filter(
      (email) => !(globalThis as any).__suppressed?.includes(email),
    ),
  // Nobody in these fixtures has left a stream; the cadence is under test.
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails,
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
  resolveHostSendingIdentity: async () =>
    jest.requireActual('@aglyn/shared-util-email').resolveSendingIdentity({
      selection: null,
      platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
    }),
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
  meterHostEmail: async () => undefined,
  orgCampaignEmailSendsForMonth: async () => 0,
  reserveCampaignEmailSends: async ({ count }: any) => ({
    ok: true,
    reservation: { orgId: 'org-1', month: '2026-08', reserved: count },
    used: 0,
    limit: 500,
  }),
  reconcileCampaignSendReservation: async () => undefined,
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

/*
 * The LEAF gate module is deliberately NOT mocked. The sender imports
 * `filterCadenceSendable` from it, the barrel mock above does not intercept
 * it, and so the REAL filter runs — against the `getAll` on the double, over
 * the counter documents these tests seed. A stub would only prove the sender
 * called something, and the thing under test is the rule.
 */

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    sent.push(message)
    return { sent: true }
  },
}))

import { createHash } from 'crypto'
import { performCampaignSend } from './campaign-send'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOST = 'host-1'
const QUIET = 'dana@example.com'
const EAGER = 'sam@example.com'
const SECRET = 'unsubscribe-secret'
const NOW = Date.UTC(2026, 7, 20)
const DAY = 86_400_000

/** Per-test suppression, read by the `filterSendableForHost` double above. */
const suppressed: string[] = []
;(globalThis as any).__suppressed = suppressed

/** The same key the frequency counter is filed under. */
const keyFor = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

/** Somebody who asked this site for mail at a pace, and when it last came. */
function seedCadence(
  email: string,
  cadence: string,
  lastSentAtMs: number,
): void {
  store.set(`hosts/${HOST}/emailFrequency/${keyFor(email)}`, {
    email,
    cadence,
    lastSentAtMs,
    sentAtMs: [lastSentAtMs],
    firstSentAtMs: NOW - 400 * DAY,
  })
}

function seed() {
  store.clear()
  sent.length = 0
  suppressed.length = 0
  mockUid = 'uid-1'
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
  })
  for (const [id, email] of [
    ['lead-1', QUIET],
    ['lead-2', EAGER],
  ]) {
    store.set(`hosts/${HOST}/leads/${id}`, {
      email,
      name: 'Reader',
      marketingConsentByHost: {
        'host-1': {
          marketingConsent: true,
          marketingConsentAtMs: Date.UTC(2026, 7, 1),
        },
      },
    })
  }
}

const send = (extra: Record<string, unknown> = {}) =>
  performCampaignSend({
    hostId: HOST,
    subject: 'Hello',
    body: 'Hi',
    audience: 'leads',
    senderUid: 'uid-1',
    ...extra,
  })

const addressed = () => sent.map((message) => String(message['to'])).sort()

beforeEach(() => {
  seed()
  process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET
  process.env.USAGE_EMAIL_FROM = 'noreply@aglyn.com'
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the suppression lists, on the campaign path', () => {
  it('does not mail an address on a suppression list', async () => {
    suppressed.push(QUIET)

    const result = await send()

    // The gate that would otherwise ask this question is not on this path, so
    // this asserts the campaign sender asks it itself.
    expect(addressed()).toEqual([EAGER])
    expect(result.sendable).toBeUndefined()
    expect(sent).toHaveLength(1)
  })

  it('counts a suppressed address as suppressed, not as held for pace', async () => {
    suppressed.push(QUIET)

    const preview = await send({ dryRun: true })

    expect(preview.sendable).toBe(1)
    expect(preview.suppressed).toBe(1)
    expect(preview.cadenceHeld).toBe(0)
  })
})

describe('the cadence a recipient asked for', () => {
  it('does not mail somebody inside the interval they chose', async () => {
    // Asked for one a month, mailed three days ago.
    seedCadence(QUIET, 'monthly', NOW - 3 * DAY)

    await send()

    expect(addressed()).toEqual([EAGER])
  })

  it('mails them once the interval has passed', async () => {
    seedCadence(QUIET, 'monthly', NOW - 40 * DAY)

    await send()

    expect(addressed()).toEqual([EAGER, QUIET].sort())
  })

  it('subtracts them from the count BEFORE the merchant presses Send', async () => {
    seedCadence(QUIET, 'weekly', NOW - 1 * DAY)

    const preview = await send({ dryRun: true })

    // The number on screen is the promise. A refusal the merchant learns
    // about afterwards is the defect this placement exists to avoid.
    expect(preview.sendable).toBe(1)
    expect(preview.cadenceHeld).toBe(1)
    // And NOT folded into a heading that says they unsubscribed.
    expect(preview.suppressed).toBe(0)
  })

  it('records the held recipient nowhere — it refuses a SEND, not a person', async () => {
    seedCadence(QUIET, 'monthly', NOW - 3 * DAY)
    const before = store.get(`hosts/${HOST}/leads/lead-1`)

    await send()

    // No suppression written, no membership touched, the lead unchanged.
    expect(store.get(`hosts/${HOST}/leads/lead-1`)).toEqual(before)
    expect(
      [...store.keys()].some((key) => key.includes('emailSuppressions')),
    ).toBe(false)
  })

  it('refuses the batch in the recipients’ own words when everybody is holding', async () => {
    seedCadence(QUIET, 'monthly', NOW - 3 * DAY)
    seedCadence(EAGER, 'monthly', NOW - 3 * DAY)

    await expect(send()).rejects.toThrow(/less often/)
    // Not "unsubscribed or suppressed" — that would send a merchant looking
    // for a broken audience that is not broken.
    await expect(send()).rejects.not.toThrow(/unsubscribed/)
  })
})

describe('the controls a campaign is NOT bound by', () => {
  it('mails somebody who has never engaged, however long they have been quiet', async () => {
    /*
     * THE CONTROL on the sunset exemption, and on any future change that
     * points every pace control at campaigns.
     *
     * This recipient has been mailed for over a year and has engaged with
     * nothing — the state `marketingSunsetVerdict` refuses. A campaign is
     * exempt, and it has to be: an audience of people who stopped engaging
     * is precisely the audience of a win-back campaign, so a sunset applied
     * here would make the one message written for these people the one
     * message that cannot reach them.
     */
    process.env.AGLYN_EMAIL_SUNSET_AFTER_DAYS = '90'
    store.set(`hosts/${HOST}/emailFrequency/${keyFor(QUIET)}`, {
      email: QUIET,
      firstSentAtMs: NOW - 400 * DAY,
      lastSentAtMs: NOW - 200 * DAY,
      sentAtMs: [],
    })

    try {
      await send()
    } finally {
      delete process.env.AGLYN_EMAIL_SUNSET_AFTER_DAYS
    }

    expect(addressed()).toEqual([EAGER, QUIET].sort())
  })

  it('mails somebody already at the daily ceiling', async () => {
    // Five sends today is the default cap. A campaign counts toward it and is
    // not refused by it — a reviewed one-shot act keeps the number it showed.
    store.set(`hosts/${HOST}/emailFrequency/${keyFor(QUIET)}`, {
      email: QUIET,
      sentAtMs: [NOW - 1, NOW - 2, NOW - 3, NOW - 4, NOW - 5],
      lastSentAtMs: NOW - 1,
      firstSentAtMs: NOW - 400 * DAY,
    })

    await send()

    expect(addressed()).toContain(QUIET)
  })

  it('mails an audience that expressed no preference at all', async () => {
    // The other half of the control: a filter applied indiscriminately would
    // empty this send, and every campaign in the product.
    const preview = await send({ dryRun: true })

    expect(preview.sendable).toBe(2)
    expect(preview.cadenceHeld).toBe(0)
  })
})

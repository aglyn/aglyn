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
 * THE FIFTH FILTER: WHO A CAMPAIGN WOULD BOUNCE OFF (AGL-3328).
 *
 * An address whose domain has no mail server, and one behind a mail
 * gateway that refused this sending domain twice this month, are taken out
 * of a campaign before the send loop — and before the number on screen, so
 * the review says "N recipients excluded: no mail server · M behind a
 * gateway that refused this sender" rather than the merchant learning it
 * from the bounce report. Counted apart from the suppressed and the paced,
 * because nobody unsubscribed and the fix is the list, not the send.
 *
 * The harness is `campaign-send-cadence.spec.ts`'s.
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
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails,
  /*
   * The deliverability check (AGL-3328), driven from module scope. What
   * this double stands in for is the ANSWER — the store and the DNS behind
   * it have their own spec — so the assertions below are about what the
   * campaign path does with it: subtract, count, say why.
   */
  filterDeliverableRecipients: async (input: { emails: string[]; sendingDomain: string | null }) => {
    const state = (globalThis as any).__deliverability
    state.asked.push(input)
    if (state.throws) throw new Error('store unreachable')
    return {
      deliverable: input.emails.filter((email) => !state.noMailServer.includes(email) && !state.held.includes(email)),
      noMailServer: input.emails.filter((email) => state.noMailServer.includes(email)),
      gatewayHeld: input.emails.filter((email) => state.held.includes(email)),
    }
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
  resolveHostSendingIdentity: async () =>
    jest.requireActual('@aglyn/shared-util-email').resolveSendingIdentity({
      selection: null,
      platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
    }),
  orgDataCollectionForHost: jest.fn(),
  // The scoped org query (AGL-3275): the leads audience reads through it now,
  // as the contacts audience already did.
  orgDataQueryForHost: async (_hostId: string, name: string) => ({
    ref: mockFirestore().collection(`orgs/org-1/${name}`),
    query: mockFirestore().collection(`orgs/org-1/${name}`),
  }),
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

import { performCampaignSend } from './campaign-send'

const deliverability = {
  asked: [] as Array<{ emails: string[]; sendingDomain: string | null }>,
  noMailServer: [] as string[],
  held: [] as string[],
  throws: false,
}
;(globalThis as any).__deliverability = deliverability

const HOST = 'host-1'
const GONE = 'nobody@parked.example'
const HELD = 'kristan@lifespire.example'
const FINE = 'casey@workspace.example'
const SECRET = 'unsubscribe-secret'
const NOW = Date.UTC(2026, 7, 20)

function seed() {
  store.clear()
  sent.length = 0
  deliverability.asked.length = 0
  deliverability.noMailServer.length = 0
  deliverability.held.length = 0
  deliverability.throws = false
  mockUid = 'uid-1'
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
  })
  for (const [id, email] of [
    ['lead-1', GONE],
    ['lead-2', HELD],
    ['lead-3', FINE],
  ]) {
    store.set(`orgs/org-1/leads/${id}`, {
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

describe('the deliverability check, on the campaign path', () => {
  it('subtracts who would bounce and who is held from the count BEFORE Send, and names them apart', async () => {
    deliverability.noMailServer.push(GONE)
    deliverability.held.push(HELD)

    const preview = await send({ dryRun: true })

    expect(preview.sendable).toBe(1)
    expect(preview.noMailServer).toBe(1)
    expect(preview.gatewayHeld).toBe(1)
    // Nobody unsubscribed and nobody asked for less mail.
    expect(preview.suppressed).toBe(0)
    expect(preview.cadenceHeld).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it('asks about the campaign’s own sending domain', async () => {
    await send({ dryRun: true })

    expect(deliverability.asked).toHaveLength(1)
    expect(deliverability.asked[0].sendingDomain).toBe('aglyn.com')
    expect([...deliverability.asked[0].emails].sort()).toEqual([FINE, GONE, HELD].sort())
  })

  it('does not mail them, and records why on the send', async () => {
    deliverability.noMailServer.push(GONE)
    deliverability.held.push(HELD)

    await send()

    expect(addressed()).toEqual([FINE])
    const recorded = [...store.values()].find((doc) => doc?.['stats']?.['noMailServer'] !== undefined)
    expect(recorded?.['stats']).toMatchObject({
      noMailServer: 1,
      gatewayHeld: 1,
    })
  })

  it('says the audience would bounce when the check empties it', async () => {
    deliverability.noMailServer.push(GONE, HELD, FINE)

    await expect(send()).rejects.toThrow(
      'Every recipient would bounce: their domains have no mail server, or their mail gateway refused this sender twice this month',
    )
    expect(sent).toHaveLength(0)
  })

  it('sends to everyone when the check cannot be made', async () => {
    deliverability.throws = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await send()

    expect(addressed()).toEqual([FINE, GONE, HELD].sort())
  })
})

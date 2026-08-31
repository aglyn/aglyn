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
 * A MERGE TAG READS A FIELD THAT EXISTS (AGL-2303).
 *
 * `performCampaignSend` collects recipient names per audience so
 * `{{contact.name}}` and `{{contact.firstName}}` can be substituted. For the
 * **members** audience it read `doc.get('name')` — and `siteMembers` has never
 * had a `name` field. Sign-up, the account page and the admin password route
 * all write `displayName`.
 *
 * So the map was empty for the whole audience, and `resolveMergeTags`
 * substituted an EMPTY STRING into subject lines and bodies that then went out
 * to real people. Nothing errored; substitution does not fail, it just fills
 * the hole with nothing. Same shape as AGL-2219 — a reader with no writer —
 * except the failure is visible to the customer's customers.
 *
 * `leads` had the mirror problem: `campaign-send` read `leads.name` and no
 * lead writer wrote one, with the person's name sitting on the very same
 * request. Fixed at the writers (`membership-register`, the bookings handler).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `campaign-send.spec.ts`: that suite's
 * fixture seeds a lead with `name: 'Dana Reed'` — a field production never
 * wrote. A double richer than reality manufactures a green for a path that
 * could not work, which is precisely how this survived. Every fixture below
 * uses only fields a real writer actually stores.
 */

const mockState: {
  store: Record<string, Record<string, unknown>>
  sent: Array<Record<string, any>>
} = { store: {}, sent: [] }

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
  /*
   * The unsubscribe-link signer and URL builder are the REAL ones. They need
   * nothing but `crypto`, and a double would let a spec assert on a URL shape
   * the product does not actually mint — which is the whole failure mode of a
   * stubbed policy module.
   */
  ...jest.requireActual(
    '@aglyn/tenant-data-admin/server/email-unsubscribe-link',
  ),
  /*
   * The marketing frequency window is a no-op here, and deliberately so: it
   * is a durable counter whose behavior is proven against a Firestore double
   * in `tenant-data-admin`, and the campaign sender's only contract with it
   * is that it is called with the addresses that were reached and that it
   * cannot fail a send.
   */
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
  // Nobody in this file is suppressed; the audience is what is under test.
  // Nobody in these fixtures has left a topic, so the send's third filter is
  // a pass-through. Modeled rather than omitted: an absent export reads as
  // `undefined` and fails the send with a TypeError, which is a red that says
  // nothing about the behavior under test.
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails,
  filterSendableForHost: async (_hostId: string, emails: string[]) => emails,
  // Free's `emailSendsPerMonth` is 0 by design and would refuse the send
  // before any of this is reached.
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'starter' } }),
  // No site here selects a custom sending domain, so every send resolves to
  // the platform identity — the behavior these suites were written against.
  resolveHostSendingIdentity: async () =>
    jest
      .requireActual('@aglyn/shared-util-email')
      .resolveSendingIdentity({
        selection: null,
        platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
      }),
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
  meterHostEmail: async () => undefined,
  /*
   * AGL-2267/AGL-2409. The barrel factory is a CLOSED WORLD — anything the
   * sender imports and this object omits arrives as `undefined` and throws at
   * the call — so the org-scoped cap and the platform send-rate governor have
   * to be listed here even where neither is what the file is testing.
   *
   * Permissive on purpose: this file is about something else, and a cap or a
   * ceiling that refused here would make every assertion below a test of the
   * cap. `campaign-send.spec.ts` owns the enforcement.
   */
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
    const ceiling = Math.max(1, Math.floor((options.platformPerHour ?? 100_000) * 0.25))
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
  sendEmail: async (message: Record<string, unknown>) => {
    mockState.sent.push(message)
    return { sent: true }
  },
}))

import { performCampaignSend } from './campaign-send'

/** Only the shapes this send makes: doc gets, capped collection reads, sets. */
function mockFirestore(): any {
  const store = mockState.store
  const snapshot = (path: string) => {
    const data = store[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      data: () => data,
      // `undefined` for an absent field, exactly as the real SDK answers. A
      // double that threw would have surfaced this defect years ago and is
      // therefore the wrong double — the product's failure was silent.
      get: (field: string) => data?.[field],
    }
  }
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get: async () => snapshot(path),
    set: async (value: Record<string, unknown>) => {
      store[path] = { ...(store[path] ?? {}), ...value }
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  /** The ids directly under `path`, in the `__name__` order the sweep asks for. */
  const childIds = (path: string) =>
    Object.keys(store)
      .filter(
        (key) =>
          key.startsWith(`${path}/`) &&
          !key.slice(path.length + 1).includes('/'),
      )
      .map((key) => key.slice(path.length + 1))
      .sort()
  /** `orderBy` / `startAfter` / `limit`, and `limit` honors its argument. */
  const queryRef = (path: string, after?: string): any => ({
    orderBy: () => queryRef(path, after),
    startAfter: (cursor: any) => queryRef(path, cursor?.id ?? String(cursor)),
    limit: (max: number) => ({
      get: async () => {
        const ids = childIds(path).filter((id) => !after || id > after)
        return { docs: ids.slice(0, max).map((id) => snapshot(`${path}/${id}`)) }
      },
    }),
  })
  const collectionRef = (path: string): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
    ...queryRef(path),
    get parent() {
      return docRef(path.split('/').slice(0, -1).join('/'))
    },
  })
  return { collection: (name: string) => collectionRef(name) }
}

/**
 * The plain-campaign tag vocabulary is `{{name}}` / `{{firstName}}` /
 * `{{email}}` (`resolveMergeTags`), not the dotted `contact.*` map a DESIGNED
 * email's renderer takes. Written out here because using the wrong one is a
 * template that renders its own braces — visibly wrong, unlike the empty
 * string this file is actually about.
 */
const SUBJECT = 'Hello {{firstName}}, a note for {{name}}'

function send(audience: 'members' | 'leads') {
  return performCampaignSend({
    hostId: 'host-1',
    subject: SUBJECT,
    body: 'Dear {{name}} — plain text.',
    audience,
    recordCampaign: false,
    senderUid: 'uid-1',
  })
}

let previousSecret: string | undefined
beforeAll(() => {
  previousSecret = process.env['EMAIL_UNSUBSCRIBE_SECRET']
  process.env['EMAIL_UNSUBSCRIBE_SECRET'] = 'test-secret'
})
afterAll(() => {
  if (previousSecret === undefined) delete process.env['EMAIL_UNSUBSCRIBE_SECRET']
  else process.env['EMAIL_UNSUBSCRIBE_SECRET'] = previousSecret
})

/**
 * A recorded opt-in, in the shape every capture path writes it.
 *
 * This suite is about which FIELD a merge tag reads a person's name from, and
 * it can only assert that against a message that was actually sent. The
 * consent join withholds a recipient with no recorded basis and refuses an
 * audience where nobody has one, so each fixture below carries a basis in
 * addition to whatever name field the case is really about.
 */
const CONSENT_GRANTED = {
  // The basis belongs to the site sending, not to the org.
  marketingConsentByHost: {
    'host-1': { marketingConsent: true, marketingConsentAtMs: Date.UTC(2026, 7, 1) },
  },
}

beforeEach(() => {
  mockState.store = { 'hosts/host-1': { subdomain: 'acme', memberRoles: {} } }
  mockState.sent = []
})

describe('the members audience personalizes off the field members actually have', () => {
  it('resolves {{name}} from `displayName`', async () => {
    // EXACTLY what `membership-register` writes for a member who ticked the
    // opt-in box: `email`, `displayName`, `passwordScrypt`, `createdAt` and
    // the consent pair. No `name` — because production has none.
    mockState.store['hosts/host-1/siteMembers/m-1'] = {
      email: 'dana@example.com',
      displayName: 'Dana Reed',
      passwordScrypt: 'scrypt$x',
      ...CONSENT_GRANTED,
    }

    await send('members')
    expect(mockState.sent).toHaveLength(1)
    // The VALUE, from that member's own document. The old read produced
    // `Hello , a note for ` — a sentence that went out to a real inbox.
    expect(mockState.sent[0].subject).toBe('Hello Dana, a note for Dana Reed')
    expect(String(mockState.sent[0].text ?? '')).toContain('Dear Dana Reed')
  })

  it('carries EACH member’s own name, not the first one', async () => {
    mockState.store['hosts/host-1/siteMembers/m-1'] = {
      email: 'dana@example.com',
      displayName: 'Dana Reed',
      ...CONSENT_GRANTED,
    }
    mockState.store['hosts/host-1/siteMembers/m-2'] = {
      email: 'sam@example.com',
      displayName: 'Sam Okafor',
      ...CONSENT_GRANTED,
    }

    await send('members')
    const byRecipient = new Map(
      mockState.sent.map((message) => [
        String(message.to),
        String(message.subject),
      ]),
    )
    expect(byRecipient.get('dana@example.com')).toBe(
      'Hello Dana, a note for Dana Reed',
    )
    expect(byRecipient.get('sam@example.com')).toBe(
      'Hello Sam, a note for Sam Okafor',
    )
  })

  it('still resolves a member carrying `name` instead', async () => {
    // The fallback is kept deliberately: a future writer, or a lead promoted
    // to a member, may carry either field.
    mockState.store['hosts/host-1/siteMembers/m-1'] = {
      email: 'dana@example.com',
      name: 'Dana Reed',
      ...CONSENT_GRANTED,
    }
    await send('members')
    expect(mockState.sent[0].subject).toBe('Hello Dana, a note for Dana Reed')
  })

  it('NEGATIVE CONTROL: a member with no name at all still receives the mail', async () => {
    // Substitution must degrade, never refuse — an unnamed member is a
    // recipient, not an error.
    mockState.store['hosts/host-1/siteMembers/m-1'] = {
      email: 'dana@example.com',
      ...CONSENT_GRANTED,
    }
    await send('members')
    expect(mockState.sent).toHaveLength(1)
    expect(mockState.sent[0].subject).toBe('Hello , a note for ')
  })
})

describe('the leads audience personalizes off `name`', () => {
  it('resolves the name the lead writers now store', async () => {
    // The shape `membership-register` and the bookings handler write since
    // AGL-2303: `email`, `name`, `source`, `createdAt`.
    mockState.store['hosts/host-1/leads/l-1'] = {
      email: 'dana@example.com',
      name: 'Dana Reed',
      source: 'signup',
      ...CONSENT_GRANTED,
    }
    await send('leads')
    expect(mockState.sent[0].subject).toBe('Hello Dana, a note for Dana Reed')
  })

  it('NEGATIVE CONTROL: a lead recorded before AGL-2303 still receives it', async () => {
    mockState.store['hosts/host-1/leads/l-1'] = {
      email: 'dana@example.com',
      source: 'signup',
      ...CONSENT_GRANTED,
    }
    await send('leads')
    expect(mockState.sent).toHaveLength(1)
    expect(mockState.sent[0].subject).toBe('Hello , a note for ')
  })
})

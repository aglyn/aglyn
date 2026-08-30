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
 * A TEST SEND MAILS ONE PERSON, RECORDS NOTHING, AND CANNOT BE AIMED AT A
 * STRANGER.
 *
 * The feature is three choices — whose data fills the merge tags, which
 * address receives it, and which identity it leaves on — and only the middle
 * one puts a message in anybody's inbox. Every assertion below is made
 * against what `sendEmail` was actually called with, or against what was
 * written, rather than against a helper's return value: a rule that decides
 * correctly and does not reach the send is worth nothing, and the cost of
 * that failing is a message delivered to somebody who did not consent to it.
 *
 * The harness is `campaign-composer.spec.ts`'s, extended with the equality
 * queries the membership check and the persona lookup make.
 */

const store = new Map<string, Record<string, any>>()
const sent: Array<Record<string, any>> = []
const metered: Array<[string, number, string]> = []
const reachWrites: string[][] = []

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

/** The ids directly under `path`, in the `__name__` order a sweep asks for. */
function childIds(path: string): string[] {
  return [...store.keys()]
    .filter(
      (key) =>
        key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
    )
    .map((key) => key.slice(path.length + 1))
    .sort()
}

/**
 * `orderBy` / `startAfter` / `limit` / `where`, and every one of them HONORS
 * its argument.
 *
 * `where` matters most here. The membership gate is an equality query, and a
 * double that ignored the predicate would return the whole roster for any
 * address — so "a stranger is refused" would pass against a gate that admits
 * everybody, which is the one result this file exists to disprove.
 */
function queryRef(
  path: string,
  after?: string,
  filters: Array<[string, any]> = [],
): any {
  const run = async (max: number) => {
    const ids = childIds(path).filter((id) => !after || id > after)
    const docs = ids
      .map((id) => snapshotOf(`${path}/${id}`))
      .filter((doc) => filters.every(([field, value]) => doc.get(field) === value))
    return { docs: docs.slice(0, max), empty: docs.slice(0, max).length === 0 }
  }
  return {
    orderBy: () => queryRef(path, after, filters),
    startAfter: (cursor: any) =>
      queryRef(path, cursor?.id ?? String(cursor), filters),
    where: (field: string, _op: string, value: any) =>
      queryRef(path, after, [...filters, [field, value]]),
    limit: (max: number) => ({ get: async () => run(max) }),
    get: async () => run(Number.MAX_SAFE_INTEGER),
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

const mockFirestore = () => ({ collection: (name: string) => collectionRef(name) })

/** Addresses `filterSendableForHost` removes — the suppression list. */
let suppressed: string[] = []
/*
 * The site's standing selection lives on the host document, which is where
 * `performCampaignSend` reads it from. Written there rather than held in a
 * variable the resolver could consult, so the path under test is the real one.
 */
const selectSendingDomain = (domain: string, localPart: string) => {
  store.set(`hosts/${HOST}`, {
    ...(store.get(`hosts/${HOST}`) ?? {}),
    sendingDomain: domain,
    sendingLocalPart: localPart,
  })
}

jest.mock('@aglyn/tenant-data-admin/server/email-campaign-reach', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin/server/email-campaign-reach'),
  readCampaignReach: async () => new Set<string>(),
  readCampaignSettled: async () => ({
    reached: new Set<string>(),
    skipped: new Set<string>(),
  }),
  /*
   * Recorded rather than stubbed to a no-op: "a test send writes no reach
   * record" is an assertion about a CALL not happening, and a `jest.fn()` that
   * silently succeeds would let the opposite pass.
   */
  recordCampaignReach: async (
    _hostId: string,
    _campaignId: string,
    reached: string[],
  ) => {
    reachWrites.push(reached)
  },
  recordCampaignSkipped: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin/server/email-unsubscribe-link'),
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockFirestore(),
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'uid-1',
          email: 'owner@acme-agency.com',
          email_verified: true,
        }),
      }),
    }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
        delete: () => 'deleted',
      },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails,
  filterSendableForHost: async (_hostId: string, emails: string[]) =>
    emails.filter((email) => !suppressed.includes(email)),
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'starter' } }),
  /*
   * The REAL decision, over a fake record store — and it READS ITS ARGUMENT.
   *
   * `selectedDomain` is the whole point: it is what the send path computes
   * from the site's selection and the composer's choice, and the platform arm
   * is reached by that argument being empty. A double that ignored it and
   * answered from the module-level `selection` would make every identity
   * assertion below a test of the double: choosing the shared domain would
   * "pass" against a route that had honored nothing.
   */
  resolveHostSendingIdentity: async (options: any) => {
    const email = jest.requireActual('@aglyn/shared-util-email')
    const domain = String(options?.selectedDomain ?? '')
    const record = domain
      ? (store.get(`orgs/org-1/sendingDomains/${domain}`) as any)
      : null
    return email.resolveSendingIdentity({
      selection: domain
        ? {
            domain,
            status: record?.status ?? 'failed',
            localPart: String(options?.selectedLocalPart ?? 'hello'),
            missing: record?.lastMissing ?? [],
          }
        : null,
      platformFrom: 'noreply@aglyn.com',
    })
  },
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    mockFirestore().collection(`orgs/org-1/${name}`),
  orgDataQueryForHost: async (_hostId: string, name: string) => ({
    ref: mockFirestore().collection(`orgs/org-1/${name}`),
    query: mockFirestore().collection(`orgs/org-1/${name}`),
  }),
  meterHostEmail: async (hostId: string, count: number, sendClass: string) => {
    metered.push([hostId, count, sendClass])
  },
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
  claimOrgEmailSendBudget: async () => ({
    allowed: true,
    used: 0,
    ceiling: 25_000,
    remaining: 25_000,
    retryAtMs: 3_600_000,
    degraded: false,
  }),
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
    sent.push(message)
    return { sent: true }
  },
}))

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { campaignSendHandler, performCampaignSend } from './campaign-send'

const HOST = 'host-1'
const CALLER = 'owner@acme-agency.com'
const COLLEAGUE = 'jo@acme-agency.com'
const CONTACT = 'buyer@example.com'
const STRANGER = 'someone@nowhere.example'

function seed() {
  store.clear()
  sent.length = 0
  metered.length = 0
  reachWrites.length = 0
  suppressed = []

  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
  })
  // The org roster: the caller and one colleague. These two, and nobody else,
  // are what a test send may be delivered to.
  store.set('orgs/org-1/members/uid-1', {
    email: CALLER,
    displayName: 'Ada Owner',
    role: 'owner',
  })
  store.set('orgs/org-1/members/uid-2', {
    email: COLLEAGUE,
    displayName: 'Jo Editor',
    role: 'admin',
  })
  /*
   * A real contact with a real name and a recorded opt-in.
   *
   * The opt-in is what makes the eligibility assertion sharp: this person
   * COULD lawfully be mailed by a campaign, so a test send refusing them is
   * the membership rule working rather than the consent rule doing it for us.
   */
  store.set('orgs/org-1/contacts/c1', {
    email: CONTACT,
    name: 'Bo Buyer',
    visibleTo: ['org'],
    marketingConsent: true,
    marketingConsentAtMs: Date.UTC(2026, 7, 1),
  })
  store.set(`hosts/${HOST}/leads/lead-1`, {
    email: 'lead@example.com',
    name: 'Lee Lead',
    marketingConsent: true,
    marketingConsentAtMs: Date.UTC(2026, 7, 1),
  })
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

const test$ = (over: Record<string, unknown> = {}) =>
  post({
    hostId: HOST,
    action: 'test',
    subject: 'Spring sale',
    body: 'Hello {{firstName|there}}, the sale is on.',
    ...over,
  })

const delivered = () => sent.map((message) => String(message['to']))

let previousSecret: string | undefined
let previousFrom: string | undefined
beforeAll(() => {
  previousSecret = process.env['EMAIL_UNSUBSCRIBE_SECRET']
  previousFrom = process.env['USAGE_EMAIL_FROM']
  process.env['EMAIL_UNSUBSCRIBE_SECRET'] = 'test-secret'
  process.env['USAGE_EMAIL_FROM'] = 'noreply@aglyn.com'
})
afterAll(() => {
  if (previousSecret === undefined) delete process.env['EMAIL_UNSUBSCRIBE_SECRET']
  else process.env['EMAIL_UNSUBSCRIBE_SECRET'] = previousSecret
  if (previousFrom === undefined) delete process.env['USAGE_EMAIL_FROM']
  else process.env['USAGE_EMAIL_FROM'] = previousFrom
})
beforeEach(seed)

/*==========================================
  Who a test may reach
==========================================*/

describe('a test send reaches an account holder, and nobody else', () => {
  it('delivers to the caller when no address is chosen', async () => {
    const result = await test$()

    expect(result.status).toBe(200)
    expect(delivered()).toEqual([CALLER])
  })

  it('delivers to a colleague on the same workspace', async () => {
    const result = await test$({ to: COLLEAGUE })

    expect(result.status).toBe(200)
    expect(delivered()).toEqual([COLLEAGUE])
  })

  it('REFUSES an address that belongs to no account here', async () => {
    const result = await test$({ to: STRANGER })

    expect(result.status).toBe(403)
    expect(String(result.body?.error)).toContain(STRANGER)
    // The refusal is of the SEND, and it is total: not one message left.
    expect(sent).toHaveLength(0)
  })

  it('REFUSES a contact, even one with a recorded opt-in', async () => {
    /*
     * The sharpest case in this file. This contact consented to marketing, so
     * a campaign could lawfully mail them — and the test button still must
     * not, because the consent carve-out a test send runs under was never
     * theirs to spend. A merchant who wants to mail a contact sends a
     * campaign, which counts, is reported, and is subject to every rule.
     */
    const result = await test$({ to: CONTACT })

    expect(result.status).toBe(403)
    expect(sent).toHaveLength(0)
  })

  it('refuses a stranger even when they are also named as the persona', async () => {
    // Choosing somebody to RENDER as must not be a way to become somebody it
    // may be delivered to. Two fields, two questions, and only one of them
    // decides who gets mail.
    const result = await test$({ to: STRANGER, personaEmail: CONTACT })

    expect(result.status).toBe(403)
    expect(sent).toHaveLength(0)
  })
})

/*==========================================
  Suppression and consent are not relaxed
==========================================*/

describe('a test send honors the lists a campaign honors', () => {
  it('cannot reach a suppressed address, even a colleague’s', async () => {
    suppressed = [COLLEAGUE]

    const result = await test$({ to: COLLEAGUE })

    // A bounce or a spam complaint is a fact about the MAILBOX. Who is asking
    // for the send changes nothing about it, so the exemption a proof carries
    // does not reach this list.
    expect(result.status).toBe(400)
    expect(sent).toHaveLength(0)
  })

  it('cannot reach an address with a recorded marketing opt-out', async () => {
    /*
     * The colleague is on the roster AND has declined marketing on this site.
     * Eligibility says yes and the stored refusal says no, and the refusal
     * wins — a proof is not the first exception to "no policy may mail a
     * recorded no".
     */
    store.set(`hosts/${HOST}/siteMembers/m1`, {
      email: COLLEAGUE,
      displayName: 'Jo Editor',
      marketingConsent: false,
    })

    const result = await test$({ to: COLLEAGUE })

    expect(result.status).toBe(400)
    expect(String(result.body?.error)).toContain(COLLEAGUE)
    expect(sent).toHaveLength(0)
  })
})

/*==========================================
  It records nothing
==========================================*/

describe('a test send leaves no trace in the campaign bookkeeping', () => {
  it('writes no campaign document', async () => {
    await test$()

    const written = [...store.keys()].filter((path) =>
      path.includes('/campaigns/'),
    )
    expect(written).toEqual([])
  })

  it('writes no reach record', async () => {
    await test$()

    // Proofing an email six times must not make its report say seven, and the
    // reach record is what a follow-up subtracts against — a test counted
    // there would silently exclude the tester from the real send.
    expect(reachWrites).toEqual([])
  })

  it('IS metered, because a test send is a real email with a real cost', async () => {
    /*
     * The one counter a test send deliberately does move, asserted here so
     * that "records nothing" is not read as "is free".
     *
     * The cost meter sits ahead of the `recordCampaign` early return on
     * purpose: a proof leaves the building, the provider charges for it, and
     * an operator reconciling spend against sends would find a gap the size
     * of every test anybody ever ran. What it must not touch is the
     * CAMPAIGN's own bookkeeping, which the three assertions above cover.
     */
    await test$()

    expect(metered).toEqual([[HOST, 1, 'campaign']])
  })

  it('still delivers, so none of the above is achieved by sending nothing', async () => {
    // The assertions above are all about absence. Without this one they would
    // all pass against a route that refused every test send.
    await test$()

    expect(delivered()).toEqual([CALLER])
  })
})

/*==========================================
  The persona renders; it does not receive
==========================================*/

describe('the persona fills the merge tags and receives nothing', () => {
  it('renders the chosen contact’s name', async () => {
    await test$({ personaEmail: CONTACT })

    expect(sent).toHaveLength(1)
    expect(String(sent[0]['text'])).toContain('Bo')
  })

  it('shows the fallback when no persona is chosen', async () => {
    // The other half of the assertion above: without it, a renderer that
    // ignored the persona entirely would pass as long as the fallback
    // happened to contain the same letters.
    await test$()

    expect(String(sent[0]['text'])).toContain('there')
    expect(String(sent[0]['text'])).not.toContain('Bo')
  })

  it('delivers to the chosen recipient, never to the persona', async () => {
    await test$({ to: COLLEAGUE, personaEmail: CONTACT })

    expect(delivered()).toEqual([COLLEAGUE])
    expect(JSON.stringify(sent).includes(`"to":"${CONTACT}"`)).toBe(false)
  })

  it('signs the unsubscribe link for the RECIPIENT, not the persona', async () => {
    /*
     * The most expensive thing this feature could get wrong.
     *
     * The footer link and the `List-Unsubscribe` header are honored by
     * whoever clicks or POSTs them. If a proof carried the persona's link, a
     * merchant clicking "unsubscribe" in their own test inbox — or a mailbox
     * provider prefetching the header — would unsubscribe a real contact who
     * did nothing at all.
     */
    await test$({ to: COLLEAGUE, personaEmail: CONTACT })

    const message = sent[0]
    const header = String(message['headers']?.['List-Unsubscribe'] ?? '')
    const encodedRecipient = encodeURIComponent(COLLEAGUE)
    const encodedPersona = encodeURIComponent(CONTACT)
    expect(header).toContain(encodedRecipient)
    expect(header).not.toContain(encodedPersona)
    expect(String(message['text'])).not.toContain(encodedPersona)
  })
})

/*==========================================
  Which identity a proof leaves on
==========================================*/

describe('a test send leaves on the identity the composer chose', () => {
  const verifyDomain = () => {
    store.set('orgs/org-1/sendingDomains/acme.com', {
      domain: 'acme.com',
      status: 'verified',
      dkimSelector: 'aglyn-org1',
      dkimPublicKey: 'key',
    })
    selectSendingDomain('acme.com', 'news')
  }

  it('uses the site’s verified identity by default', async () => {
    verifyDomain()

    await test$()

    expect(sent[0]['sendingIdentity']).toMatchObject({
      from: 'news@acme.com',
      source: 'custom',
    })
  })

  it('honors an explicit choice of the shared Aglyn domain', async () => {
    verifyDomain()

    await test$({ sendingIdentity: 'platform' })

    expect(sent[0]['sendingIdentity']).toMatchObject({
      from: 'noreply@aglyn.com',
      source: 'platform',
    })
  })

  it('refuses when the site’s domain is not verified', async () => {
    store.set('orgs/org-1/sendingDomains/acme.com', {
      domain: 'acme.com',
      status: 'records-issued',
      lastMissing: ['TXT:send.acme.com'],
    })
    selectSendingDomain('acme.com', 'news')

    const result = await test$()

    // A proof is not a way around the identity boundary. It refuses on the
    // same terms a campaign does, and names the same domain.
    expect(result.status).toBe(409)
    expect(String(result.body?.error)).toContain('acme.com')
    expect(sent).toHaveLength(0)
  })

  it('ignores a DOMAIN named in the request', async () => {
    /*
     * The spoofing path, closed.
     *
     * `sendingIdentity` has exactly two values, and a domain name is not one
     * of them. A body naming `acme.com` therefore reads as an absent field
     * and resolves to the site's standing selection — which here is nothing,
     * so the shared domain. An editor cannot name a domain to send as, not
     * even one their own org has verified for a different site.
     */
    store.set('orgs/org-1/sendingDomains/acme.com', {
      domain: 'acme.com',
      status: 'verified',
      dkimPublicKey: 'key',
    })

    await test$({ sendingIdentity: 'acme.com' })

    expect(sent[0]['sendingIdentity']).toMatchObject({
      from: 'noreply@aglyn.com',
      source: 'platform',
    })
  })
})

/*==========================================
  The spoofing path is closed TWICE, and each
  layer is pinned on its own
==========================================*/

/**
 * TWO REDUCTIONS, ASSERTED SEPARATELY.
 *
 * A request-named domain is discarded at the route's edge AND ignored again
 * by the resolver, which is the right shape for a boundary this expensive to
 * get wrong. It is also the shape that hides a regression: with both in
 * place, removing either one changes no observable behavior, so a test that
 * only drives the handler stays green while half the defense is gone.
 *
 * So each layer is pinned where it is separately visible — the edge by what a
 * DRAFT stores, and the resolver by calling the send function directly with
 * the value the edge would never pass it.
 */
describe('each half of the reduction is load-bearing on its own', () => {
  it('THE EDGE: a draft stores no domain name from the request', async () => {
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
      sendingIdentity: 'acme.com',
    })

    /*
     * The stored record is where the edge reduction becomes visible: without
     * it, `acme.com` lands on the document, and `storedSendOptionsFrom` reads
     * it back when the draft is later sent or scheduled — so a name from a
     * request would survive as a durable field and reach the resolver from a
     * direction nobody was inspecting.
     */
    const draft = store.get(`hosts/${HOST}/campaigns/draft-1`) ?? {}
    expect(draft['sendingIdentity']).toBeUndefined()
  })

  it('THE EDGE: a draft DOES store an explicit platform choice', async () => {
    // The control. Without it the assertion above passes against a route that
    // stores nothing at all, which would lose a merchant's choice instead of
    // protecting them from somebody else's.
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-2',
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
      sendingIdentity: 'platform',
    })

    const draft = store.get(`hosts/${HOST}/campaigns/draft-2`) ?? {}
    expect(draft['sendingIdentity']).toBe('platform')
  })

  it('THE RESOLVER: a domain reaching the send function is still ignored', async () => {
    /*
     * Called directly, with the value the edge exists to prevent.
     *
     * This is the layer that has to hold when the edge does not — a stored
     * field written before the reduction existed, a second caller, a future
     * action that forgets to reduce. The site here has selected nothing, so
     * any appearance of `acme.com` could only have come from the option.
     */
    store.set('orgs/org-1/sendingDomains/acme.com', {
      domain: 'acme.com',
      status: 'verified',
      dkimPublicKey: 'key',
    })

    await performCampaignSend({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'manual',
      emails: [CALLER],
      recordCampaign: false,
      senderUid: 'uid-1',
      proofFor: CALLER,
      sendingIdentity: 'acme.com',
    })

    expect(sent[0]['sendingIdentity']).toMatchObject({
      from: 'noreply@aglyn.com',
      source: 'platform',
    })
  })
})

/*==========================================
  What the drawer is built from
==========================================*/

describe('proofOptions answers who may receive and who may be rendered', () => {
  it('offers the caller and their colleagues, and no contacts', async () => {
    const result = await post({ hostId: HOST, action: 'proofOptions' })

    const addresses = (result.body?.recipients ?? []).map(
      (one: any) => one.email,
    )
    expect(addresses).toContain(CALLER)
    expect(addresses).toContain(COLLEAGUE)
    // The recipient list is the RULE made visible. A contact appearing here
    // would offer somebody an address the send then refuses.
    expect(addresses).not.toContain(CONTACT)
  })

  it('offers contacts and leads as personas', async () => {
    const result = await post({ hostId: HOST, action: 'proofOptions' })

    const personas = (result.body?.personas ?? []).map((one: any) => one.email)
    expect(personas).toContain(CONTACT)
    expect(personas).toContain('lead@example.com')
  })

  it('answers without a subject or a body', async () => {
    // The drawer opens before anything is written. A route that required copy
    // would make the picker unreachable exactly when it is wanted.
    const result = await post({ hostId: HOST, action: 'proofOptions' })

    expect(result.status).toBe(200)
  })
})

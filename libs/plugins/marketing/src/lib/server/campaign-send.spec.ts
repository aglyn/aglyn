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
 * What a designed campaign actually puts in a recipient's inbox (AGL-1394).
 *
 * Every other instance of the two-storage-forms trap under-reports to a
 * console user who can go and look. This one is the only one that ships wrong
 * output to THIRD PARTIES: the send goes out, nobody is told anything, and the
 * first people to notice the missing product blocks are the customers.
 *
 * So these assertions are deliberately made against the delivered payload —
 * the arguments `sendEmail` was actually called with — rather than against
 * `loadEmailTemplate`'s return value. A decode that is correct but never
 * reaches the HTML is worth nothing here.
 */

const mockState: {
  store: Record<string, Record<string, unknown>>
  sent: Array<Record<string, any>>
  metered: Array<[string, number, string]>
  /** The site's sending-domain selection; null means the platform identity. */
  sendingDomain: {
    domain: string
    status: string
    localPart: string
    missing?: string[]
  } | null
  /** The owning org's plan. What `getOrgForHost` answers, and the only
   *  input that decides whether the campaign cap admits a send. */
  plan: OrgPlan
} = { store: {}, sent: [], metered: [], sendingDomain: null, plan: 'pro' }

// The module graph behind `@aglyn/tenant-data-admin` reaches the admin SDK,
// which does not load under the jest environment. Nothing real is needed:
// `performCampaignSend` takes its firestore from `firebaseAdmin`.
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
  /*
   * BOTH suppression lists, the shape the real helper has (D6). Written out
   * rather than left permissive because a double that never suppresses
   * anybody cannot tell a sender consulting one list from one consulting two.
   */
  // Nobody in these fixtures has left a topic, so the send's third filter is
  // a pass-through. Modeled rather than omitted: an absent export reads as
  // `undefined` and fails the send with a TypeError, which is a red that says
  // nothing about the behavior under test.
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails,
  filterSendableForHost: async (hostId: string, emails: string[]) =>
    emails.filter((email) => {
      // `require` inside the factory rather than the file's own import: a
      // mock factory is hoisted above every import, so a top-level binding is
      // still in its temporal dead zone when this object is built.
      const key = require('crypto')
        .createHash('sha256')
        .update(email.trim().toLowerCase())
        .digest('hex')
      return (
        !mockState.store[`emailSuppressions/${key}`] &&
        !mockState.store[`hosts/${hostId}/suppressions/${key}`]
      )
    }),
  // The owning org, whose plan decides the campaign cap. Defaulted to a plan
  // whose `emailSendsPerMonth` is non-zero, or the cap refuses the send
  // before any of this is reached — campaign email starts at Pro, and Free
  // and Starter are both 0 by design. `mockState.plan` is what the tier tests
  // at the bottom of this file move.
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: mockState.plan } }),
  /*
   * The sending identity. The REAL `resolveSendingIdentity` runs — only the
   * document reads behind it are faked — so these tests exercise the decision
   * the product makes rather than a stand-in for it. `mockState.sendingDomain`
   * is what a test sets to put a site on a custom domain.
   */
  resolveHostSendingIdentity: async (options: {
    selectedDomain?: string
    selectedLocalPart?: string
  }) => {
    /*
     * Mirrors the real store rather than short-circuiting it: the record is
     * found only for the domain actually ASKED about, so a caller that reads
     * the selection from the wrong place gets the wrong answer here too. A
     * domain with no record refuses, exactly as `resolveHostSendingIdentity`
     * does for a released or cross-org claim.
     */
    const claimed = mockState.sendingDomain
    const asked = options?.selectedDomain
    const selection = !asked
      ? null
      : claimed && claimed.domain === asked
        ? { ...claimed, localPart: options.selectedLocalPart || claimed.localPart }
        : { domain: asked, status: 'failed', localPart: '', missing: [] }
    return jest
      .requireActual('@aglyn/shared-util-email')
      .resolveSendingIdentity({
        selection,
        // `isEmailConfigured` is mocked true below without the env being
        // set, so the platform address is supplied here to match. In the
        // product both read the same variable and cannot disagree.
        platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
      })
  },
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
  // The meter (AGL-1438). Recorded rather than executed: `email-metering.spec`
  // owns what a write does to the two counters; what matters HERE is that this
  // sender calls it exactly once, with the delivered count, as a campaign.
  meterHostEmail: async (hostId: string, count: number, sendClass: string) => {
    mockState.metered.push([hostId, count, sendClass])
  },
  /*
   * The ORG-scoped, atomic campaign cap (AGL-2267).
   *
   * The cap used to be read off `hosts/{hostId}/counters/campaignEmailSends`
   * — per SITE, against an ORG entitlement, so an org with N sites got N × the
   * cap it bought — and it was a plain read followed by a post-delivery
   * increment, so two concurrent campaigns both passed the same figure.
   *
   * These stubs are backed by the SAME `mockState.store` the fake Firestore
   * uses, and they read and write the ORG path, so the assertions below are
   * about the counter the product now enforces on. The transaction semantics
   * themselves — abort-and-retry under contention, the reconcile — are owned
   * by `campaign-send-reservation.spec.ts`, which models them properly; a
   * single-threaded stub here would only pretend to.
   */
  orgCampaignEmailSendsForMonth: async (orgId: string, month: string) => {
    const used = Number(
      mockState.store[`orgs/${orgId}/counters/campaignEmailSends`]?.[month] ?? 0,
    )
    return Number.isFinite(used) && used > 0 ? used : 0
  },
  reserveCampaignEmailSends: async ({ orgId, month, count, limit }: any) => {
    const path = `orgs/${orgId}/counters/campaignEmailSends`
    const used = Number(mockState.store[path]?.[month] ?? 0) || 0
    if (used + count > limit) return { ok: false, used, limit }
    mockState.store[path] = { ...(mockState.store[path] ?? {}), [month]: used + count }
    return {
      ok: true,
      reservation: { orgId, month, reserved: count },
      used,
      limit,
    }
  },
  reconcileCampaignSendReservation: async (
    reservation: any,
    delivered: number,
  ) => {
    if (!reservation) return
    const refund = Math.max(0, reservation.reserved - delivered)
    if (refund <= 0) return
    const path = `orgs/${reservation.orgId}/counters/campaignEmailSends`
    const used = Number(mockState.store[path]?.[reservation.month] ?? 0) || 0
    mockState.store[path] = {
      ...(mockState.store[path] ?? {}),
      [reservation.month]: Math.max(0, used - refund),
    }
  },
  // The platform hourly ceiling (AGL-2409). Wide open here — this file is
  // about the monthly cap and the cost meter, and `send-rate.spec.ts` plus
  // `email-send-rate.spec.ts` own the ceiling.
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

// Only the two I/O functions are stubbed — `renderEmailHtml` and the merge
// helpers come through the same barrel and must stay REAL, because the HTML
// they produce is the thing under test.
jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockState.sent.push(message)
    return { sent: true }
  },
}))

import { compress } from '@aglyn/aglyn/server'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { OrgPlan } from '@aglyn/aglyn'
import { CampaignSendError, performCampaignSend } from './campaign-send'

/** The id the besigner roots every stored node map at. */
const ROOT = '_@_'

/**
 * A designed email exactly as `createEmailScreen` + the screen besigner leave
 * it: rooted at `_@_`, one section, a greeting carrying a merge token, a
 * picked image stored as a `media:` reference, and the product block this
 * issue is named for.
 */
const NODES: Record<string, unknown> = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['sec'] },
  sec: {
    $id: 'sec',
    componentId: 'emailSection',
    pluginId: 'email',
    parentId: ROOT,
    nodes: ['txt', 'img', 'prod'],
  },
  txt: {
    $id: 'txt',
    componentId: 'emailText',
    props: { children: 'Hi {{contact.firstName}}, the sale is on.' },
  },
  img: {
    $id: 'img',
    componentId: 'emailImage',
    props: { src: 'media:host-1/banner1', alt: 'Spring sale' },
  },
  prod: {
    $id: 'prod',
    componentId: 'emailProduct',
    props: { productId: 'prod-1', buttonLabel: 'Shop the chair' },
  },
}

/**
 * What firebase-admin actually hands back for a `Bytes` field: a Node
 * `Buffer` carved out of the shared allocation pool, so `byteOffset` is
 * non-zero and `buffer.byteLength` is the whole pool rather than the field.
 *
 * Carved from a slab of our own rather than `Buffer.from`, which draws on the
 * real pool and lands at whatever offset the rest of the process left behind
 * — 0 whenever the pool has just been replaced. A zero-offset buffer would
 * let the byteOffset bug pass by luck, which is exactly the bug most likely
 * to come back. Mirrors the helper in `stored-nodes.spec.ts`.
 */
const pooledBuffer = (value: unknown = NODES) => {
  const bytes = compress(value)
  const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
  const packed = pool.subarray(64, 64 + bytes.byteLength)
  packed.set(bytes)
  return packed
}

/**
 * A path-keyed Firestore stand-in covering only the shapes this send makes:
 * doc gets, `collection(...).limit(...).get()`, and merge sets.
 */
function mockFirestore(): any {
  const store = mockState.store
  const snapshot = (path: string) => {
    const data = store[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      data: () => data,
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
  /**
   * The ids directly under `path`, in `__name__` order — which is what the
   * audience sweep asks for, and what the real Firestore returns for it.
   */
  const childIds = (path: string) =>
    Object.keys(store)
      .filter(
        (key) =>
          key.startsWith(`${path}/`) &&
          !key.slice(path.length + 1).includes('/'),
      )
      .map((key) => key.slice(path.length + 1))
      .sort()
  /**
   * `orderBy` / `startAfter` / `limit`, and `limit` HONORS its argument.
   *
   * A double whose `limit` returns everything cannot fail the way the real
   * one does, so a paging bug would pass here and truncate in production.
   */
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

/** Seeds a site, a lead, a designed email screen, and its product. */
function seed(nodes: unknown) {
  mockState.store = {
    'hosts/host-1': { subdomain: 'acme', memberRoles: {} },
    // A `leads` audience so the merge tags have a real name to resolve, and a
    // recorded opt-in so the consent join lets it through. The join runs ahead
    // of the cap, the suppression filter and the meter and refuses an audience
    // in which nobody carries a basis, so a lead seeded for any other purpose
    // still has to declare one to reach the code under test.
    'hosts/host-1/leads/lead-1': {
      email: 'dana@example.com',
      name: 'Dana Reed',
      // The basis belongs to the site sending, not to the org.
      marketingConsentByHost: {
        'host-1': { marketingConsent: true, marketingConsentAtMs: Date.UTC(2026, 7, 1) },
      },
    },
    'hosts/host-1/screens/screen-1': {
      kind: 'email',
      versionId: 'v1',
      emailSubject: 'Spring sale',
      emailPreheader: 'Ends Sunday',
    },
    'hosts/host-1/screens/screen-1/versions/v1': { nodes },
    'hosts/host-1/products/prod-1': {
      name: 'Aeron Chair',
      slug: 'aeron-chair',
      variants: [{ priceUsd: 995 }],
    },
  }
  mockState.sent = []
  mockState.metered = []
  mockState.sendingDomain = null
  mockState.plan = 'pro'
}

/**
 * Put a site on a custom sending domain: the org's RECORD, plus the host
 * document's selection. Both, because the route reads the selection off the
 * host and the store looks the record up from that.
 */
function selectSendingDomain(record: typeof mockState.sendingDomain) {
  mockState.sendingDomain = record
  ;(mockState.store['hosts/host-1'] as Record<string, unknown>).sendingDomain =
    record?.domain
  ;(mockState.store['hosts/host-1'] as Record<string, unknown>).sendingLocalPart =
    record?.localPart
}

const send = () =>
  performCampaignSend({
    hostId: 'host-1',
    subject: 'Spring sale',
    body: 'plain-text fallback',
    audience: 'leads',
    templateScreenId: 'screen-1',
    // Skips the campaign record + counter writes; the delivered payload is
    // identical either way.
    recordCampaign: false,
    senderUid: 'uid-1',
  })

let previousSecret: string | undefined
beforeAll(() => {
  previousSecret = process.env['EMAIL_UNSUBSCRIBE_SECRET']
  process.env['EMAIL_UNSUBSCRIBE_SECRET'] = 'test-secret'
})
afterAll(() => {
  if (previousSecret === undefined) {
    delete process.env['EMAIL_UNSUBSCRIBE_SECRET']
  } else {
    process.env['EMAIL_UNSUBSCRIBE_SECRET'] = previousSecret
  }
})

/**
 * A `kind: 'email'` screen is a SCREEN document. `createEmailScreen` writes it
 * under `hosts/{h}/screens/{id}` and the Emails list opens it in the screen
 * besigner, which saves through `use-screen-version`'s converter —
 * `Bytes.fromUint8Array(compress(nodes))`. Only the very first version, the
 * one created from a JSON body through `/api/hosts/versions`, is a plain map;
 * the first save in the designer converts it.
 *
 * The neighbouring `publish-email-template.ts` reading `nodes` raw is NOT
 * evidence that this is fine — it reads `emailTemplates`, a different
 * collection whose besigner saves with a bare `setDoc` and no converter, so
 * those really are plain maps.
 */
describe('a designed campaign whose version is stored compressed (AGL-1394)', () => {
  it('delivers the emailProduct block, not a Buffer', async () => {
    seed(pooledBuffer())
    // Guard the premise: on a zero-offset buffer the byteOffset bug passes.
    const stored = mockState.store['hosts/host-1/screens/screen-1/versions/v1']
    expect((stored['nodes'] as Buffer).byteOffset).toBeGreaterThan(0)

    await expect(send()).resolves.toMatchObject({ recipients: 1, sent: 1 })

    const [message] = mockState.sent
    // The product block is the whole point: resolved by id from the node
    // tree, priced from the catalog, linked absolute for an inbox.
    expect(message['html']).toContain('Aeron Chair')
    expect(message['html']).toContain('$995')
    expect(message['html']).toContain('https://acme.aglyn.app/products/aeron-chair')
    expect(message['html']).toContain('Shop the chair')
    // …and the rest of the design, which travelled in the same Buffer.
    expect(message['html']).toContain('Hi Dana, the sale is on.')
    // The plain-text alternative is built from the same walk. Empty here is
    // the "garbage body" a recipient sees: an unsubscribe footer and nothing
    // above it.
    expect(message['text']).toContain('Hi Dana, the sale is on.')
    expect(message['text']).toContain('Aeron Chair — $995')
  })

  /**
   * RFC 8058 one-click (AGL-2408). Gmail's and Yahoo's bulk-sender rules ask
   * for the PAIR; `List-Unsubscribe` on its own — which is all this sender
   * set until now — does not satisfy them, and Gmail is where most of a
   * merchant's list lives.
   *
   * Asserted on the delivered message rather than on a constant, because a
   * header the sender computes but never attaches is exactly the shape this
   * bug had: the URL was built, signed, and put in one header while the
   * companion that makes it actionable was absent.
   */
  it('sends the RFC 8058 one-click header pair', async () => {
    seed(pooledBuffer())
    await send()

    const [message] = mockState.sent
    const headers = message['headers'] as Record<string, string>
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    // The URL half must still be there and must still be angle-bracketed —
    // a bare URL is not a valid header value.
    expect(headers['List-Unsubscribe']).toMatch(
      /^<https:\/\/acme\.aglyn\.app\/api\/email\/unsubscribe\?[^>]+>$/,
    )
  })

  /**
   * The renderer defaults `rootId` to `'root'` for ad-hoc callers, and a
   * besigner map is rooted at `'_@_'` — so a decode that is correct still
   * renders NOTHING unless the root is named (AGL-765). Both other send
   * paths, `renderLoadedSystemEmail` and `renderLoadedHostEmail`, pass it.
   */
  it('renders from the besigner root rather than the default "root"', async () => {
    seed(pooledBuffer())
    await send()

    const [message] = mockState.sent
    // The 600px shell renders whether or not a root was found, so assert on
    // the CONTENT — an empty shell is what shipped before. The section is the
    // first thing under the root, so its wrapper proves the root resolved.
    expect(message['html']).toContain('background-color:#ffffff')
    // And the text alternative is not just the unsubscribe footer.
    expect(String(message['text']).trim().startsWith('—')).toBe(false)
  })

  /**
   * A picked image is stored as `media:{scope}/{mediaId}` and resolves to a
   * SITE-RELATIVE CDN path. Without an origin the renderer DROPS it (AGL-1224)
   * — every image an author picked is simply absent from the delivered mail.
   */
  it('absolutizes a picked image against the site origin', async () => {
    seed(pooledBuffer())
    await send()

    expect(mockState.sent[0]['html']).toContain(
      'https://acme.aglyn.app/api/media/cdn/host-1/banner1',
    )
  })

  /**
   * The empty-template guard exists to stop exactly this outcome, and the raw
   * read is what defeats it: `Object.keys` of a Buffer yields the byte
   * INDICES, so a compressed version reads as a populated template. Once the
   * bytes are decoded the guard sees the truth — an undecodable payload
   * refuses the send instead of mailing an empty design to real customers.
   */
  it('refuses the send when the stored bytes do not decode', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      seed(Buffer.from([0xc1, 0xc1, 0xc1]))
      // The premise: the guard's own test cannot see anything wrong here.
      expect(
        Object.keys(
          mockState.store['hosts/host-1/screens/screen-1/versions/v1'][
            'nodes'
          ] as object,
        ).length,
      ).toBeGreaterThan(0)

      await expect(send()).rejects.toThrow('The email template is empty')
      await expect(send()).rejects.toBeInstanceOf(CampaignSendError)
      expect(mockState.sent).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  /** Both storage forms must agree — the first version is still a plain map. */
  it('still delivers a plain-map version unchanged', async () => {
    seed(NODES)
    await expect(send()).resolves.toMatchObject({ sent: 1 })

    expect(mockState.sent[0]['html']).toContain('Aeron Chair')
    expect(mockState.sent[0]['html']).toContain('Hi Dana, the sale is on.')
  })

  it('still refuses a template with no nodes at all', async () => {
    seed(undefined)
    await expect(send()).rejects.toThrow('The email template is empty')
    expect(mockState.sent).toHaveLength(0)
  })
})

/**
 * The two meters (AGL-1438).
 *
 * This sender is the only one a quota may refuse, and it is also the one that
 * used to be the ONLY writer of `counters/emailSends` — which is how a counter
 * named for all email came to hold campaign sends alone. Both halves are
 * asserted here: it still enforces, and it now counts through the shared meter
 * instead of writing the counter itself.
 */
describe('the campaign cap and the cost meter (AGL-1438)', () => {
  /*
   * The band the fixture org actually has, read from the entitlements
   * rather than written as a literal. A cap test that hardcodes a number
   * stops testing the cap the day the tier's band moves: it either seeds
   * short of a raised band and sends, or past a lowered one and refuses
   * for the wrong reason.
   */
  const CAP = PLAN_ENTITLEMENTS.pro.emailSendsPerMonth

  const recorded = () =>
    performCampaignSend({
      hostId: 'host-1',
      subject: 'Spring sale',
      body: 'plain-text fallback',
      audience: 'leads',
      templateScreenId: 'screen-1',
      senderUid: 'uid-1',
    })

  it('meters the delivered count once, as a campaign', async () => {
    seed(NODES)
    await expect(recorded()).resolves.toMatchObject({ sent: 1 })

    // Exactly one call: a send that both incremented inline AND went through
    // the shared helper would bill this org twice for one email.
    expect(mockState.metered).toEqual([['host-1', 1, 'campaign']])
  })

  it('no longer writes the cost counter itself', async () => {
    seed(NODES)
    await recorded()

    // The inline increment this sender used to do. Its absence is what makes
    // the single `meterHostEmail` call above the whole of the accounting.
    expect(mockState.store['hosts/host-1/counters/emailSends']).toBeUndefined()
  })

  /**
   * The regression that would recreate AGL-1438 pointing the other way. Once
   * `emailSends` holds every receipt, booking reminder and password reset a
   * site sends, enforcing the campaign cap against it would refuse a campaign
   * because the store had a busy week of orders.
   */
  it('ignores transactional volume when deciding the cap', async () => {
    seed(NODES)
    const month = new Date().toISOString().slice(0, 7)
    // Transactional volume far past the plan's campaign band, which must not
    // matter at all: the cap is measured against campaigns alone.
    mockState.store['hosts/host-1/counters/emailSends'] = { [month]: CAP * 2 }

    await expect(recorded()).resolves.toMatchObject({ sent: 1 })
    expect(mockState.sent).toHaveLength(1)
  })

  it('still refuses a campaign once the campaign meter is at the cap', async () => {
    seed(NODES)
    const month = new Date().toISOString().slice(0, 7)
    mockState.store['orgs/org-1/counters/campaignEmailSends'] = {
      [month]: CAP,
    }

    await expect(recorded()).rejects.toThrow(/campaign email limit/i)
    expect(mockState.sent).toHaveLength(0)
  })

  /**
   * AGL-2267. The cap is the ORG's, so a SITE counter at the cap is not the
   * cap — it is one site's history. Before this, the cap was read per site,
   * which handed an org with N sites N × the allowance it bought.
   *
   * This is the mutation that would restore the defect: point the read back at
   * `hosts/{hostId}/counters/...` and this test refuses a campaign that should
   * send.
   */
  it('does NOT read the per-SITE counter as the cap (AGL-2267)', async () => {
    seed(NODES)
    const month = new Date().toISOString().slice(0, 7)
    mockState.store['hosts/host-1/counters/campaignEmailSends'] = {
      [month]: CAP,
    }

    await expect(recorded()).resolves.toMatchObject({ sent: 1 })
    expect(mockState.sent).toHaveLength(1)
  })

  /**
   * The AGL-2267 defect, stated as the property it broke: **two sites of one
   * org share ONE allowance.** Per-site enforcement handed an org with N sites
   * N × the cap it bought, and it grew with the plan — invisible on Free and
   * Starter, where `hostLimit` is 1.
   *
   * `getOrgForHost` answers `org-1` for every host in this file, so a cap
   * keyed on the ORG refuses this and a cap keyed on the SITE (or on any other
   * subject) does not.
   */
  it('is ONE allowance across the org, not one per site (AGL-2267)', async () => {
    seed(NODES)
    const month = new Date().toISOString().slice(0, 7)
    mockState.store['orgs/org-1/counters/campaignEmailSends'] = { [month]: CAP }
    // A DIFFERENT site of the same org, with no counter of its own.
    mockState.store['hosts/host-2'] = { subdomain: 'acme-two' }
    mockState.store['hosts/host-2/leads/lead-1'] = {
      email: 'lead@example.com',
      visibleTo: ['host-2'],
      // Consented, so the send is refused by the org's exhausted allowance
      // and not by the consent join sitting in front of it. Both refusals are
      // a 400, so without a basis here this would pass on the wrong message.
      // Recorded against `host-2`, which is the site sending: a basis under
      // the sibling site would be withheld, and this test would then pass on
      // the consent refusal rather than the allowance one it is about.
      marketingConsentByHost: {
        'host-2': {
          marketingConsent: true,
          marketingConsentAtMs: Date.UTC(2026, 7, 1),
        },
      },
    }

    await expect(
      performCampaignSend({
        hostId: 'host-2',
        subject: 'Spring sale',
        body: 'plain-text fallback',
        audience: 'leads',
        senderUid: 'uid-1',
      }),
    ).rejects.toThrow(/campaign email limit/i)
    expect(mockState.sent).toHaveLength(0)
  })

  it('claims the batch against the ORG counter and reconciles to what went out', async () => {
    seed(NODES)
    const month = new Date().toISOString().slice(0, 7)

    await expect(recorded()).resolves.toMatchObject({ sent: 1 })
    // One recipient in this fixture: claimed 1, delivered 1, so the counter
    // holds 1 — not the batch size, and not zero.
    expect(
      mockState.store['orgs/org-1/counters/campaignEmailSends']?.[month],
    ).toBe(1)
  })
})

/**
 * The VISIBLE refusal.
 *
 * `send-email.spec.ts` proves the send path will not put a message on the
 * wire for an unverified identity. That is the backstop. This file proves the
 * thing a person actually experiences: the campaign route says no, with a
 * status, naming the domain — instead of returning `{sent: 0}` and leaving a
 * merchant to guess.
 *
 * The distinction is the whole lesson of `USAGE_EMAIL_FROM` being empty in
 * production for weeks. That outage sent nothing and reported nothing, because
 * mail is best-effort at every call site. A refusal nobody is told about is
 * the same defect with a different cause.
 */
describe('a campaign refuses an unverified sending domain, visibly', () => {
  beforeEach(() => {
    seed(pooledBuffer())
    selectSendingDomain({
      domain: 'acme.com',
      status: 'records-issued',
      localPart: 'hello',
      missing: ['TXT:send.acme.com'],
    })
  })

  const campaign = (extra: Record<string, unknown> = {}) =>
    performCampaignSend({
      hostId: 'host-1',
      subject: 'Spring sale',
      body: 'plain-text fallback',
      audience: 'leads',
      templateScreenId: 'screen-1',
      recordCampaign: false,
      senderUid: 'uid-1',
      ...extra,
    })

  it('answers 409 and names the domain', async () => {
    await expect(campaign()).rejects.toBeInstanceOf(CampaignSendError)
    await campaign().catch((error: CampaignSendError) => {
      // 409, not 501: the deployment is fine, the customer's DNS is not, and
      // the two need opposite messages pointed at opposite people.
      expect(error.status).toBe(409)
      expect(error.message).toContain('acme.com')
      // And the record they still have to publish, so the message is
      // actionable rather than merely correct.
      expect(error.message).toContain('TXT:send.acme.com')
    })
  })

  it('sends nothing at all', async () => {
    await campaign().catch(() => undefined)

    expect(mockState.sent).toHaveLength(0)
  })

  it('does not fall back to the platform identity', async () => {
    await campaign().catch(() => undefined)

    // The platform address is configured and usable. Not one message left on
    // it, which is the property the whole feature exists to hold: a tenant's
    // reputation risk must not land back on the shared domain.
    expect(mockState.sent.map((message) => message.from)).toEqual([])
    expect(JSON.stringify(mockState.sent)).not.toContain('aglyn.com')
  })

  it('refuses the dry run too, so the composer learns before anyone writes copy', async () => {
    // `preview` resolves the identity for the same reason a real send does.
    // A preview that reported a healthy dry run for a campaign Send then
    // refuses would be worse than no preview.
    await expect(campaign({ dryRun: true })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('writes no campaign document and no counter', async () => {
    await campaign().catch(() => undefined)

    const written = Object.keys(mockState.store).filter((path) =>
      path.includes('/campaigns/'),
    )
    expect(written).toEqual([])
    expect(mockState.metered).toEqual([])
  })

  it('refuses a domain a lookup has already failed', async () => {
    selectSendingDomain({
      domain: 'acme.com',
      status: 'failed',
      localPart: 'hello',
      missing: ['MX:send.acme.com'],
    })

    await campaign().catch((error: CampaignSendError) => {
      expect(error.status).toBe(409)
      expect(error.message).toMatch(/checked the DNS/i)
    })
    expect(mockState.sent).toHaveLength(0)
  })
})

describe('a campaign on a verified sending domain', () => {
  beforeEach(() => {
    seed(pooledBuffer())
    selectSendingDomain({
      domain: 'acme.com',
      status: 'verified',
      localPart: 'news',
    })
  })

  const campaign = (extra: Record<string, unknown> = {}) =>
    performCampaignSend({
      hostId: 'host-1',
      subject: 'Spring sale',
      body: 'plain-text fallback',
      audience: 'leads',
      templateScreenId: 'screen-1',
      recordCampaign: false,
      senderUid: 'uid-1',
      ...extra,
    })

  it('hands the send path the tenant’s own address, not the platform one', async () => {
    await campaign()

    // Asserted on the verdict the route passes down rather than on a rendered
    // `from`, because `sendEmail` is stubbed here. Turning this verdict into
    // the address on the wire is `send-email.spec.ts`'s job and is proved
    // there; what this suite owns is that the route resolves the identity
    // server-side and hands over the right one.
    expect(mockState.sent).toHaveLength(1)
    expect(mockState.sent[0].sendingIdentity).toMatchObject({
      from: 'news@acme.com',
      source: 'custom',
      refusal: null,
    })
  })

  it('tells the composer which identity is in use', async () => {
    // The surface requirement. A merchant should never have to guess whether
    // their campaign goes out as their brand or as the shared domain.
    const preview = await campaign({ dryRun: true })

    expect(preview.identitySource).toBe('custom')
    expect(preview.identity).toContain('news@acme.com')
  })

  it('names the platform domain when the site selects nothing', async () => {
    selectSendingDomain(null)

    const preview = await campaign({ dryRun: true })

    expect(preview.identitySource).toBe('platform')
    expect(preview.identity).toMatch(/shared platform domain/i)
  })

  it('ignores a sending domain named in the request', async () => {
    /*
     * The spoofing path, closed.
     *
     * `campaignSendHandler` builds its options from the request body, so a
     * field read off `options` is a field an authenticated site editor can
     * choose. Resolving the identity from anything but the host document
     * would let them send as any domain they can name — including one this
     * org never claimed and never proved.
     *
     * The site here has selected NOTHING, so the platform identity is the
     * correct answer and a request-supplied domain is the only way the custom
     * one could appear.
     */
    selectSendingDomain(null)

    const preview = await campaign({
      dryRun: true,
      sendingDomain: 'acme.com',
      sendingLocalPart: 'ceo',
    })

    expect(preview.identitySource).toBe('platform')
    expect(preview.identity).not.toContain('acme.com')
  })
})

/**
 * The marketplace kill switch, reaching an email a site already installed.
 *
 * An installed email starter is a COPY in the site's own screens, so
 * unpublishing the listing, taking it down and rejecting a version all stop at
 * the storefront: none of them is felt by a tenant who installed last week and
 * is sending today. The send is the only chokepoint left, which is why the
 * check lives beside the load rather than beside the install.
 *
 * The refusal is of the SEND. The screen and its version stay exactly where
 * they were — reaching into a customer's own documents to enforce a decision
 * about somebody else's artifact would take the wrong thing away.
 */
describe('a killed marketplace email stops sending', () => {
  /** Stamps marketplace provenance onto a seeded design, as the install does. */
  const installedFrom = (version: string | null) => ({
    listingId: 'listing-1',
    version,
    sha256: 'sha-of-content',
    artifactType: 'emailStarter',
    publisherOrgId: 'seller-org',
    assurance: 'unreviewed',
  })

  const seedInstalled = (version: string | null = '3') => {
    seed(pooledBuffer())
    ;(
      mockState.store['hosts/host-1/screens/screen-1/versions/v1'] as Record<
        string,
        unknown
      >
    )['installedFrom'] = installedFrom(version)
  }

  const kill = (versions: string[] | 'all', reason?: string) => {
    mockState.store['revocations/listing-1'] = {
      versions,
      ...(reason ? { reason } : {}),
    }
  }

  it('refuses the send and names why', async () => {
    seedInstalled()
    kill(['3'], 'Hidden tracking image')

    await expect(send()).rejects.toThrow(/Hidden tracking image/)
    expect(mockState.sent).toHaveLength(0)
    expect(mockState.metered).toHaveLength(0)
  })

  it('leaves the design in place — the send is what is refused', async () => {
    seedInstalled()
    kill('all')

    await expect(send()).rejects.toBeInstanceOf(CampaignSendError)
    // Both documents still there, untouched, still openable in the besigner.
    expect(mockState.store['hosts/host-1/screens/screen-1']).toBeDefined()
    expect(
      mockState.store['hosts/host-1/screens/screen-1/versions/v1'],
    ).toBeDefined()
  })

  it('reaches an install whose provenance is on the SCREEN rather than the version', async () => {
    seed(pooledBuffer())
    ;(mockState.store['hosts/host-1/screens/screen-1'] as Record<string, unknown>)[
      'installedFrom'
    ] = installedFrom('3')
    kill(['3'])

    await expect(send()).rejects.toBeInstanceOf(CampaignSendError)
  })

  it('catches a version-less legacy install with a listing-wide kill', async () => {
    seedInstalled(null)
    kill('all')

    await expect(send()).rejects.toBeInstanceOf(CampaignSendError)
  })

  it('does not stop a DIFFERENT version of the same listing', async () => {
    seedInstalled('3')
    kill(['1'])

    await expect(send()).resolves.toMatchObject({ sent: 1 })
  })

  it('does not stop an email the site designed itself', async () => {
    // No provenance at all, and the whole listing killed. Nothing to match on,
    // so the kill is not this email's business.
    seed(pooledBuffer())
    kill('all')

    await expect(send()).resolves.toMatchObject({ sent: 1 })
  })

  it('sends normally when nothing is revoked', async () => {
    seedInstalled()

    await expect(send()).resolves.toMatchObject({ sent: 1 })
  })
})

/**
 * WHICH TIERS MAY SEND A CAMPAIGN AT ALL.
 *
 * Campaign email begins at Pro. A site that may send needs its own verified
 * provider sending domain, and provisioning one is a per-site operational
 * cost, so the allowance is attached to the tiers that carry it rather than
 * to every paid tier.
 *
 * ## Why this drives the SEND and not the entitlement
 *
 * `PLAN_ENTITLEMENTS.starter.emailSendsPerMonth === 0` is one line and it
 * proves nothing about behavior: it would pass identically against a build
 * where the cap was never read, or read against the wrong counter, or read
 * and then ignored. So each case here runs the whole of
 * `performCampaignSend` — audience resolution, the consent join, the
 * suppression filters, the reservation — and asserts on what came out of the
 * sender.
 *
 * The tier is the ONLY thing moved between cases: same site, same lead, same
 * consent, same template. That is what makes the difference between them
 * attributable to the plan.
 */
describe('campaign email begins at Pro', () => {
  const attempt = (plan: OrgPlan) => {
    seed(NODES)
    mockState.plan = plan
    return send()
  }

  it('refuses a STARTER org, and nothing goes out', async () => {
    await expect(attempt('starter')).rejects.toThrow(/campaign email limit/i)
    // The refusal is the point, not merely the rejection: no message was
    // handed to the sender and no delivery was metered. A cap that threw
    // after the batch had gone out would satisfy `rejects` alone.
    expect(mockState.sent).toHaveLength(0)
    expect(mockState.metered).toHaveLength(0)
    // And no claim was written. `reserveCampaignEmailSends` writes NOTHING on
    // a refusal, so a Starter org that tries every day does not accumulate a
    // counter it could never spend.
    const month = new Date().toISOString().slice(0, 7)
    expect(
      mockState.store['orgs/org-1/counters/campaignEmailSends']?.[month],
    ).toBeUndefined()
  })

  it('refuses a FREE org the same way', async () => {
    // Starter is now in exactly the shape Free has always been in, said in
    // the only terms that matter: the same refusal, from the same gate, on
    // the same audience.
    await expect(attempt('free')).rejects.toThrow(/campaign email limit/i)
    expect(mockState.sent).toHaveLength(0)
  })

  it('CONTROL: a PRO org still sends', async () => {
    // Without this the cases above are satisfied by a build that refuses
    // every campaign on every tier — which would pass every entitlement
    // assertion in the repo while shipping a dead feature.
    await expect(attempt('pro')).resolves.toMatchObject({ sent: 1 })
    expect(mockState.sent).toHaveLength(1)
    expect(mockState.metered).toEqual([['host-1', 1, 'campaign']])
  })

  it('CONTROL: every tier above Pro sends too', async () => {
    // The control widened. One passing tier could still be a gate admitting
    // exactly one plan; the claim is that the refusal is confined to the two
    // tiers banded at zero.
    for (const plan of ['business', 'scale', 'advanced', 'agency'] as const) {
      await expect(attempt(plan)).resolves.toMatchObject({ sent: 1 })
    }
  })

  it('refuses on the BAND, not on a list of plan names', async () => {
    // The mutation that would make the block above pass for the wrong
    // reason: a gate hard-coded to plan names rather than reading the
    // entitlement. Every tier refused above has a band of 0 and every tier
    // admitted has one above 0, read from the table the sender itself reads.
    for (const plan of ['free', 'starter'] as const) {
      expect(`${plan}: ${PLAN_ENTITLEMENTS[plan].emailSendsPerMonth}`).toBe(
        `${plan}: 0`,
      )
    }
    for (const plan of [
      'pro',
      'business',
      'scale',
      'advanced',
      'agency',
    ] as const) {
      expect(`${plan}: ${PLAN_ENTITLEMENTS[plan].emailSendsPerMonth > 0}`).toBe(
        `${plan}: true`,
      )
    }
  })

  it('names the band in the message, so the reason is legible', async () => {
    // A merchant reading "limit reached (0)" is being told the plan includes
    // none, which is the actual state — not that they have spent an
    // allowance they had. The upgrade path is in the same sentence.
    await expect(attempt('starter')).rejects.toThrow(
      /Monthly campaign email limit reached \(0\)/,
    )
    await expect(attempt('starter')).rejects.toThrow(/upgrade in Billing/i)
    // Transactional mail is excluded in the same breath, because a Starter
    // store still confirms its orders and the refusal must not read as
    // though it stopped that too.
    await expect(attempt('starter')).rejects.toThrow(
      /Transactional mail .* keeps sending/,
    )
  })
})

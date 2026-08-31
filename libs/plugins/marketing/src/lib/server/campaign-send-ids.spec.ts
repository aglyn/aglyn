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
 * Which document paths a campaign send is allowed to name (AGL-1771).
 *
 * This is where the `campaignId` on every Resend tag is MINTED. AGL-1768
 * refused a webhook open against a campaign that no longer exists, and noted
 * that the id it receives is one an authenticated merchant chose — filled from
 * `String(req.body?.campaignId ?? '')` on the send route. This file is the
 * other end of that trace: the send route wrote the campaign document at
 * whatever path that value named.
 *
 * Assertions are made against WHICH DOCUMENT PATHS EXIST when the call
 * returns, not against the response, because a campaign filed at
 * `campaigns/a/b/c` returns exactly the same success body as one filed
 * correctly — that is the whole reason it went unnoticed.
 *
 * THE DOUBLE MODELS `.doc()`'s PATH ARITHMETIC: the argument is APPENDED as a
 * slash-separated path, refused only when the resulting component count comes
 * out odd, and that refusal is a SYNCHRONOUS throw. A double treating the
 * argument as one opaque key would file `a/b/c` at a harmless flat id and pass
 * against the broken code as happily as against the fix.
 *
 * Two corrections to the model `email-events.spec.ts` (`d51e23df4`) and
 * `cart-cookie.spec.ts` (`f053417fa`) used, measured against the installed
 * `@google-cloud/firestore` rather than reasoned about: a reserved `__…__` id
 * (and the `.`/`..` forms) does NOT throw out of `.doc()` — the client builds
 * the reference and the SERVICE answers `INVALID_ARGUMENT` when the RPC is
 * issued; and `.doc('')` DOES throw synchronously, which neither earlier
 * double modelled. The second one matters here: it is what turned this file's
 * `cancel` branch into a 500 where the code intended a 400.
 *
 * `isDocumentId` is the REAL one throughout: it lives at
 * `@aglyn/tenant-data-admin/server/document-id`, a leaf entry point this
 * file's barrel mock does not intercept.
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

/** What the SERVICE refuses on the RPC, as opposed to what `.doc()` refuses. */
function serviceRejection(path: string): (Error & { code?: number }) | null {
  const bad = path
    .split('/')
    .find((part) => /^__.*__$/.test(part) || part === '.' || part === '..')
  if (!bad) return null
  const error: Error & { code?: number } = new Error(
    `INVALID_ARGUMENT: Document name "${path}" is not valid.`,
  )
  error.code = 3
  return error
}

function docRef(path: string): any {
  const reject = () => {
    const failure = serviceRejection(path)
    if (failure) throw failure
  }
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => {
      reject()
      return snapshotOf(path)
    },
    set: async (value: Record<string, any>) => {
      reject()
      /*
       * `FieldValue.delete()` REMOVES the field rather than storing a
       * sentinel. Merging it in as a value would leave a draft carrying a
       * `sendAtMs` whose value happens to be an object — which is exactly the
       * leftover send time the delete exists to clear, so a double that kept
       * it would pass the test the product fails.
       */
      const merged: Record<string, any> = {
        ...(store.get(path) ?? {}),
        ...value,
      }
      for (const [field, entry] of Object.entries(value)) {
        if (entry && (entry as any).__delete) delete merged[field]
      }
      store.set(path, merged)
    },
    update: async (value: Record<string, any>) => {
      reject()
      store.set(path, { ...(store.get(path) ?? {}), ...value })
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return {
    doc: (id: string) => {
      // Measured against the installed client: an empty id is refused first,
      // and SYNCHRONOUSLY.
      if (id === '') {
        throw new Error(
          `Value for argument "documentPath" is not a valid resource path. ` +
            `Path must be a non-empty string.`,
        )
      }
      const full = `${path}/${id}`
      // A document path has an EVEN component count; `.doc()` throws outright,
      // and SYNCHRONOUSLY, when the argument makes it odd.
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

/** `orderBy` / `startAfter` / `limit`, and `limit` honors its argument. */
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
   * The claim the send-now branch takes before it mails, modeled the way the
   * scheduled processor's is: read the document, and write only if it still
   * says what it said. Sequential here rather than concurrent, which is all
   * the branch under test needs — what is asserted is that the claim HAPPENS
   * and is released again, not that Firestore's isolation works.
   */
  runTransaction: async (body: any) =>
    body({
      get: async (ref: any) => ref.get(),
      update: async (ref: any, value: any) => ref.update(value),
      set: async (ref: any, value: any, options?: any) =>
        ref.set(value, options),
    }),
})

let mockUid = 'uid-1'

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
    app: () => ({
      firestore: () => mockFirestore(),
      auth: () => ({ verifyIdToken: async () => ({ uid: mockUid }) }),
    }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
        // Recognized by the document double above, which removes the field
        // rather than storing this marker.
        delete: () => ({ __delete: true }),
      },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  // Nobody in these fixtures has left a topic, so the send's third filter is
  // a pass-through. Modeled rather than omitted: an absent export reads as
  // `undefined` and fails the send with a TypeError, which is a red that says
  // nothing about the behavior under test.
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails,
  // Nobody in this file is suppressed; document ids are what is under test.
  filterSendableForHost: async (_hostId: string, emails: string[]) => emails,
  // Starter, so the monthly campaign cap does not refuse before the write.
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
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
    sent.push(message)
    return { sent: true }
  },
}))

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { campaignSendHandler, performCampaignSend } from './campaign-send'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOST = 'host-1'

/**
 * A running email experiment whose assignment is DETERMINISTIC.
 *
 * `assignExperimentVariant` buckets on a hash of the recipient address, and a
 * winner cannot be used to force it here because the exposure write only runs
 * while the experiment is still `running`. Weighting the second variant to
 * zero is the realistic lever — a merchant who paused an arm — and leaves a
 * total weight of 1, so every recipient lands in the first.
 */
const experimentDoc = (variantId: string) => ({
  name: 'Subject test',
  status: 'running',
  target: 'email',
  variants: [
    { id: variantId, subject: 'A', weight: 1 },
    { id: 'other-variant', subject: 'B', weight: 0 },
  ],
})

function seed() {
  store.clear()
  sent.length = 0
  mockUid = 'uid-1'
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
  })
  store.set(`hosts/${HOST}/leads/lead-1`, {
    email: 'dana@example.com',
    name: 'Dana Reed',
    // A recorded opt-in, in the shape every capture path writes it. The send
    // withholds a recipient with no basis and refuses an audience where
    // nobody has one, so a lead this suite expects to reach has to declare it
    // — a send id can only be asserted on a send that happened.
    // The basis belongs to the site sending, not to the org.
    marketingConsentByHost: {
      'host-1': { marketingConsent: true, marketingConsentAtMs: Date.UTC(2026, 7, 1) },
    },
  })
}

/**
 * Every campaign document path in the store, at any depth.
 *
 * Deliberately not narrowed to the campaign document itself: the whole point
 * is to catch a write that landed somewhere UNDER a campaign id that was
 * really a path, and a filter that only looked one level down would report an
 * empty list for exactly the bug this file exists to hold.
 *
 * So a send's own subcollection documents appear here too, and the
 * expectations below name them. `reports/reached` is the record of who a send
 * delivered to, which a later send subtracts so nobody is mailed twice.
 */
function campaignPaths(): string[] {
  return [...store.keys()].filter((key) => key.includes('/campaigns/')).sort()
}

/** The paths one ordinary send leaves behind, in `campaignPaths()` order. */
const sendPaths = (campaignId: string) => [
  `hosts/${HOST}/campaigns/${campaignId}`,
  `hosts/${HOST}/campaigns/${campaignId}/reports/reached`,
]

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
      // unused
    },
    redirect() {
      // unused
    },
    end() {
      // unused
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

const send = (options: Record<string, unknown> = {}) =>
  performCampaignSend({
    hostId: HOST,
    subject: 'Spring sale',
    body: 'Ends Sunday',
    audience: 'leads',
    senderUid: 'uid-1',
    ...options,
  } as any)

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

beforeEach(seed)

// ---------------------------------------------------------------------------
// The defect: a campaign filed where the merchant cannot see it
// ---------------------------------------------------------------------------

describe('a campaignId that names a path rather than an id', () => {
  it('files no campaign at a caller-chosen nesting', async () => {
    await expect(send({ campaignId: 'a/b/c' })).rejects.toThrow(
      /Invalid campaignId/,
    )

    // `hosts/{h}/campaigns/a/b/c` is a legal document path, so this used to
    // write the campaign beneath a document that does not exist — invisible to
    // the merchant's own campaigns list, which resolves the parent first.
    expect(campaignPaths()).toEqual([])
  })

  it('refuses BEFORE a single email goes out', async () => {
    // The ordering is the point. Refusing after the send would strand real
    // delivered mail with no record of it anywhere — AGL-1760's test failed
    // rather than passed.
    await expect(send({ campaignId: 'a/b/c' })).rejects.toThrow()

    expect(sent).toEqual([])
  })

  it('refuses an even-component id rather than throwing out of `.doc()`', async () => {
    await expect(send({ campaignId: 'half/path' })).rejects.toThrow(
      /Invalid campaignId/,
    )
    expect(campaignPaths()).toEqual([])
  })

  it.each([
    ['a reserved id', '__missing__'],
    ['self', '.'],
    ['parent', '..'],
    ['an oversized id', 'x'.repeat(1501)],
  ])('refuses %s', async (_label, campaignId) => {
    await expect(send({ campaignId })).rejects.toThrow(/Invalid campaignId/)
    expect(campaignPaths()).toEqual([])
  })

  it('names the id that was wrong, not the last one checked', async () => {
    await expect(send({ experimentId: 'a/b/c' })).rejects.toThrow(
      /Invalid experimentId/,
    )
    await expect(
      send({ segmentId: 'a/b/c', audience: 'segment' }),
    ).rejects.toThrow(/Invalid segmentId/)
  })
})

describe('the schedule branch, which writes without going through the send core', () => {
  it('stores no scheduled campaign at a caller-chosen nesting', async () => {
    const result = await post({
      hostId: HOST,
      action: 'schedule',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      campaignId: 'a/b/c',
      sendAtMs: Date.now() + 60_000,
    })

    // Worse than the send path: the scheduled-campaign processor finds this by
    // `collectionGroup` and sends it, from a document the merchant can neither
    // see in their list nor cancel.
    expect(result.status).toBe(400)
    expect(campaignPaths()).toEqual([])
  })

  it('answers 400 rather than 500 when cancel carries no campaignId', async () => {
    // The ref used to be built ABOVE the `campaignId ?` guard, so `.doc('')`
    // threw where the code intended a plain refusal.
    const result = await post({ hostId: HOST, action: 'cancel' })

    expect(result.status).toBe(400)
    expect(result.body).toEqual({ error: 'Not a scheduled campaign' })
  })

  it('answers 400 for a cancel naming a path', async () => {
    const result = await post({
      hostId: HOST,
      action: 'cancel',
      campaignId: 'a/b/c',
    })

    expect(result.status).toBe(400)
    expect(campaignPaths()).toEqual([])
  })
})

describe('a merchant-authored variant id', () => {
  it('writes no exposure document for a variant id that names a path', async () => {
    // `validateExperiment` checks variant ids are UNIQUE and nothing about
    // their SHAPE — the same third instance `d51e23df4` found on the
    // conversion write, here on the exposure write that pairs with it.
    store.set(`hosts/${HOST}/experiments/exp-1`, experimentDoc('a/b/c'))

    const result = await send({ experimentId: 'exp-1' })

    expect([...store.keys()].filter((key) => key.includes('/stats/'))).toEqual(
      [],
    )
    // The refusal must not cost the send: the emails really went out.
    expect(result.sent).toBe(1)
    expect(campaignPaths()).toEqual(sendPaths(result.campaignId))
  })
})

// ---------------------------------------------------------------------------
// The behaviour the refusal must not have been bought with
// ---------------------------------------------------------------------------

describe('the ordinary campaign still sends', () => {
  // Guards, not fixes: each passes before and after.
  it('files a campaign the merchant chose an ordinary id for', async () => {
    const result = await send({ campaignId: 'spring-2026' })

    expect(result.sent).toBe(1)
    expect(campaignPaths()).toEqual(sendPaths('spring-2026'))
    expect(store.get(`hosts/${HOST}/campaigns/spring-2026`)).toMatchObject({
      subject: 'Spring sale',
      status: 'sent',
    })
  })

  it('mints an id when the caller supplies none', async () => {
    const result = await send()

    expect(campaignPaths()).toEqual(sendPaths(result.campaignId))
  })

  it('records exposures for a well-formed variant id', async () => {
    store.set(`hosts/${HOST}/experiments/exp-1`, experimentDoc('variant-a'))

    await send({ experimentId: 'exp-1' })

    const stats = [...store.keys()].filter((key) => key.includes('/stats/'))
    expect(stats).toEqual([`hosts/${HOST}/experiments/exp-1/stats/variant-a`])
  })

  it('schedules a campaign with an ordinary id', async () => {
    const result = await post({
      hostId: HOST,
      action: 'schedule',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      campaignId: 'spring-2026',
      sendAtMs: Date.now() + 60_000,
    })

    expect(result.status).toBe(200)
    expect(store.get(`hosts/${HOST}/campaigns/spring-2026`)).toMatchObject({
      status: 'scheduled',
    })
  })

  it('still requires a site admin before any of this', async () => {
    mockUid = 'someone-else'
    const result = await post({
      hostId: HOST,
      action: 'schedule',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      campaignId: 'spring-2026',
      sendAtMs: Date.now() + 60_000,
    })

    expect(result.status).toBe(403)
    expect(campaignPaths()).toEqual([])
  })
})

/*==========================================
 * AN EMAIL THAT EXISTS BEFORE IT IS SENT.
 *
 * A draft is a state on the send record, not a document elsewhere, and the id
 * is the reason: `performCampaignSend` adopts a `campaignId` it is given, so
 * a draft becomes the sent email AT ITS OWN ID. That is what keeps
 * `/marketing/campaigns/{sendId}` resolving from the moment the email is
 * created, and what keeps the `cid=` inside every delivered unsubscribe HMAC
 * pointing at the record it was minted for.
 *
 * The properties held below are the ones that make it safe: it costs nothing
 * to exist, it cannot escape on its own, and it cannot be used to rewrite an
 * email that has already gone out.
 *=========================================*/

describe('creating a draft', () => {
  it('writes ONE document and mails nothing', async () => {
    const result = await post({
      hostId: HOST,
      action: 'draft',
      displayName: 'The discount one',
    })

    expect(result.status).toBe(200)
    expect(result.body.status).toBe('draft')
    // Nothing was mailed. A draft that sent anything would be a send nobody
    // asked for, taken at create time.
    expect(sent).toHaveLength(0)
    const stored = store.get(
      `hosts/${HOST}/campaigns/${result.body.campaignId}`,
    )
    expect(stored?.['status']).toBe('draft')
    expect(stored?.['displayName']).toBe('The discount one')
  })

  it('needs neither a subject nor a body', async () => {
    /*
     * A draft is an email that has not been written yet. Requiring copy of it
     * would mean there is no way to create one, which is the whole state.
     */
    const result = await post({ hostId: HOST, action: 'draft' })
    expect(result.status).toBe(200)
  })

  it('leaves NO reach record, so it has no account of reaching anybody', async () => {
    const result = await post({ hostId: HOST, action: 'draft' })

    expect(campaignPaths()).toEqual([
      `hosts/${HOST}/campaigns/${result.body.campaignId}`,
    ])
    // Specifically not `reports/reached`, which an ordinary send leaves and
    // which is what a follow-up subtracts from.
    expect(store.has(
      `hosts/${HOST}/campaigns/${result.body.campaignId}/reports/reached`,
    )).toBe(false)
  })

  it('records no stats, so no surface can read it as a send that reached nobody', async () => {
    const result = await post({ hostId: HOST, action: 'draft' })
    const stored = store.get(
      `hosts/${HOST}/campaigns/${result.body.campaignId}`,
    )
    // An absent `stats` is what lets the report surfaces withhold the figures
    // instead of dividing into zero and publishing a 0% delivery rate.
    expect(stored?.['stats']).toBeUndefined()
    expect(stored?.['sentAt']).toBeUndefined()
  })

  it('refuses a campaignId that names a path rather than an id', async () => {
    // The same guard the schedule branch carries: a draft filed under
    // `a/b/c` is a document the merchant can neither see nor cancel.
    const result = await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'a/b/c',
    })
    expect(result.status).toBe(400)
    expect(campaignPaths()).toEqual([])
  })
})

describe('a draft is not follow-up-able', () => {
  it('refuses a follow-up on a draft, and says why', async () => {
    /*
     * `campaignReachCovers` would refuse it anyway for want of a reach
     * record, but the status check comes first and gives the honest reason:
     * nothing has gone out, so there is nobody to add.
     */
    // FULLY written, so the refusal is about the state rather than about
    // there being nothing to mail — an empty draft is refused either way, and
    // would pass this test without the status check existing at all.
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })

    const result = await post({
      hostId: HOST,
      action: 'followUp',
      campaignId: 'draft-1',
    })

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toMatch(/already been sent/i)
    expect(sent).toHaveLength(0)
  })
})

describe('sending a draft turns THAT document into the sent email', () => {
  it('keeps the id, so the report URL and the cid never move', async () => {
    /*==========================================
     * THE PROPERTY THE WHOLE MODEL RESTS ON.
     *
     * Every delivered unsubscribe footer carries `cid=<sendId>` inside its
     * HMAC. A draft copied to a new id at send time would mean the URL a
     * merchant had open stops being the email's URL, and the `cid` names a
     * document that is not the send.
     *=========================================*/
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })

    const result = await post({
      hostId: HOST,
      action: 'sendNow',
      campaignId: 'draft-1',
    })

    expect(result.status).toBe(200)
    expect(result.body.campaignId).toBe('draft-1')
    expect(store.get(`hosts/${HOST}/campaigns/draft-1`)?.['status']).toBe(
      'sent',
    )
    // No second document anywhere under campaigns.
    expect(campaignPaths()).toEqual(sendPaths('draft-1'))
  })

  it('mails the copy from the RECORD, never from the request', async () => {
    /*
     * `sendNow` addresses an existing document by id. A caller who could also
     * supply the copy could put arbitrary text on somebody else's send id,
     * keep its `cid` and its report, and mail it.
     */
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      subject: 'The real subject',
      body: 'The real body',
      audience: 'leads',
    })

    await post({
      hostId: HOST,
      action: 'sendNow',
      campaignId: 'draft-1',
      subject: 'Injected subject',
      body: 'Injected body',
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]['subject']).toBe('The real subject')
    expect(String(sent[0]['text'] ?? sent[0]['html'])).toContain(
      'The real body',
    )
  })

  it('records who it reached, so a later follow-up can subtract them', async () => {
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })
    await post({ hostId: HOST, action: 'sendNow', campaignId: 'draft-1' })

    expect(
      store.has(`hosts/${HOST}/campaigns/draft-1/reports/reached`),
    ).toBe(true)
  })
})

describe('send-now is refused on everything that has gone out', () => {
  it('refuses a SENT email and points at the follow-up instead', async () => {
    /*
     * Sending it would mail the whole audience a second copy. Reaching the
     * people it has not is what `followUp` does, minus everyone already
     * reached.
     */
    await send({ campaignId: 'msg-1' })

    const result = await post({
      hostId: HOST,
      action: 'sendNow',
      campaignId: 'msg-1',
    })

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toMatch(/already been sent/i)
  })

  it('refuses a CANCELED email rather than resurrecting it', async () => {
    await post({
      hostId: HOST,
      action: 'schedule',
      campaignId: 'msg-1',
      sendAtMs: Date.now() + 60_000,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })
    await post({ hostId: HOST, action: 'cancel', campaignId: 'msg-1' })

    const result = await post({
      hostId: HOST,
      action: 'sendNow',
      campaignId: 'msg-1',
    })

    expect(result.status).toBe(400)
    expect(sent).toHaveLength(0)
  })

  /*==========================================
   * A CAMPAIGN BETWEEN BATCHES IS `scheduled`, AND MUST NOT RESTART.
   *
   * An audience larger than one send goes out over several runs, and between
   * them the email is written back as `scheduled` — the state the processor
   * claims to continue it. That is exactly the state `sendNow` admits, and
   * this branch does not pass `continuation`: the whole audience would be
   * resolved again with nobody subtracted, and everyone the earlier batches
   * reached would receive a second copy under the same `cid` whose
   * unsubscribe links are already in their inboxes.
   *=========================================*/
  it('refuses an email that is part way through its audience', async () => {
    await post({
      hostId: HOST,
      action: 'schedule',
      campaignId: 'msg-1',
      sendAtMs: Date.now() + 60_000,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })
    // What a batch writes back when it leaves people unaddressed.
    store.set(`hosts/${HOST}/campaigns/msg-1`, {
      ...(store.get(`hosts/${HOST}/campaigns/msg-1`) ?? {}),
      stats: { sent: 500, audienceSize: 3000 },
      resume: { remaining: 2500, batch: 1, nextAtMs: Date.now() + 60_000 },
    })

    const result = await post({
      hostId: HOST,
      action: 'sendNow',
      campaignId: 'msg-1',
    })

    expect(result.status).toBe(409)
    expect(String(result.body.error)).toMatch(/second copy/i)
    expect(sent).toHaveLength(0)
    // And it is left claimable by the processor rather than parked in the
    // `sending` state this branch takes before it mails.
    expect(store.get(`hosts/${HOST}/campaigns/msg-1`)?.['status']).toBe(
      'scheduled',
    )
  })

  it('sends a SCHEDULED email ahead of its time', async () => {
    // The control for the two refusals above. A branch that refused
    // everything would pass both having deleted the feature.
    await post({
      hostId: HOST,
      action: 'schedule',
      campaignId: 'msg-1',
      sendAtMs: Date.now() + 60_000,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })

    const result = await post({
      hostId: HOST,
      action: 'sendNow',
      campaignId: 'msg-1',
    })

    expect(result.status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(store.get(`hosts/${HOST}/campaigns/msg-1`)?.['status']).toBe('sent')
  })
})

/*==========================================
 * EVERY WRITER STAMPS A CREATION DATE, AND ONLY WHEN IT CREATES.
 *
 * It is the one date on every email, which neither `sentAt` nor `sendAtMs`
 * is: each is written by one branch of the send path and neither is on both
 * kinds, and a DRAFT carries neither. Without it the emails list gives every
 * draft the sort key 0 and files the email a merchant is in the middle of
 * writing below mail sent years ago.
 *
 * The second half matters as much as the first. Every branch here addresses
 * an existing document by id, so a stamp written unconditionally would walk
 * an email's creation date forward on every draft save and every re-send —
 * and the list orders on exactly that field.
 *=========================================*/
describe('when an email says it was created', () => {
  const created = (id: string) =>
    store.get(`hosts/${HOST}/campaigns/${id}`)?.['createdAtMs']

  /*
   * THE CLOCK MOVES BETWEEN CALLS, and it has to be made to.
   *
   * Every write here happens inside one test, in the same millisecond, so a
   * stamp written on every save is byte-identical to one written only on the
   * create — and the assertion that the date does not move would pass for
   * code that moves it. A clock that advances a minute per reading is what
   * makes "unchanged" mean something.
   */
  let clock = 0
  let realNow: typeof Date.now
  beforeEach(() => {
    clock = Date.UTC(2026, 7, 1)
    realNow = Date.now
    Date.now = () => {
      clock += 60_000
      return clock
    }
  })
  afterEach(() => {
    Date.now = realNow
  })

  it('stamps a draft when it is minted', async () => {
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      displayName: 'Half-written',
      audience: 'leads',
    })
    expect(created('draft-1')).toBeGreaterThan(Date.UTC(2026, 7, 1))
  })

  it('does NOT move it when the same draft is saved again', async () => {
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      displayName: 'Half-written',
      audience: 'leads',
    })
    const first = created('draft-1')

    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      subject: 'Getting there',
      body: 'Some copy',
      audience: 'leads',
    })

    // THE CONTROL for the clock itself: it really has advanced, so the
    // assertion below is about the write and not about a frozen timer.
    expect(Date.now()).toBeGreaterThan(Number(first))
    expect(created('draft-1')).toBe(first)
  })

  it('does not move it when a draft is scheduled, then sent', async () => {
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'msg-1',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })
    const first = created('msg-1')

    await post({
      hostId: HOST,
      action: 'schedule',
      campaignId: 'msg-1',
      sendAtMs: Date.now() + 60_000,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })
    expect(created('msg-1')).toBe(first)

    await post({ hostId: HOST, action: 'sendNow', campaignId: 'msg-1' })
    expect(created('msg-1')).toBe(first)
  })

  it('stamps an email sent immediately, which was never a draft', async () => {
    const result = await post({
      hostId: HOST,
      action: 'send',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })
    expect(result.status).toBe(200)
    expect(created(String(result.body.campaignId))).toBeGreaterThan(
      Date.UTC(2026, 7, 1),
    )
  })
})

describe('what a sent email says was delivered cannot be rewritten', () => {
  it('refuses to schedule over an email that has already gone out', async () => {
    /*==========================================
     * THE GUARD THAT MAKES `schedule` SAFE TO GIVE A campaignId.
     *
     * The branch addresses an existing document by id and merges into it.
     * Ungated, that merges a new subject and body onto a send that went out
     * months ago and sets its status back to `scheduled` — rewriting the
     * record of what was delivered, and handing the processor a message to
     * mail a second time under a `cid` whose unsubscribe links are already in
     * inboxes.
     *=========================================*/
    await send({ campaignId: 'msg-1' })

    const result = await post({
      hostId: HOST,
      action: 'schedule',
      campaignId: 'msg-1',
      sendAtMs: Date.now() + 60_000,
      subject: 'Rewritten subject',
      body: 'Rewritten body',
      audience: 'leads',
    })

    expect(result.status).toBe(409)
    const stored = store.get(`hosts/${HOST}/campaigns/msg-1`)
    expect(stored?.['status']).toBe('sent')
    expect(stored?.['subject']).toBe('Spring sale')
  })

  it('refuses to draft over an email that has already gone out', async () => {
    await send({ campaignId: 'msg-1' })

    const result = await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'msg-1',
      subject: 'Rewritten subject',
      body: 'Rewritten body',
      audience: 'leads',
    })

    expect(result.status).toBe(409)
    const stored = store.get(`hosts/${HOST}/campaigns/msg-1`)
    expect(stored?.['status']).toBe('sent')
    expect(stored?.['subject']).toBe('Spring sale')
  })

  it('DOES let a draft be rewritten', async () => {
    // The control. A guard that refused every write would pass both refusals
    // above having made drafts uneditable.
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      subject: 'First attempt',
      body: 'Draft body',
      audience: 'leads',
    })

    const result = await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      subject: 'Second attempt',
      body: 'Draft body',
      audience: 'leads',
    })

    expect(result.status).toBe(200)
    expect(store.get(`hosts/${HOST}/campaigns/draft-1`)?.['subject']).toBe(
      'Second attempt',
    )
  })

  it('changes ONLY the name on a sent email, and nothing else', async () => {
    /*
     * The one field a sent email still owns. It is console-only text that
     * reached no recipient and no header, so correcting it contradicts no
     * delivered mail — and the branch writes that field alone, so a request
     * carrying copy cannot smuggle any of it onto the record.
     */
    await send({ campaignId: 'msg-1' })

    const result = await post({
      hostId: HOST,
      action: 'update',
      campaignId: 'msg-1',
      displayName: 'The discount one',
      subject: 'Injected subject',
      body: 'Injected body',
      audience: 'members',
      topicId: 'injected-topic',
    })

    expect(result.status).toBe(200)
    const stored = store.get(`hosts/${HOST}/campaigns/msg-1`)
    expect(stored?.['displayName']).toBe('The discount one')
    // Every field that describes the mail is untouched.
    expect(stored?.['subject']).toBe('Spring sale')
    expect(stored?.['body']).toBe('Ends Sunday')
    expect(stored?.['audience']).toBe('leads')
    expect(stored?.['status']).toBe('sent')
  })

  it('refuses to name an email that does not exist', async () => {
    const result = await post({
      hostId: HOST,
      action: 'update',
      campaignId: 'never-existed',
      displayName: 'Nope',
    })
    expect(result.status).toBe(404)
    expect(campaignPaths()).toEqual([])
  })
})

describe('rescheduling and unscheduling', () => {
  it('moves a scheduled email to a new time', async () => {
    const first = Date.now() + 60_000
    const second = Date.now() + 120_000
    await post({
      hostId: HOST,
      action: 'schedule',
      campaignId: 'msg-1',
      sendAtMs: first,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })

    const result = await post({
      hostId: HOST,
      action: 'schedule',
      campaignId: 'msg-1',
      sendAtMs: second,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })

    expect(result.status).toBe(200)
    expect(store.get(`hosts/${HOST}/campaigns/msg-1`)?.['sendAtMs']).toBe(
      second,
    )
  })

  it('CLEARS the send time when a scheduled email is saved back to a draft', async () => {
    /*
     * `merge: true` leaves every field the write does not name, so a
     * `sendAtMs` left standing would sit on a draft as a due date nothing
     * acts on — and the emails list orders on exactly that field.
     */
    await post({
      hostId: HOST,
      action: 'schedule',
      campaignId: 'msg-1',
      sendAtMs: Date.now() + 60_000,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })

    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'msg-1',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })

    const stored = store.get(`hosts/${HOST}/campaigns/msg-1`)
    expect(stored?.['status']).toBe('draft')
    expect(stored?.['sendAtMs']).toBeUndefined()
  })
})

describe('an immediate send may name an email, but only an unsent one', () => {
  /*==========================================
   * THE DEFAULT BRANCH TAKES ITS COPY FROM THE REQUEST.
   *
   * That is what the composer needs — it is sending the message being typed
   * — but the branch also accepts a `campaignId`, and `performCampaignSend`
   * adopts it. Ungated, a request naming a send that already went out writes
   * new copy over the record of what was delivered, replaces its counters
   * with this send's own, and mails the whole audience a second copy under a
   * `cid` whose unsubscribe links are already in inboxes.
   *=========================================*/
  it('sends a draft named by id, and keeps that id', async () => {
    await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'draft-1',
      subject: 'Placeholder',
      body: 'Placeholder',
      audience: 'leads',
    })

    const result = await post({
      hostId: HOST,
      campaignId: 'draft-1',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })

    expect(result.status).toBe(200)
    expect(result.body.campaignId).toBe('draft-1')
    expect(store.get(`hosts/${HOST}/campaigns/draft-1`)?.['status']).toBe(
      'sent',
    )
    // The composer's copy is what went out — this branch is the one that
    // legitimately takes it from the request.
    expect(store.get(`hosts/${HOST}/campaigns/draft-1`)?.['subject']).toBe(
      'Spring sale',
    )
  })

  it('refuses to send over an email that has already gone out', async () => {
    await send({ campaignId: 'msg-1' })
    const before = store.get(`hosts/${HOST}/campaigns/msg-1`)?.['stats']

    const result = await post({
      hostId: HOST,
      campaignId: 'msg-1',
      subject: 'Injected subject',
      body: 'Injected body',
      audience: 'leads',
    })

    expect(result.status).toBe(409)
    // The record still says what it said, and nothing was mailed a second
    // time.
    const after = store.get(`hosts/${HOST}/campaigns/msg-1`)
    expect(after?.['subject']).toBe('Spring sale')
    expect(after?.['stats']).toEqual(before)
    expect(sent).toHaveLength(1)
  })

  it('refuses to send over a canceled email', async () => {
    await post({
      hostId: HOST,
      action: 'schedule',
      campaignId: 'msg-1',
      sendAtMs: Date.now() + 60_000,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })
    await post({ hostId: HOST, action: 'cancel', campaignId: 'msg-1' })

    const result = await post({
      hostId: HOST,
      campaignId: 'msg-1',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })

    expect(result.status).toBe(409)
    expect(sent).toHaveLength(0)
  })

  it('still mints an id for a send that names none', async () => {
    // The control. A guard that refused every id-bearing send would pass the
    // two refusals above having broken the ordinary composer send.
    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
    })

    expect(result.status).toBe(200)
    expect(String(result.body.campaignId)).toBeTruthy()
    expect(sent).toHaveLength(1)
  })
})

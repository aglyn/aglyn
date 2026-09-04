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
 * WHICH OF A SITE'S SENDERS AN EMAIL ACTUALLY LEAVES ON.
 *
 * A site holds several senders and the composer picks one. There is exactly
 * one way for that feature to be worthless, and it is the reason this file
 * exists: the picker renders, the merchant chooses, and the send resolves the
 * site's default regardless. Nothing on any screen would say so — the composer
 * would show the chosen address, the send would report success, and the first
 * people to notice would be the recipients.
 *
 * So every assertion here is made against what `sendEmail` was CALLED WITH and
 * what the campaign record STAMPED, never against the picker or the request.
 * And each of them is paired with a control that fails if the choice were
 * dropped: `sendsAsDefault` names the address a send would leave on if
 * `senderId` reached nothing, and it is asserted absent wherever a non-default
 * sender was chosen.
 *
 * The Firestore double is `campaign-composer.spec.ts`'s, which models `.doc()`
 * path arithmetic and subcollections rather than treating a path as an opaque
 * key — the senders are a subcollection, so a double that flattened them could
 * not tell a read of the right one from a read of any.
 */

/*
 * Sentinels as hoisted FUNCTION declarations, not consts: a `jest.mock`
 * factory is hoisted above every binding in the file, and the object literal
 * below is built while a `const` would still be in its temporal dead zone.
 */
function increment(value: number) {
  return { __increment: value }
}
function arrayUnion(...values: string[]) {
  return { __arrayUnion: values }
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * `set(..., {merge: true})`, with the two sentinels resolved.
 *
 * `campaign-follow-up.spec.ts`'s helper, and needed here for the same reason:
 * the follow-up below reads the reach record the first send wrote, and a double
 * that kept `{__arrayUnion: [...]}` in the field would make the send look as
 * though it had recorded nobody — which the follow-up correctly refuses to
 * proceed from.
 */
/** The `FieldValue.delete()` marker, resolved by {@link mergeInto}. */
const DELETE_SENTINEL = '__delete__'

function mergeInto(
  existing: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const next = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE_SENTINEL) {
      /*
       * `FieldValue.delete()` REMOVES the field rather than storing a marker.
       * A double that kept the sentinel would leave a `templateScreenId` whose
       * value happens to be a string — which is exactly the leftover the
       * delete exists to clear, so the send would look one up and 400.
       */
      delete next[key]
    } else if (isPlainObject(value) && '__increment' in value) {
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

function collectionRef(path: string): any {
  return {
    doc: (id: string) => {
      if (id === '') {
        throw new Error(
          `Value for argument "documentPath" is not a valid resource path.`,
        )
      }
      return docRef(`${path}/${id}`)
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
        return {
          docs: ids.slice(0, max).map((id) => snapshotOf(`${path}/${id}`)),
        }
      },
    }),
  }
}

const mockFirestore = () => ({
  collection: (name: string) => collectionRef(name),
  /*
   * The claim `sendNow` takes before it mails a stored email, applied
   * straight through.
   *
   * Single-threaded on purpose: what a real transaction does under contention
   * is owned by the specs that model it, and pretending to here would only
   * pretend. What this file needs from it is that the claim SUCCEEDS, so the
   * send it guards actually runs.
   */
  runTransaction: async (body: (transaction: any) => Promise<any>) =>
    body({
      get: async (ref: any) => snapshotOf(ref.path),
      update: (ref: any, value: Record<string, any>) => {
        store.set(ref.path, mergeInto(store.get(ref.path) ?? {}, value))
      },
      set: (ref: any, value: Record<string, any>) => {
        store.set(ref.path, mergeInto(store.get(ref.path) ?? {}, value))
      },
    }),
})

/*
 * The leaf `firebase-admin`, so the REAL reach module runs.
 *
 * `email-campaign-reach.ts` is what the follow-up below reads its "who already
 * has this email" record from, and it reaches the admin SDK directly rather
 * than through the barrel doubled underneath. What it needs is two field
 * sentinels, supplied here so `mergeInto` can resolve them — without this, the
 * send would look as though it had recorded nobody and the follow-up would
 * correctly refuse to run.
 */
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => mockFirestore() }),
    firestore: {
      FieldValue: {
        increment,
        arrayUnion,
        serverTimestamp: () => 'server-timestamp',
        delete: () => DELETE_SENTINEL,
      },
    },
  },
}))

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
        verifyIdToken: async () => ({
          uid: 'uid-1',
          email: 'admin@example.com',
        }),
      }),
    }),
    firestore: {
      FieldValue: {
        increment,
        arrayUnion,
        serverTimestamp: () => 'server-timestamp',
        delete: () => DELETE_SENTINEL,
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
   * THE REAL RESOLUTION, with only the document reads behind it faked.
   *
   * `resolveSendingIdentity` decides the address, and it is the product's own
   * function — a stub returning a fixed string could not tell a send that read
   * the chosen sender's mailbox from one that read the site's default, which is
   * the single thing this file is about. `selectedLocalPart` is honored exactly
   * as the real reader honors it, so a caller that took the mailbox from the
   * wrong place gets the wrong address here too.
   */
  resolveHostSendingIdentity: async (options: {
    selectedDomain?: string
    selectedLocalPart?: string
  }) => {
    const asked = String(options?.selectedDomain ?? '')
    return jest
      .requireActual('@aglyn/shared-util-email')
      .resolveSendingIdentity({
        selection: asked
          ? {
              domain: asked,
              status: asked === 'acme.com' ? 'verified' : 'failed',
              localPart: String(options?.selectedLocalPart ?? 'hello'),
              missing: [],
            }
          : null,
        platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
      })
  },
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    mockFirestore().collection(`orgs/org-1/${name}`),
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
import { emailSentAs } from '@aglyn/shared-ui-email-campaigns/model/email-record'
import { campaignSendHandler } from './campaign-send'

const HOST = 'host-1'

/**
 * The address a send leaves on when the sender it named reached NOTHING.
 *
 * Written out rather than derived, because it is the control: every assertion
 * about a chosen sender also asserts this address is absent, and a control
 * computed from the same code under test would move with the bug.
 */
const SENDS_AS_DEFAULT = 'hello@acme.com'
const SENDS_AS_JAMIE = 'jamie@acme.com'

/**
 * A site with a verified domain, two senders, and `hello@` as the default.
 *
 * `defaultSenderId` and the three host fields agree, which is the state the
 * console route leaves behind: the host fields are the default sender's
 * projection, and they are what `resolveHostSendingIdentity` reads.
 */
function seed() {
  store.clear()
  sent.length = 0
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
    sendingDomain: 'acme.com',
    sendingLocalPart: 'hello',
    defaultSenderId: 'default',
  })
  store.set(`hosts/${HOST}/senders/default`, {
    localPart: 'hello',
    fromName: 'Acme',
    createdAtMs: 1,
  })
  store.set(`hosts/${HOST}/senders/sender-jamie`, {
    localPart: 'jamie',
    fromName: 'Jamie Lee',
    replyTo: 'jamie@acme-corp.com',
    createdAtMs: 2,
  })
  for (const [id, email] of [
    ['lead-1', 'dana@example.com'],
    ['lead-2', 'evan@example.com'],
    ['lead-3', 'faye@example.com'],
  ] as Array<[string, string]>) {
    store.set(`hosts/${HOST}/leads/${id}`, {
      email,
      name: 'Dana Reed',
      marketingConsentByHost: {
        [HOST]: {
          marketingConsent: true,
          marketingConsentAtMs: Date.UTC(2026, 7, 1),
        },
      },
    })
  }
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

/** Every address this run actually mailed from, de-duplicated. */
const addressesSent = () => [
  ...new Set(sent.map((message) => String(message['sendingIdentity']?.from))),
]

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

describe('an email goes out as the sender it names', () => {
  /**
   * THE WHOLE POINT, AND ITS CONTROL.
   *
   * Two senders are configured, the email names the one that is NOT the
   * default, and the assertion is on the address every message actually left
   * on. The second half is what makes it worth having: if `senderId` were
   * ignored — dropped in the route, never read by the send, or read and then
   * overwritten by the host's projection — every message would leave on
   * `hello@acme.com`, the send would still report success, and only this line
   * would fail.
   */
  it('mails from the chosen sender, not from the default', async () => {
    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
      senderId: 'sender-jamie',
    })

    expect(result.status).toBe(200)
    expect(result.body.sent).toBe(3)
    expect(addressesSent()).toEqual([SENDS_AS_JAMIE])
    // The control. Nothing left on the default, which is where an ignored
    // choice would have put all three.
    expect(addressesSent()).not.toContain(SENDS_AS_DEFAULT)
  })

  /**
   * The other half of the control, so the assertion above cannot pass by the
   * fixture happening to resolve `jamie@` for every send.
   */
  it('mails from the default when the email names no sender', async () => {
    await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
    })

    expect(addressesSent()).toEqual([SENDS_AS_DEFAULT])
    expect(addressesSent()).not.toContain(SENDS_AS_JAMIE)
  })

  /**
   * THE REPORT SHOWS THE ADDRESS THAT ACTUALLY LEFT.
   *
   * Read back through `emailSentAs`, which is the function the email's own
   * page renders the stamp with — so this asserts what a merchant reads months
   * later rather than what the record happens to hold. The stamp is recorded
   * at send time and never re-resolved, which is why it stays right after the
   * site's default moves.
   */
  it('records the chosen address on the email, where the report reads it', async () => {
    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
      senderId: 'sender-jamie',
      fromName: 'Jamie Lee',
    })

    const record = store.get(`hosts/${HOST}/campaigns/${result.body.campaignId}`)
    const reported = emailSentAs(record)

    expect(reported.recorded).toBe(true)
    expect(reported.from).toBe(SENDS_AS_JAMIE)
    expect(reported.from).not.toBe(SENDS_AS_DEFAULT)
    expect(reported.fromName).toBe('Jamie Lee')
    // And which sender was picked, beside the address it resolved to, so a
    // follow-up can re-send under the same one.
    expect(record?.['senderId']).toBe('sender-jamie')
  })
})

describe('a sender this site does not hold', () => {
  /**
   * REFUSED, NEVER DEFAULTED.
   *
   * The same class as the mailbox validation that used to answer `hello` to a
   * name it could not parse. Silently sending as the default would tell a
   * merchant their campaign went out as the sender they picked when it did
   * not — and unlike a refusal, nothing would ever say so.
   */
  it('refuses the send rather than falling back to the default', async () => {
    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
      senderId: 'sender-nobody',
    })

    expect(result.status).toBe(404)
    // Nothing mailed, and nothing recorded — the refusal lands above the first
    // write, so no campaign document is left behind either.
    expect(sent).toHaveLength(0)
    expect([...store.keys()].some((key) => key.includes('/campaigns/'))).toBe(
      false,
    )
  })

  /**
   * And it is refused at the COUNT, which is what the composer asks for as
   * soon as it mounts — so a draft pointing at a removed sender says so at the
   * picker rather than from the Send button.
   */
  it('refuses the preview too, so the composer learns before Send', async () => {
    const result = await post({
      hostId: HOST,
      action: 'preview',
      audience: 'leads',
      senderId: 'sender-nobody',
    })

    expect(result.status).toBe(404)
  })

  it('refuses an id that is not a document id at all', async () => {
    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
      senderId: 'senders/../hosts',
    })

    expect(result.status).toBe(400)
    expect(sent).toHaveLength(0)
  })
})

/**
 * NO BACKFILL: a site that has never written a sender still sends as the
 * identity it is configured with.
 *
 * The regression this guards is the one that would have needed a migration.
 * Every existing site has `sendingLocalPart` on its host document and no
 * `senders` subcollection at all, so a send that resolved its mailbox from an
 * empty collection would put every one of them back on `hello@` — an address
 * their owners never chose, on the domain their recipients already know.
 */
describe('a site with no senders subcollection', () => {
  it('sends as its existing configured identity', async () => {
    store.delete(`hosts/${HOST}/senders/default`)
    store.delete(`hosts/${HOST}/senders/sender-jamie`)
    store.set(`hosts/${HOST}`, {
      subdomain: 'acme',
      memberRoles: { 'uid-1': 'admin' },
      sendingDomain: 'acme.com',
      // The site in the handoff: already sending as something other than the
      // platform default, with nothing in the collection to say so.
      sendingLocalPart: 'test',
    })

    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
    })

    expect(result.status).toBe(200)
    expect(addressesSent()).toEqual(['test@acme.com'])
    expect(addressesSent()).not.toContain(SENDS_AS_DEFAULT)
  })
})

/**
 * A FOLLOW-UP REACHES THE REST OF THE AUDIENCE FROM THE SAME ADDRESS.
 *
 * One mailing split across two `From:` lines is what re-resolving the site's
 * current default would produce, and the people who got the second half would
 * see a sender the first half never used.
 */
describe('sending to more recipients later', () => {
  it('re-sends under the sender the email went out as, not the site’s current default', async () => {
    const first = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
      senderId: 'sender-jamie',
    })
    expect(first.body.sent).toBe(3)

    // The site's default moves, and a fourth person joins the audience.
    store.set(`hosts/${HOST}`, {
      ...(store.get(`hosts/${HOST}`) ?? {}),
      sendingLocalPart: 'news',
    })
    store.set(`hosts/${HOST}/leads/lead-4`, {
      email: 'gwen@example.com',
      name: 'Gwen Ali',
      marketingConsentByHost: {
        [HOST]: {
          marketingConsent: true,
          marketingConsentAtMs: Date.UTC(2026, 7, 1),
        },
      },
    })
    sent.length = 0

    const followUp = await post({
      hostId: HOST,
      action: 'followUp',
      campaignId: first.body.campaignId,
    })

    expect(followUp.status).toBe(200)
    expect(followUp.body.sent).toBe(1)
    expect(addressesSent()).toEqual([SENDS_AS_JAMIE])
    // The controls: neither the site's old default nor its new one.
    expect(addressesSent()).not.toContain(SENDS_AS_DEFAULT)
    expect(addressesSent()).not.toContain('news@acme.com')
  })
})

/**
 * A DRAFT KEEPS THE SENDER IT WAS COMPOSED WITH.
 *
 * `sendNow` mails a stored email and reads every field off the record, so a
 * sender that was not stored is a scheduled campaign that quietly reverts to
 * the default between being written and being sent.
 */
describe('a stored email', () => {
  it('mails from the sender it was saved with', async () => {
    const saved = await post({
      hostId: HOST,
      action: 'draft',
      campaignId: 'email-1',
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
      senderId: 'sender-jamie',
    })
    expect(saved.status).toBe(200)
    expect(store.get(`hosts/${HOST}/campaigns/email-1`)?.['senderId']).toBe(
      'sender-jamie',
    )

    const result = await post({
      hostId: HOST,
      action: 'sendNow',
      campaignId: 'email-1',
    })

    expect(result.status).toBe(200)
    expect(addressesSent()).toEqual([SENDS_AS_JAMIE])
    expect(addressesSent()).not.toContain(SENDS_AS_DEFAULT)
  })
})

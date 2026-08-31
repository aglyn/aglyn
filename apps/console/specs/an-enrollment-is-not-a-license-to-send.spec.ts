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
 * PASSING A CHECK ONCE DOES NOT LICENSE EVERY LATER SEND.
 *
 * An address can be enrolled on a Monday and hard-bounce on a Tuesday. If the
 * only suppression check were the one at enrollment, the membership written on
 * Monday would authorize every campaign that list ever carries — a check that
 * passes once and pays out forever, which is the laundered-quota shape.
 *
 * So the two acts are asserted END TO END, across the two features that own
 * them, because neither file can prove this alone: the Inbox knows what it
 * wrote and nothing about the send, and the campaign sender knows nothing
 * about how its audience got there.
 *
 * WHAT THE DOUBLES MODEL, stated so a false green is visible:
 *
 *  1. `enrollListMember` is REAL, reached by its deep path. It owns the member
 *     document id and the refusal backstop, so a double would make every claim
 *     below a claim about the double.
 *  2. `inboxAssignListHandler` and `performCampaignSend` are both REAL. The
 *     point of the file is that these two, wired to one mockStore, behave
 *     correctly together — a test that called a helper twice would prove the
 *     helper is deterministic and nothing about either route.
 *  3. `filterSendableForHost` is a double implementing BOTH lists exactly as
 *     the real helper does. `email-suppression.spec.ts` owns whether the
 *     helper is right; what this file certifies is that the SENDER goes
 *     through it — remove the call from `campaign-send.ts` and the assertions
 *     below deliver to somebody this file expects to be spared.
 *  4. `sendEmail` is a spy. Delivery is read off what reached the wire.
 */

const mockSentMessages: Array<Record<string, any>> = []
let mockStore: Record<string, Record<string, any>> = {}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    delete: () => ({ __delete: true }),
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockSentMessages.push(message)
    return { sent: true, id: `msg-${mockSentMessages.length}` }
  },
}))

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'
const LIST_ID = 'list-1'
const LIST_PATH = `orgs/${ORG_ID}/lists/${LIST_ID}`
const MEMBERS_PATH = `${LIST_PATH}/members`
const SUBMISSION_PATH = `hosts/${HOST_ID}/formSubmissions/sub-1`
const SENDER = 'priya@lumen.co'
const OTHER = 'sam@lumen.co'

const mockSnapshotFor = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get exists() {
    return mockStore[path] !== undefined
  },
  get: (field: string) => mockStore[path]?.[field],
  data: () => mockStore[path],
  get ref() {
    return mockDocHandle(path)
  },
})

const mockDocHandle = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get firestore() {
    return mockFirestoreHandle
  },
  get: async () => mockSnapshotFor(path),
  set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
    mockStore[path] = { ...(options?.merge ? (mockStore[path] ?? {}) : {}), ...data }
  },
  update: async (data: Record<string, any>) => {
    mockStore[path] = { ...(mockStore[path] ?? {}), ...data }
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

/** Ids directly under `path`, in the `__name__` order every sweep asks for. */
const mockChildIds = (path: string) =>
  Object.keys(mockStore)
    .filter(
      (key) =>
        key.startsWith(`${path}/`) &&
        !key.slice(path.length + 1).includes('/'),
    )
    .map((key) => key.slice(path.length + 1))
    .sort()

let mockAutoId = 0

const mockCollectionHandle = (path: string): any => {
  const build = (
    filters: Array<[string, unknown]>,
    after: string | null,
    cap: number | null,
  ): any => ({
    doc: (id: string) => mockDocHandle(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) =>
      build([...filters, [field, value]], after, cap),
    orderBy: () => build(filters, after, cap),
    startAfter: (cursor: any) =>
      build(filters, cursor?.id ?? String(cursor), cap),
    // `limit` HONORS its argument: a double that returned everything cannot
    // fail the way the real query does when a sweep never advances its cursor.
    limit: (value: number) => build(filters, after, value),
    get: async () => {
      const docs = mockChildIds(path)
        .filter((id) => !after || id > after)
        .map((id) => `${path}/${id}`)
        .filter((key) =>
          filters.every(([field, value]) => mockStore[key]?.[field] === value),
        )
        .slice(0, cap ?? Infinity)
        .map(mockSnapshotFor)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
    add: async (data: Record<string, any>) => {
      const id = `auto-${(mockAutoId += 1)}`
      mockStore[`${path}/${id}`] = data
      return { id }
    },
    get parent() {
      return mockDocHandle(path.split('/').slice(0, -1).join('/'))
    },
  })
  return build([], null, null)
}

const mockFirestoreHandle: any = {
  collection: (name: string) => mockCollectionHandle(name),
  getAll: async (...refs: any[]) => refs.map((ref) => mockSnapshotFor(ref.path)),
}

/** The suppression document id both lists key on: `sha256` of the address. */
const suppressionKey = (email: string) =>
  require('crypto')
    .createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex')

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The campaign-touch lookup, answering "no campaign".
   *
   * The double was missing it entirely, so the newsletter route threw on its
   * first line and the enrollment under test never ran. Answering null is the
   * honest default for a request carrying no touch, and it is what keeps this
   * file about enrollment rather than about attribution.
   */
  resolveCampaignTouch: async () => null,
  // The real resolution's shape: an org that declared no pooling resolves
  // every site to a group of ONE — the narrow answer, which is the direction
  // a wrong group may fail in.
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  // The literal three call sites compare against — the unsubscribe writes
  // it, the resubscribe link refuses to reverse anything else, and the
  // preference page reads it. A mock that omitted it would write `undefined`
  // and every one of those comparisons would silently stop matching.
  UNSUBSCRIBE_SUPPRESSION_REASON: 'unsubscribe',
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
  __esModule: true,
  enrollListMember: jest.requireActual(
    '@aglyn/tenant-data-admin/server/list-members',
  ).enrollListMember,
  emailSuppressionKey: (email: string) =>
    require('crypto')
      .createHash('sha256')
      .update(String(email).trim().toLowerCase())
      .digest('hex'),
  // The ENROLLMENT-time platform check, reading the same collection the
  // send-time filter below reads. One mockStore, so the two cannot disagree about
  // who is suppressed for reasons of the double's making.
  isEmailSuppressed: async (email: string) =>
    Boolean(
      mockStore[
        `emailSuppressions/${require('crypto')
          .createHash('sha256')
          .update(String(email).trim().toLowerCase())
          .digest('hex')}`
      ],
    ),
  // The SEND-time check. Both lists, as `filterSendableForHost` does.
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
      const key = require('crypto')
        .createHash('sha256')
        .update(String(email).trim().toLowerCase())
        .digest('hex')
      return (
        !mockStore[`emailSuppressions/${key}`] &&
        !mockStore[`hosts/${hostId}/suppressions/${key}`]
      )
    }),
  /*
   * No site here selects a custom sending domain, so every send resolves to
   * the platform identity — composed from the REAL `resolveSendingIdentity`,
   * as the marketing suites do, rather than a hand-written verdict shape this
   * file would have to keep in step.
   *
   * Absent, `performCampaignSend` threw before reaching the suppression filter
   * and every send-time assertion below failed on a TypeError — a red that
   * says nothing about who was mailed.
   */
  resolveHostSendingIdentity: async () =>
    jest
      .requireActual('@aglyn/shared-util-email')
      .resolveSendingIdentity({
        selection: null,
        platformFrom: process.env['USAGE_EMAIL_FROM'] || 'noreply@aglyn.com',
      }),
  getOrgForHost: async () => ({ orgId: ORG_ID, org: { plan: 'business' } }),
  resolveOrgMembership: async () => ({
    orgId: ORG_ID,
    member: { role: 'admin', allHosts: true },
  }),
  orgDataCollectionForHost: async () =>
    mockCollectionHandle(`orgs/${ORG_ID}/contacts`),
  orgDataQueryForHost: async () => ({
    ref: mockCollectionHandle(`orgs/${ORG_ID}/contacts`),
    query: mockCollectionHandle(`orgs/${ORG_ID}/contacts`),
  }),
  meterHostEmail: async () => undefined,
  // Permissive: the monthly cap and the hourly governor have their own files,
  // and one that refused here would make every assertion below a test of it.
  orgCampaignEmailSendsForMonth: async () => 0,
  reserveCampaignEmailSends: async ({ count }: any) => ({
    ok: true,
    reservation: { orgId: ORG_ID, month: '2026-08', reserved: count },
    used: 0,
    limit: 1_000_000,
  }),
  reconcileCampaignSendReservation: async () => undefined,
  readEmailSendRateConfig: async () => ({
    perHour: 1_000_000,
    enabled: true,
    updatedAtMs: null,
    updatedByEmail: null,
    note: '',
  }),
  readEmailSendRateWindow: async () => ({
    windowStartMs: 0,
    resetMs: 3_600_000,
    used: 0,
  }),
  /*
   * The hourly governor's claim, PERMISSIVE — for the same reason the monthly
   * cap above is: the rate limiter has its own file, and one that deferred
   * here would make every assertion below a test of it rather than of who was
   * suppressed. Matches the shape `campaign-send.ts` reads back.
   */
  claimOrgEmailSendBudget: async ({ count = 0 }: { count?: number } = {}) => ({
    allowed: true,
    used: 0,
    ceiling: 1_000_000,
    remaining: 1_000_000 - count,
    retryAtMs: 3_600_000,
    degraded: false,
  }),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'admin-uid',
          email: 'owner@lumen.co',
        }),
      }),
      firestore: () => mockFirestoreHandle,
    }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
      },
      FieldPath: { documentId: () => '__name__' },
    },
  },
}))

import { inboxAssignListHandler } from '@aglyn/plugins-inbox/server'
import { performCampaignSend } from '@aglyn/plugins-marketing/server/campaign-send'

/** Drives the real Inbox route the merchant's button posts to. */
async function addToList(body: Record<string, unknown> = {}) {
  const out: { code: number; body: any } = { code: 0, body: undefined }
  const res: any = {
    status(code: number) {
      out.code = code
      return res
    },
    json(payload: unknown) {
      out.body = payload
      return res
    },
  }
  await inboxAssignListHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {
        hostId: HOST_ID,
        submissionId: 'sub-1',
        listId: LIST_ID,
        ...body,
      },
    } as any,
    res,
  )
  return out
}

/** Drives the real campaign sender against the list they were added to. */
const sendCampaign = () =>
  performCampaignSend({
    hostId: HOST_ID,
    subject: 'Spring sale',
    body: 'plain text',
    audience: 'list',
    listId: LIST_ID,
    senderUid: 'admin-uid',
  } as any)

const reached = () => mockSentMessages.map((message) => String(message.to)).sort()

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

beforeEach(() => {
  mockStore = {}
  mockAutoId = 0
  mockSentMessages.length = 0
  mockStore[`hosts/${HOST_ID}`] = {
    subdomain: 'lumen',
    displayName: 'Lumen',
    memberRoles: { 'admin-uid': 'admin' },
  }
  mockStore[SUBMISSION_PATH] = { fields: { Email: SENDER, Message: 'hello' } }
  mockStore[LIST_PATH] = { name: 'Newsletter' }
  /*
   * A second member with a real opt-in, so a campaign that reaches nobody
   * throws "the audience is empty" instead — which would pass an assertion
   * about the first person not being mailed for entirely the wrong reason.
   */
  mockStore[`${MEMBERS_PATH}/aaa-other`] = {
    email: OTHER,
    // Recorded against THIS SITE. A list lives on the org and every site in
    // it can mail one, so a basis at the top of the row would be a grant no
    // brand was actually given.
    marketingConsentByHost: {
      [HOST_ID]: {
        marketingConsent: true,
        marketingConsentAtMs: Date.UTC(2025, 0, 1),
      },
    },
  }
})

describe('a person added from the Inbox, then suppressed', () => {
  it('is enrolled on an attestation and would be mailed', async () => {
    // The control. Without it, the assertion below cannot tell "suppression
    // worked" from "this person was never on the list".
    expect((await addToList({ attestConsent: true })).code).toBe(200)
    await sendCampaign()
    expect(reached()).toContain(SENDER)
  })

  /*
   * THE ASSERTION. The enrollment is untouched and still carries a valid
   * basis; what changed is a fact about the ADDRESS, learned after the
   * membership was written. A sender that trusted the enrollment would
   * deliver here.
   */
  it('is refused at SEND time by the platform list', async () => {
    expect((await addToList({ attestConsent: true })).code).toBe(200)
    mockStore[`emailSuppressions/${suppressionKey(SENDER)}`] = {
      email: SENDER,
      reason: 'bounce',
    }

    await sendCampaign()

    expect(reached()).not.toContain(SENDER)
    expect(reached()).toContain(OTHER)
    // The membership is still there, carrying its basis. Suppression is a
    // fact about the address and not a withdrawal of consent, and collapsing
    // the two would destroy the record that says the person asked to be here.
    expect(mockStore[`${MEMBERS_PATH}/${suppressionKey(SENDER)}`]).toMatchObject({
      email: SENDER,
      marketingConsentByHost: {
        [HOST_ID]: {
          marketingConsent: true,
          marketingConsentBasis: 'operator-attested',
        },
      },
    })
  })

  it('is refused at SEND time by this site’s own list', async () => {
    expect((await addToList({ attestConsent: true })).code).toBe(200)
    mockStore[`hosts/${HOST_ID}/suppressions/${suppressionKey(SENDER)}`] = {
      email: SENDER,
    }

    await sendCampaign()

    expect(reached()).not.toContain(SENDER)
    expect(reached()).toContain(OTHER)
  })
})

describe('the enrollment-time check', () => {
  /*
   * It is still there, and it still matters — it is what stops a merchant
   * being told they added somebody who can never be mailed. It just is not
   * the LAST word, which is the whole point of the file.
   */
  it('refuses an address already suppressed, so nothing is written', async () => {
    mockStore[`emailSuppressions/${suppressionKey(SENDER)}`] = {
      email: SENDER,
      reason: 'complaint',
    }
    const out = await addToList({ attestConsent: true })
    expect(out.code).toBe(409)
    expect(mockStore[`${MEMBERS_PATH}/${suppressionKey(SENDER)}`]).toBeUndefined()
  })
})

describe('a person who declined', () => {
  it('cannot be enrolled from the Inbox, so no campaign can reach them', async () => {
    mockStore[`orgs/${ORG_ID}/contacts/c1`] = {
      email: SENDER,
      marketingConsent: false,
    }

    const out = await addToList({ attestConsent: true })

    expect(out.code).toBe(409)
    expect(out.body.reason).toBe('declined')
    expect(mockStore[`${MEMBERS_PATH}/${suppressionKey(SENDER)}`]).toBeUndefined()
    await sendCampaign()
    expect(reached()).not.toContain(SENDER)
  })
})

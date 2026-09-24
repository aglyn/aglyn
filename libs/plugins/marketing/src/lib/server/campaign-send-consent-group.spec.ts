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
 * A CAMPAIGN IS SENT BY THE CONSENT GROUP, SO IT HONORS THE GROUP'S OPT-OUTS
 * (AGL-3310).
 *
 * An org may declare several sites one sender, and the consent join already
 * reads the campaign's audience against that sender. The three per-site
 * filters after it read the sending site alone, so somebody who unsubscribed
 * from site B — a site every capture form told them was the same sender as
 * site A — was mailed site A's next campaign.
 *
 * The filters here are the REAL ones: the barrel's two suppression helpers are
 * wired to the leaf implementations over this file's store, and the cadence
 * filter is imported from its leaf by the sender itself. A double would only
 * prove the sender passed something; what is under test is who is mailed.
 *
 * The last block is the control the other direction needs: an org that
 * declared no group reads exactly the lists it always read.
 */

const store = new Map<string, Record<string, any>>()
const sent: Array<Record<string, any>> = []
/** Every document path the batched filters asked for, in order. */
const batchedReads: string[] = []

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
  getAll: async (...refs: any[]) => {
    for (const ref of refs) batchedReads.push(String(ref.path))
    return refs.map((ref) => snapshotOf(String(ref.path)))
  },
})

/** The owning org — its `consentGroups` declaration is what each test varies. */
let mockOrg: Record<string, unknown> = { plan: 'pro' }

jest.mock('@aglyn/tenant-data-admin', () => ({
  UNSUBSCRIBE_SUPPRESSION_REASON: 'unsubscribe',
  // The REAL resolution, over the org this file declares.
  consentGroupForSite: async (hostId: string) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/consent-groups')
      .consentGroupForHost(mockOrg, hostId),
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockFirestore(),
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'uid-1', email_verified: true }),
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
  // The REAL filters, resolved lazily because a mock factory is hoisted
  // above every import.
  filterSendableForHost: (...args: unknown[]) =>
    jest
      .requireActual('@aglyn/tenant-data-admin/server/email-suppression')
      .filterSendableForHost(...args),
  filterTopicSendable: (...args: unknown[]) =>
    jest
      .requireActual('@aglyn/tenant-data-admin/server/email-suppression')
      .filterTopicSendable(...args),
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
  resolveHostSendingIdentity: async () =>
    jest.requireActual('@aglyn/shared-util-email').resolveSendingIdentity({
      selection: null,
      platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
    }),
  orgDataCollectionForHost: jest.fn(),
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

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    sent.push(message)
    return { sent: true }
  },
}))

import { createHash } from 'crypto'
import { DEFAULT_CAMPAIGN_TOPIC_ID } from '@aglyn/aglyn/app-utils/email-topics'
import { performCampaignSend } from './campaign-send'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The site sending the campaign. */
const SITE_A = 'host-1'
/** Declared one sender with site A. */
const SITE_B = 'host-2'
/** The same org, in no group with either — another brand. */
const SITE_C = 'host-3'

const LEFT = 'dana@example.com'
const STAYED = 'sam@example.com'
const NOW = Date.UTC(2026, 7, 20)
const DAY = 86_400_000

const DECLARED = {
  plan: 'pro',
  consentGroups: { acme: { name: 'Acme', hostIds: [SITE_A, SITE_B] } },
}

const keyFor = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

function seed() {
  store.clear()
  sent.length = 0
  batchedReads.length = 0
  mockOrg = { ...DECLARED }
  store.set(`hosts/${SITE_A}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
  })
  for (const [id, email] of [
    ['lead-1', LEFT],
    ['lead-2', STAYED],
  ]) {
    // Both opted in on a form that disclosed the group, so the grant was
    // written for every site it named.
    store.set(`orgs/org-1/leads/${id}`, {
      email,
      name: 'Reader',
      marketingConsentByHost: Object.fromEntries(
        [SITE_A, SITE_B].map((hostId) => [
          hostId,
          { marketingConsent: true, marketingConsentAtMs: Date.UTC(2026, 7, 1) },
        ]),
      ),
    })
  }
}

const send = (extra: Record<string, unknown> = {}) =>
  performCampaignSend({
    hostId: SITE_A,
    subject: 'Hello',
    body: 'Hi',
    audience: 'leads',
    senderUid: 'uid-1',
    ...extra,
  })

const addressed = () => sent.map((message) => String(message['to'])).sort()

beforeEach(() => {
  seed()
  process.env.EMAIL_UNSUBSCRIBE_SECRET = 'unsubscribe-secret'
  process.env.USAGE_EMAIL_FROM = 'noreply@aglyn.com'
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('an opt-out on a sibling site withholds the campaign', () => {
  it('does not mail somebody who unsubscribed from site B', async () => {
    store.set(`hosts/${SITE_B}/suppressions/${keyFor(LEFT)}`, {
      email: LEFT,
      reason: 'unsubscribe',
    })

    await send()

    expect(addressed()).toEqual([STAYED])
  })

  it('counts them out BEFORE the merchant presses Send', async () => {
    store.set(`hosts/${SITE_B}/suppressions/${keyFor(LEFT)}`, {
      email: LEFT,
      reason: 'unsubscribe',
    })

    const preview = await send({ dryRun: true })

    expect(preview.sendable).toBe(1)
    expect(preview.suppressed).toBe(1)
  })

  it('does not mail somebody who left the campaign’s stream on site B', async () => {
    store.set(`hosts/${SITE_B}/topicOptOuts/${keyFor(LEFT)}`, {
      email: LEFT,
      topics: {
        [DEFAULT_CAMPAIGN_TOPIC_ID]: {
          optedOutAt: { seconds: 1 },
          resubscribedAt: null,
        },
      },
    })

    await send()

    expect(addressed()).toEqual([STAYED])
  })

  it('holds somebody who asked site B for a slower pace', async () => {
    store.set(`hosts/${SITE_B}/emailFrequency/${keyFor(LEFT)}`, {
      email: LEFT,
      cadence: 'monthly',
      cadenceSetAtMs: NOW - 30 * DAY,
      lastSentAtMs: NOW - 3 * DAY,
      sentAtMs: [],
    })

    const preview = await send({ dryRun: true })

    expect(preview.sendable).toBe(1)
    expect(preview.cadenceHeld).toBe(1)
    // A pace, not an unsubscribe — and not reported as one.
    expect(preview.suppressed).toBe(0)
  })
})

describe('the sites outside the group', () => {
  it('mail somebody another brand in the same org suppressed', async () => {
    store.set(`hosts/${SITE_C}/suppressions/${keyFor(LEFT)}`, {
      email: LEFT,
      reason: 'unsubscribe',
    })
    store.set(`hosts/${SITE_C}/topicOptOuts/${keyFor(LEFT)}`, {
      email: LEFT,
      topics: {
        [DEFAULT_CAMPAIGN_TOPIC_ID]: {
          optedOutAt: { seconds: 1 },
          resubscribedAt: null,
        },
      },
    })

    await send()

    expect(addressed()).toEqual([LEFT, STAYED].sort())
  })
})

describe('an org that declared no group', () => {
  it('reads exactly the lists it always read, and none of another site’s', async () => {
    mockOrg = { plan: 'pro' }
    // Site B is not site A's sibling here, so its unsubscribe stays its own.
    store.set(`hosts/${SITE_B}/suppressions/${keyFor(LEFT)}`, {
      email: LEFT,
      reason: 'unsubscribe',
    })
    for (const id of ['lead-1', 'lead-2']) {
      const lead = store.get(`orgs/org-1/leads/${id}`) as Record<string, any>
      lead['marketingConsentByHost'] = {
        [SITE_A]: lead['marketingConsentByHost'][SITE_A],
      }
    }

    await send()

    expect(addressed()).toEqual([LEFT, STAYED].sort())
    // One batched read per list, over this send's recipients, all of them
    // under the sending site: the suppression list, the stream records, and
    // the pace counters.
    const keys = [keyFor(LEFT), keyFor(STAYED)]
    const underSiteA = (list: string) =>
      keys.map((key) => `hosts/${SITE_A}/${list}/${key}`).sort()
    const readsOf = (list: string) =>
      batchedReads.filter((path) => path.includes(`/${list}/`)).sort()
    expect(readsOf('suppressions')).toEqual(underSiteA('suppressions'))
    expect(readsOf('topicOptOuts')).toEqual(underSiteA('topicOptOuts'))
    expect(readsOf('emailFrequency')).toEqual(underSiteA('emailFrequency'))
    expect(batchedReads.some((path) => path.includes(SITE_B))).toBe(false)
  })
})

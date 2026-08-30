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
 * The consent JOIN, asserted against what `sendEmail` was actually called
 * with (`docs/specs/email-overhaul.md` §3f).
 *
 * `marketingConsent` had seven writers and no reader on any send path:
 * `performCampaignSend` filtered on the suppression list and nothing else, so
 * a person who ticked a box and a person who explicitly declined reached the
 * same inbox. These assertions are deliberately made against the DELIVERED
 * addresses rather than against the split helper's return value — a rule that
 * decides correctly and does not reach the recipient list is worth nothing
 * here, and the failure ships to third parties before anybody notices.
 *
 * `marketing-consent.spec.ts` owns what the rule decides. This file owns that
 * the send applies it, where it applies it, and what it does to the meter.
 */

const mockState: {
  store: Record<string, Record<string, unknown>>
  sent: Array<Record<string, any>>
  metered: Array<[string, number, string]>
  reserved: number[]
  org: Record<string, unknown>
} = { store: {}, sent: [], metered: [], reserved: [], org: { plan: 'starter' } }

jest.mock('@aglyn/tenant-data-admin', () => ({
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
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockState.org }),
  // The `list` audience walks `orgDataCollectionForHost('contacts').parent`
  // to reach `orgs/{orgId}/lists`, so this has to be the real path shape and
  // not a bare jest.fn().
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    mockFirestore().collection(`orgs/org-1/${name}`),
  orgDataQueryForHost: async (_hostId: string, name: string) => ({
    ref: mockFirestore().collection(`orgs/org-1/${name}`),
    query: mockFirestore().collection(`orgs/org-1/${name}`),
  }),
  meterHostEmail: async (hostId: string, count: number, sendClass: string) => {
    mockState.metered.push([hostId, count, sendClass])
  },
  orgCampaignEmailSendsForMonth: async () => 0,
  /*
   * Records the CLAIMED count, which is the assertion that a withheld
   * recipient costs the merchant nothing. Consent sits before the meter on
   * purpose: being charged for mail that policy forbids sending would make
   * the consent rule take money as well as reach.
   */
  reserveCampaignEmailSends: async ({ count, limit }: any) => {
    mockState.reserved.push(count)
    if (count > limit) return { ok: false, used: 0, limit }
    return { ok: true, reservation: { orgId: 'org-1', month: 'm', reserved: count }, used: 0, limit }
  },
  reconcileCampaignSendReservation: async () => undefined,
  // Both suppression lists, through the shared filter this send now uses.
  // Wide open here: `campaign-send.spec.ts` and the suppression suites own
  // what it removes, and this file is about the consent join in front of it.
  filterSendableForHost: async (_hostId: string, emails: string[]) => emails,
  readEmailSendRateConfig: async () => ({
    perHour: 100_000,
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
}))

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockState.sent.push(message)
    return { sent: true }
  },
}))

import { MARKETING_CONSENT_ENFORCED_FROM_MS } from '@aglyn/aglyn/server'
import { CampaignSendError, performCampaignSend } from './campaign-send'

/** A path-keyed Firestore stand-in, covering only the shapes a send makes. */
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
  /** The ids directly under `path`, in `__name__` order. */
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
   * `orderBy` / `startAfter` / `limit`, and `limit` HONORS its argument — a
   * double whose `limit` returned everything could not fail the way the real
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

const BEFORE_CUTOFF = MARKETING_CONSENT_ENFORCED_FROM_MS - 30 * 86_400_000
const AFTER_CUTOFF = MARKETING_CONSENT_ENFORCED_FROM_MS + 30 * 86_400_000

/**
 * Four leads spanning the states that matter. Every one of them is a valid,
 * unsuppressed, deliverable address — nothing but the consent rule
 * distinguishes them, so anything the assertions catch is the rule.
 */
function seedLeads() {
  mockState.store = {
    'hosts/host-1': { subdomain: 'acme', memberRoles: {} },
    // Ticked the box. Mailable under every policy.
    'hosts/host-1/leads/l1': {
      email: 'consented@example.com',
      name: 'Cora',
      marketingConsent: true,
      marketingConsentAtMs: AFTER_CUTOFF,
      createdAt: AFTER_CUTOFF,
    },
    // Captured before consent was required, no basis. Reachable, reported.
    'hosts/host-1/leads/l2': {
      email: 'grandfathered@example.com',
      name: 'Glen',
      createdAt: BEFORE_CUTOFF,
    },
    // Captured AFTER consent was required, still no basis. Not mailable.
    'hosts/host-1/leads/l3': {
      email: 'nobasis@example.com',
      name: 'Nora',
      createdAt: AFTER_CUTOFF,
    },
    // Said no, and said it long ago. Never mailable.
    'hosts/host-1/leads/l4': {
      email: 'declined@example.com',
      name: 'Dev',
      marketingConsent: false,
      createdAt: BEFORE_CUTOFF,
    },
  }
  mockState.sent = []
  mockState.metered = []
  mockState.reserved = []
  mockState.org = { plan: 'starter' }
}

const send = (over: Record<string, unknown> = {}) =>
  performCampaignSend({
    hostId: 'host-1',
    subject: 'Spring sale',
    body: 'The sale is on.',
    audience: 'leads',
    recordCampaign: false,
    senderUid: 'uid-1',
    ...over,
  })

const delivered = () =>
  mockState.sent.map((message) => String(message['to'])).sort()

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
beforeEach(seedLeads)

describe('a marketing campaign sends only where a basis permits it', () => {
  /**
   * ⚠️ THE ASSERTION THIS WHOLE FEATURE EXISTS FOR.
   *
   * A person with no recorded consent basis, captured under the rule, must
   * not receive a marketing campaign. Before the join this address was
   * delivered to like every other one.
   */
  it('does not mail a recipient with no recorded basis', async () => {
    await send()
    expect(delivered()).not.toContain('nobasis@example.com')
  })

  /**
   * The other unconditional half. A stored refusal is a decision the person
   * made and no mode, cutoff or grandfathering may mail over it — including
   * one recorded long before enforcement began.
   */
  it('does not mail a recipient who declined, however old the refusal', async () => {
    await send()
    expect(delivered()).not.toContain('declined@example.com')
  })

  /**
   * The NON-RETROACTIVE guarantee, which is the half that protects existing
   * customers. Turning the join on must not empty an audience: everybody
   * captured before the cutoff stays reachable and is merely reported
   * differently.
   */
  it('still mails everyone captured before consent was required', async () => {
    await send()
    expect(delivered()).toEqual([
      'consented@example.com',
      'grandfathered@example.com',
    ])
  })

  /**
   * WHERE the check sits. Consent is applied before the reservation, so a
   * withheld recipient never consumes the org's monthly allowance and never
   * appears in the cost meter. Being charged for mail that policy forbids
   * sending would make the rule cost the merchant money as well as reach.
   */
  it('never meters or claims allowance for a withheld recipient', async () => {
    await send()
    expect(mockState.reserved).toEqual([2])
    expect(mockState.metered).toEqual([['host-1', 2, 'campaign']])
  })

  /**
   * The owner's decision, and what it costs. `strict` is the retroactive
   * mode: it removes the grandfathered population, which on a real audience
   * is most of it. It is a stored per-org setting and never a default.
   */
  it('drops the grandfathered population once the org opts into strict', async () => {
    mockState.org = {
      plan: 'starter',
      marketingConsentPolicy: { mode: 'strict' },
    }
    await send()
    expect(delivered()).toEqual(['consented@example.com'])
  })

  /**
   * A `manual` audience is hand-typed addresses with no person record behind
   * them, so there is nothing to read. They grandfather — which is also what
   * keeps the composer's test send to the admin's own address working.
   */
  it('mails a hand-typed address, which has no record to read', async () => {
    await send({ audience: 'manual', emails: ['someone@example.com'] })
    expect(delivered()).toEqual(['someone@example.com'])
  })

  /**
   * The refusal has to be a REFUSAL and not an empty-audience 400: a merchant
   * whose whole audience lacks a basis needs to be told which problem they
   * have, because the two have different fixes.
   */
  it('refuses the send, naming consent, when nobody is mailable', async () => {
    mockState.org = {
      plan: 'starter',
      marketingConsentPolicy: { mode: 'strict' },
    }
    delete mockState.store['hosts/host-1/leads/l1']
    await expect(send()).rejects.toThrow(CampaignSendError)
    await expect(send()).rejects.toThrow(/consent record/i)
    expect(mockState.sent).toHaveLength(0)
  })
})

describe('the send preview says which population is which', () => {
  /**
   * The split is REPORTED, not netted into one number. `grandfathered` is
   * precisely the population that disappears if this org ever turns strict
   * on, so a merchant reading `Recipients 1,240` is owed the breakdown before
   * they write the email rather than after an audience collapses.
   */
  it('reports consented, grandfathered and withheld separately', async () => {
    await expect(send({ dryRun: true })).resolves.toMatchObject({
      // The WHOLE audience, which is what the breakdown is measured over —
      // the same figure the `500 of 3,200` readout uses.
      audienceSize: 4,
      recipients: 2,
      sendable: 2,
      consented: 1,
      grandfathered: 1,
      consentWithheld: 2,
      dryRun: true,
    })
    // A dry run writes nothing and mails nothing.
    expect(mockState.sent).toHaveLength(0)
    expect(mockState.reserved).toEqual([])
  })

  /** `sendable` is what will really go out, so the composer cannot overstate it. */
  it('counts sendable after consent, not merely after suppression', async () => {
    const preview = await send({ dryRun: true })
    expect(preview.sendable).toBe(2)
    const actual = await send()
    expect(actual.sent).toBe(preview.sendable)
  })
})

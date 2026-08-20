/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
 *
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
 * THE PLATFORM SUPPRESSION LIST HAS READERS (AGL-2407).
 *
 * AGL-1918 made bounces and complaints WRITE a suppression; AGL-2407 gave the
 * transactional half of that a place to land. A list nothing consults is the
 * written-but-never-read shape one level up, so this file asserts the two
 * senders that must consult it — and, just as load-bearing, the ones that must
 * NOT.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - THE GATE IS WIRED, not merely written. Both assertions run the REAL
 *    `isEmailSuppressed` / `filterSuppressedEmails` against a store the test
 *    seeded, through the REAL sender. A stub for either would prove the check
 *    exists somewhere and nothing about whether a message stops.
 *  - IT IS PER ADDRESS, not per fan-out. One suppressed admin must not silence
 *    the other three.
 *  - IT DOES NOT REACH TRANSACTIONAL MAIL. `sendEmail` itself is
 *    unconditional, and that is a decision, not an omission: refusing a
 *    password reset because an address once bounced locks a real customer out
 *    of their own account. AGL-1438 drew the same line for quotas.
 */

import { createHash } from 'crypto'
import { fakeFirestore } from '@aglyn/tenant-data-admin/server/test-firestore'

const suppressionKey = (email: string) =>
  createHash('sha256').update(email).digest('hex')

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSent: Array<Record<string, any>> = []

jest.mock('@aglyn/shared-util-email', () => ({
  // Spread the REAL module: `usage-alert-email` and the usage-email route
  // reach it for more than `sendEmail`, and a factory that listed only what
  // they use TODAY is a closed world that breaks as "X is not a function" the
  // day either of them uses one more export.
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockSent.push(message)
    return { sent: true, id: 'email_1' }
  },
}))

jest.mock('../utils/cron-auth', () => ({
  __esModule: true,
  isCronAuthorized: () => true,
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  loadSystemEmail: async () => null,
  renderLoadedSystemEmail: () => null,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  findUserByUidAcrossPools: async (uid: string) => ({
    record: { email: `${uid}@example.com` },
  }),
  meterPlatformEmail: async () => undefined,
  meterOrgEmail: async () => undefined,
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockStore,
      auth: () => ({}),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'server-time' } },
  },
}))

// NOT mocked, on purpose: `@aglyn/tenant-data-admin/server/email-suppression`
// is imported by both senders through its LEAF entry point precisely so the
// barrel mock above cannot replace it. The gate under test is the shipped one.

let mockStore: any

import { emailOrgAdmins, orgAdminEmails } from '../app/api/_lib/usage-alert-email'
import { POST as usageEmailCron } from '../app/api/billing/usage-email/route'
import { suppressEmail } from '@aglyn/tenant-data-admin/server/email-suppression'

// ---------------------------------------------------------------------------

const ORG = 'org-1'

/** Members as `orgs/{id}/members`, which `orgAdminEmails` reads. */
function seedOrg(members: Array<{ id: string; role: string; email: string }>) {
  const docs: Record<string, any> = {}
  for (const member of members) {
    docs[member.id] = { role: member.role, email: member.email }
  }
  return fakeFirestore({ [`orgs/${ORG}/members`]: docs })
}

/**
 * The fake indexes by collection NAME, and `orgAdminEmails` walks
 * `collection('orgs').doc(orgId).collection('members')`. Wrap it so the
 * nested walk lands on the flat key seeded above rather than silently
 * resolving to an empty collection — an empty member list would make every
 * assertion below vacuously true.
 */
function nested(flat: any) {
  return {
    ...flat,
    collection: (name: string) =>
      name === 'orgs'
        ? {
            doc: (orgId: string) => ({
              collection: (sub: string) =>
                flat.collection(`orgs/${orgId}/${sub}`),
            }),
          }
        : flat.collection(name),
  }
}

beforeEach(() => {
  mockSent.length = 0
})

describe('the usage-alert fan-out', () => {
  it('PREMISE: it mails every owner and admin when nothing is suppressed', async () => {
    // The anti-vacuity control. Without it, a fan-out that resolved to zero
    // addresses for an unrelated reason would satisfy every assertion below.
    const store = nested(
      seedOrg([
        { id: 'm1', role: 'owner', email: 'owner@example.com' },
        { id: 'm2', role: 'admin', email: 'admin@example.com' },
      ]),
    )
    expect(await orgAdminEmails(store as any, ORG)).toEqual([
      'owner@example.com',
      'admin@example.com',
    ])

    const result = await emailOrgAdmins({
      firestore: store as any,
      orgId: ORG,
      subject: 'Usage',
      text: 'Body',
      context: 'usage-alert',
    })

    expect(result).toMatchObject({ sent: true })
    expect(mockSent[0]['to']).toEqual([
      'owner@example.com',
      'admin@example.com',
    ])
  })

  it('drops a suppressed admin and keeps the rest', async () => {
    const store = nested(
      seedOrg([
        { id: 'm1', role: 'owner', email: 'owner@example.com' },
        { id: 'm2', role: 'admin', email: 'admin@example.com' },
      ]),
    )
    await suppressEmail({
      email: 'admin@example.com',
      reason: 'bounce',
      firestore: store,
    })

    await emailOrgAdmins({
      firestore: store as any,
      orgId: ORG,
      subject: 'Usage',
      text: 'Body',
      context: 'usage-alert',
    })

    // Per address. One dead mailbox must not silence the owner's alert.
    expect(mockSent[0]['to']).toEqual(['owner@example.com'])
  })

  it('sends nothing when every recipient is suppressed', async () => {
    const store = nested(
      seedOrg([{ id: 'm1', role: 'owner', email: 'owner@example.com' }]),
    )
    await suppressEmail({
      email: 'owner@example.com',
      reason: 'complaint',
      firestore: store,
    })

    const result = await emailOrgAdmins({
      firestore: store as any,
      orgId: ORG,
      subject: 'Usage',
      text: 'Body',
      context: 'usage-alert',
    })

    expect(result).toEqual({ sent: false, reason: 'no-recipient' })
    expect(mockSent).toHaveLength(0)
  })

  it('mails a RELEASED address again', async () => {
    // A release is a field, not a delete, so "released" has to be READ as not
    // suppressed rather than inferred from the record being gone.
    const store = nested(
      seedOrg([{ id: 'm1', role: 'owner', email: 'owner@example.com' }]),
    )
    const key = suppressionKey('owner@example.com')
    await suppressEmail({
      email: 'owner@example.com',
      reason: 'bounce',
      firestore: store,
    })
    store.docs('emailSuppressions')[key].releasedAt = { seconds: 1 }

    await emailOrgAdmins({
      firestore: store as any,
      orgId: ORG,
      subject: 'Usage',
      text: 'Body',
      context: 'usage-alert',
    })

    expect(mockSent[0]['to']).toEqual(['owner@example.com'])
  })
})

describe('transactional mail is deliberately NOT gated', () => {
  it('the REAL sendEmail still posts to Resend for a suppressed address', async () => {
    /*
     * The line AGL-1438 drew for quotas, drawn again here. A password reset,
     * a verification or an invite answers something the human just did;
     * refusing one over a stale bounce locks a real customer out of their own
     * account. If this ever goes red because somebody moved the gate into
     * `sendEmail`, that is the conversation to have — not a green to restore
     * by deleting the test.
     *
     * `requireActual`, NOT the recorder the rest of this file mocks in.
     * Asserting `{sent: true}` off the stub would assert the stub; the
     * question is whether the SHIPPED function still hands a suppressed
     * address to Resend, so the assertion is on the outbound fetch.
     */
    const real = jest.requireActual('@aglyn/shared-util-email')
    const store = seedOrg([])
    await suppressEmail({
      email: 'owner@example.com',
      reason: 'bounce',
      firestore: store,
    })

    process.env.RESEND_API_KEY = 'test-key'
    process.env.USAGE_EMAIL_FROM = 'Aglyn <noreply@aglyn.com>'
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_1' }),
      text: async () => '',
    })
    const originalFetch = global.fetch
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await real.sendEmail({
      to: 'owner@example.com',
      subject: 'Reset your password',
      text: 'Link',
      context: 'password-reset',
    })

    expect(result).toMatchObject({ sent: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.to).toEqual(['owner@example.com'])
    // …and it carries the tag that makes a bounce on THIS message placeable.
    expect(body.tags).toEqual([{ name: 'context', value: 'password-reset' }])
    global.fetch = originalFetch
  })
})

/**
 * THE MONTHLY USAGE SUMMARY (AGL-2407).
 *
 * The purest case the list exists for: a cron that mails the same address on
 * the same day every month, forever, with nothing that ever noticed the
 * mailbox stopped existing. Twelve deliveries a year at a dead address is what
 * teaches a provider that `aglyn.com` does not read its bounces.
 */
describe('the monthly usage-summary cron', () => {
  /** Orgs + their rollups, in the shape the route walks. */
  function seedBilling(orgs: Array<{ id: string; ownerUid: string }>) {
    const orgDocs = orgs.map((org) => ({
      id: org.id,
      get: (field: string) =>
        ({ plan: 'starter', ownerUid: org.ownerUid, name: org.id })[field],
      data: () => ({ plan: 'starter', ownerUid: org.ownerUid }),
      ref: {
        // `orgs/{id}/usage/{month}`. The route awaits `.get()` on the
        // DocumentReference — a double that returned the snapshot straight
        // off `.doc()` reads as "no rollup" and skips every org, which is a
        // green on `mockSent` for entirely the wrong reason.
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              get: (field: string) =>
                field === 'emailedAt' ? undefined : 0,
              ref: { set: async () => undefined },
            }),
          }),
        }),
      },
    }))
    return {
      collection: (name: string) =>
        name === 'orgs'
          ? { limit: () => ({ get: async () => ({ docs: orgDocs }) }) }
          : suppressionStore.collection(name),
    }
  }

  let suppressionStore: any

  const run = async () => {
    const response = await usageEmailCron(
      new Request('https://app.aglyn.com/api/billing/usage-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month: '2026-07' }),
      }),
    )
    expect(response.status).toBe(200)
    return (await response.json()) as { orgs: Record<string, any> }
  }

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.RESEND_API_KEY = 'test-key'
    process.env.USAGE_EMAIL_FROM = 'Aglyn <noreply@aglyn.com>'
    suppressionStore = fakeFirestore()
  })

  it('PREMISE: it mails an org whose owner is not suppressed', async () => {
    // Anti-vacuity. Without this, `skipped: 'suppressed'` below would be
    // indistinguishable from a harness that never sends anything at all.
    mockStore = seedBilling([{ id: 'org-1', ownerUid: 'owner' }])
    await expect(run()).resolves.toMatchObject({
      orgs: { 'org-1': { sent: true } },
    })
    expect(mockSent[0]['to']).toBe('owner@example.com')
  })

  it('SKIPS an owner on the platform suppression list', async () => {
    mockStore = seedBilling([{ id: 'org-1', ownerUid: 'owner' }])
    await suppressEmail({
      email: 'owner@example.com',
      reason: 'bounce',
      firestore: suppressionStore,
    })

    await expect(run()).resolves.toMatchObject({
      orgs: { 'org-1': { skipped: 'suppressed' } },
    })
    // The assertion that matters: no message left the building.
    expect(mockSent).toHaveLength(0)
  })

  it('skips only the suppressed org, not the whole sweep', async () => {
    mockStore = seedBilling([
      { id: 'org-1', ownerUid: 'owner' },
      { id: 'org-2', ownerUid: 'other' },
    ])
    await suppressEmail({
      email: 'owner@example.com',
      reason: 'bounce',
      firestore: suppressionStore,
    })

    await expect(run()).resolves.toMatchObject({
      orgs: { 'org-1': { skipped: 'suppressed' }, 'org-2': { sent: true } },
    })
    expect(mockSent).toHaveLength(1)
    expect(mockSent[0]['to']).toBe('other@example.com')
  })
})

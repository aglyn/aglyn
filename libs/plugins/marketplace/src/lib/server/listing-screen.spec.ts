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
 *
 * @jest-environment node
 */

/**
 * The phishing screen at marketplace submission (AGL-3365).
 *
 * Two halves, weighted the same, as the email screen's own suite is: the
 * disguises hold or are refused, and the ordinary listings a publisher writes
 * — a PayPal integration that names PayPal, a publisher whose name holds a
 * common word, the platform's own official listings — go through.
 */

const DAY = 86_400_000
const NOW = Date.parse('2026-09-28T12:00:00Z')

let mockOrg: Record<string, unknown> | null = null
const mockFiled: Array<Record<string, unknown>> = []
let mockHoldState: 'held' | 'released' | 'rejected' = 'held'
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: async () => ({ exists: false, data: () => mockOrg }) }),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/outbound-send-review', () => {
  const canonicalJson = (value: unknown) =>
    JSON.stringify(value, (_key, entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
        : entry,
    )
  return {
    canonicalJson,
    outboundContentHash: (parts: unknown[]) => canonicalJson(parts).length.toString(16),
    heldOutboundReviewId: (path: string, hash: string) =>
      Buffer.from(`${path}:${hash}`).toString('hex').slice(0, 40),
    heldOutboundReference: (id: string) => `HS-${id.slice(0, 10).toUpperCase()}`,
    flaggedHostOf: (signals: Array<{ host?: string }>) =>
      signals.find((signal) => signal.host)?.host ?? null,
    fileOutboundHold: async (filing: Record<string, unknown>) => {
      mockFiled.push(filing)
      return mockHoldState
    },
  }
})

import { renderOwnerRiskNotice } from '@aglyn/shared-util-email/risk-notice-catalog'
import {
  listingSubmissionRefusal,
  publisherIdentityImpersonation,
  screenListingSubmission,
} from './listing-screen'

beforeEach(() => {
  mockOrg = { name: 'Northwind Labs', createdAt: NOW - 3 * DAY }
  mockFiled.length = 0
  mockHoldState = 'held'
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('what the screen finds in a submission', () => {
  it('finds a lookalike link in a readme, whoever wrote it', () => {
    const { signals } = screenListingSubmission({
      displayName: 'Invoice Sync',
      readme: 'Setup: sign in at https://paypal-verify.net/connect',
    })
    expect(signals).toContainEqual(
      expect.objectContaining({ code: 'lookalike-link', brand: 'paypal', host: 'paypal-verify.net' }),
    )
  })

  it('reads a template as the page it will become — a credential field holds', () => {
    const { signals } = screenListingSubmission({
      displayName: 'Starter Site',
      pageNodes: [{ nodes: { a: { componentId: 'FormField', props: { fieldType: 'password', label: 'Bank password' } } } }],
    })
    expect(signals).toContainEqual(expect.objectContaining({ code: 'credential-field', field: 'password' }))
  })

  it('reads an email template as mail — a platform-lookalike link holds', () => {
    const { signals } = screenListingSubmission({
      displayName: 'Welcome Email',
      emailNodes: { a: { componentId: 'Button', props: { href: 'https://aglyn-billing.com/pay' } } },
    })
    expect(signals).toContainEqual(expect.objectContaining({ code: 'lookalike-link', brand: 'aglyn' }))
  })

  it('refuses a title that speaks for a brand, the platform included', () => {
    expect(screenListingSubmission({ displayName: 'PayPal Support Center' }).impersonation).toMatch(/PayPal/)
    expect(screenListingSubmission({ displayName: 'Official Aglyn Plugin' }).impersonation).toMatch(/Aglyn/)
  })

  it('passes a PayPal or Stripe integration that names them and links to them', () => {
    const findings = screenListingSubmission({
      displayName: 'Checkout for PayPal and Stripe',
      publisherName: 'Northwind Labs',
      description: 'Take PayPal and Stripe payments on your site.',
      readme:
        'Connect your PayPal account in settings. Docs: https://developer.paypal.com/docs ' +
        'and https://stripe.com/docs. Source: https://github.com/northwind/checkout',
    })
    expect(findings).toEqual({ impersonation: null, signals: [] })
  })

  it("lets the platform's staff publish the platform's own listings", () => {
    expect(
      screenListingSubmission({
        displayName: 'Aglyn Official Forms',
        publisherName: 'Aglyn',
        ownNames: ['Aglyn'],
        official: true,
      }),
    ).toEqual({ impersonation: null, signals: [] })
  })
})

describe('the publisher identity', () => {
  it('refuses a name or handle that wears the platform name', () => {
    expect(publisherIdentityImpersonation({ displayName: 'Aglyn Labs', handle: 'labs' })).toMatch(/Aglyn/)
    expect(publisherIdentityImpersonation({ displayName: 'Labs', handle: 'aglyn-team' })).toMatch(/Aglyn/)
  })

  it('refuses a name that speaks for another brand, and a lookalike handle', () => {
    expect(publisherIdentityImpersonation({ displayName: 'PayPal Support', handle: 'pp-help' })).toMatch(/PayPal/)
    expect(publisherIdentityImpersonation({ displayName: 'Helpers', handle: 'paypal-secure' })).toMatch(/PayPal/)
  })

  it('passes a company name that holds a common word or a brand in passing', () => {
    for (const displayName of ['Apple Orchard Software', 'Booking Tools Co', 'Team Northwind', 'Amazon Sync Tools']) {
      expect(publisherIdentityImpersonation({ displayName, handle: 'northwind' })).toBeNull()
    }
  })

  it("lets the platform's staff use the platform's name", () => {
    expect(
      publisherIdentityImpersonation({ displayName: 'Aglyn', handle: 'aglyn', official: true }),
    ).toBeNull()
  })
})

describe('the submission gate', () => {
  it('files a hold and refuses a young publisher’s soft signal, naming the reference', async () => {
    const refusal = await listingSubmissionRefusal({
      publisherOrgId: 'org-pub',
      content: {
        displayName: 'Order Alerts',
        publisherName: 'Poshmark Seller Desk',
        description: 'Your item has finally sold — confirm at https://orders.example.top',
      },
      nowMs: NOW,
    })
    expect(refusal).toMatchObject({ status: 409, body: { code: 'held-for-review' } })
    expect(String(refusal?.body['reference'])).toMatch(/^HS-/)
    expect(mockFiled).toHaveLength(1)
    expect(mockFiled[0]).toMatchObject({
      heldSend: { kind: 'listing', orgId: 'org-pub', path: 'publisherProfiles/org-pub', state: 'held' },
    })
    // The publisher's owners are told by the hold itself, through the risk
    // notice seam (AGL-3368): the outcome and the way forward, never the rule.
    expect(String(refusal?.body['error'])).not.toMatch(/poshmark|lure|day|young|brand/i)
    const told = renderOwnerRiskNotice('listing-held', {
      'item.label': 'the marketplace submission "Order Alerts"',
      reference: String(refusal?.body['reference']),
    })
    expect(Object.values(told).flat().join(' ')).not.toMatch(/poshmark|lure|young|brand|\d+ days?/i)
  })

  it('does not hold an established publisher on a soft signal', async () => {
    mockOrg = { name: 'Northwind Labs', createdAt: NOW - 400 * DAY }
    const refusal = await listingSubmissionRefusal({
      publisherOrgId: 'org-pub',
      content: {
        displayName: 'Order Alerts',
        publisherName: 'Poshmark Seller Desk',
        description: 'Your item has finally sold — confirm at https://orders.example.top',
      },
      nowMs: NOW,
    })
    expect(refusal).toBeNull()
    expect(mockFiled).toEqual([])
  })

  it('holds a lookalike link for every publisher, however old', async () => {
    mockOrg = { name: 'Northwind Labs', createdAt: NOW - 400 * DAY }
    const refusal = await listingSubmissionRefusal({
      publisherOrgId: 'org-pub',
      content: { displayName: 'Sync', urls: ['https://paypal-verify.net'] },
      nowMs: NOW,
    })
    expect(refusal?.status).toBe(409)
  })

  it('lets a submission staff released go through, and says so when rejected', async () => {
    const content = { displayName: 'Sync', urls: ['https://paypal-verify.net'] }
    mockHoldState = 'released'
    expect(await listingSubmissionRefusal({ publisherOrgId: 'org-pub', content, nowMs: NOW })).toBeNull()
    mockHoldState = 'rejected'
    expect(
      await listingSubmissionRefusal({ publisherOrgId: 'org-pub', content, nowMs: NOW }),
    ).toMatchObject({ status: 409, body: { code: 'rejected' } })
  })

  it('refuses an impersonating title outright, filing nothing', async () => {
    const refusal = await listingSubmissionRefusal({
      publisherOrgId: 'org-pub',
      content: { displayName: 'Aglyn Official Payments' },
      nowMs: NOW,
    })
    expect(refusal).toMatchObject({ status: 422, body: { code: 'impersonation' } })
    expect(mockFiled).toEqual([])
  })

  it('costs nothing for a clean submission', async () => {
    mockOrg = null
    expect(
      await listingSubmissionRefusal({
        publisherOrgId: 'org-pub',
        content: { displayName: 'Checkout for PayPal', readme: 'https://developer.paypal.com' },
        nowMs: NOW,
      }),
    ).toBeNull()
    expect(mockFiled).toEqual([])
  })
})

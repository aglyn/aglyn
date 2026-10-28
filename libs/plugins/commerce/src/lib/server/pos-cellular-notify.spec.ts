/**
 * @jest-environment node
 */
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
 * The notice that 4G was turned off for an unpaid month (AGL-4038): the
 * designed system email to the workspace members who hold "Manage billing"
 * (a key, never a role), the console feed beside it without a second email,
 * and nothing at all for a banned account.
 */

const mockSent: Array<Record<string, unknown>> = []
const mockFeed: Array<{ orgId: string; payload: Record<string, unknown>; options: Record<string, unknown> }> = []
let mockOrg: Record<string, unknown> = {}
const MEMBERS = [
  { $id: 'uid-owner', email: 'owner@example.com' },
  { $id: 'uid-billing', email: 'billing@example.com' },
  { $id: 'uid-cashier', email: 'cashier@example.com' },
]
/** Who holds "Manage billing": the owner, and a member a custom role grants it. */
const BILLING = new Set(['uid-owner', 'uid-billing'])

jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: { app: () => ({ firestore: () => fake.fakeFirestore }) },
    hostDisplayName: (host: Record<string, unknown>, hostId: string) => String(host['displayName'] ?? hostId),
    listOrgMembers: async () => MEMBERS,
    memberHasOrgPermission: async (_orgId: string, member: { $id: string }, key: string) =>
      key === 'billing.manage' && BILLING.has(member.$id),
    meterPlatformEmail: async () => undefined,
    notifyOrgAdmins: async (orgId: string, payload: Record<string, unknown>, options: Record<string, unknown>) => {
      mockFeed.push({ orgId, payload, options })
    },
  }
})
jest.mock('@aglyn/tenant-data-admin/server/email-suppression', () => ({
  filterSuppressedEmails: async (addresses: string[]) => addresses,
}))
jest.mock('@aglyn/tenant-data-admin/server/render-system-email', () => ({
  orgSystemEmailBrand: async () => ({ merge: {}, options: {}, fromName: '' }),
  renderSystemEmailContent: async (key: string, merge: Record<string, string>, _brand: unknown, fallback: { subject: string }) => ({
    subject: fallback.subject,
    html: `<p>${key}</p>`,
    text: JSON.stringify(merge),
  }),
}))
jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email/pos-cellular-emails'),
  sendEmail: async (message: Record<string, unknown>) => {
    mockSent.push(message)
    return { sent: true }
  },
}))

import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'
import { sendPosCellularTurnedOffNotice } from './pos-cellular-notify'

const NOTICE = {
  orgId: 'org-1',
  month: '2026-10',
  amount: '$10.61',
  readers: 1,
  openedAtMs: Date.UTC(2026, 10, 2, 9),
  turnedOffAtMs: Date.UTC(2026, 10, 16, 9),
  hostIds: ['host-1'],
}

beforeEach(() => {
  resetFakeFirestore()
  mockSent.length = 0
  mockFeed.length = 0
  mockOrg = { name: 'Acme Builders', slug: 'acme' }
  fakeDocs.set('orgs/org-1', mockOrg)
  fakeDocs.set('hosts/host-1', { displayName: 'Main Street' })
})

describe('the notice that 4G was turned off (AGL-4038)', () => {
  it('emails the members who manage billing, by the key, with the month, amount, store and the way back', async () => {
    expect(await sendPosCellularTurnedOffNotice(NOTICE)).toBe(true)
    expect(mockSent.map((message) => message['to']).sort()).toEqual(['billing@example.com', 'owner@example.com'])
    const merge = JSON.parse(String(mockSent[0]['text']))
    expect(merge).toMatchObject({
      'org.name': 'Acme Builders',
      'cellular.month': 'October 2026',
      'cellular.amount': '$10.61',
      'cellular.readers': '1 Stripe Reader S710',
      'cellular.openedOn': 'November 2, 2026',
      'cellular.turnedOffOn': 'November 16, 2026',
      'cellular.stores': 'Main Street',
      'cellular.billingUrl': expect.stringMatching(/\/acme\/billing$/),
    })
    expect(mockSent[0]).toMatchObject({ context: 'pos-cellular-turned-off-unpaid' })
    // The console feed says the same, without a second email.
    expect(mockFeed).toEqual([
      expect.objectContaining({
        orgId: 'org-1',
        payload: expect.objectContaining({ type: 'billing.paymentFailed', link: '/acme/billing' }),
        options: { skipEmail: true },
      }),
    ])
  })

  it('sends a banned account nothing', async () => {
    fakeDocs.set('orgs/org-1', { ...mockOrg, suspendedAt: 1, suspendedReasonCode: 'abuse' })
    expect(await sendPosCellularTurnedOffNotice(NOTICE)).toBe(false)
    expect(mockSent).toEqual([])
    expect(mockFeed).toEqual([])
  })
})

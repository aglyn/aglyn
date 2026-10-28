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
 * The two notices of an unpaid 4G charge (AGL-4038), the warning the day it
 * is left open and the notice that 4G was turned off: the designed system
 * email to the workspace members who hold "Manage billing" (a key, never a
 * role), the same members' console feed beside it without a second email,
 * days in the workspace's time zone, and nothing at all for a banned account.
 */

const mockSent: Array<Record<string, unknown>> = []
const mockFeed: Array<{ uids: string[]; payload: Record<string, unknown>; options: Record<string, unknown> }> = []
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
    notifyUsers: async (uids: string[], payload: Record<string, unknown>, options: Record<string, unknown>) => {
      mockFeed.push({ uids: [...uids], payload, options })
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
import { sendPosCellularPaymentDueNotice, sendPosCellularTurnedOffNotice } from './pos-cellular-notify'

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
    // The same members' console feed says the same, without a second email.
    expect(mockFeed).toEqual([
      {
        uids: ['uid-owner', 'uid-billing'],
        payload: expect.objectContaining({ type: 'billing.paymentFailed', link: '/acme/billing', orgId: 'org-1' }),
        options: { skipEmail: true },
      },
    ])
  })

  it('sends a banned account nothing', async () => {
    fakeDocs.set('orgs/org-1', { ...mockOrg, suspendedAt: 1, suspendedReasonCode: 'abuse' })
    expect(await sendPosCellularTurnedOffNotice(NOTICE)).toBe(false)
    expect(mockSent).toEqual([])
    expect(mockFeed).toEqual([])
  })
})

describe('the warning the day a 4G charge is left open (AGL-4038)', () => {
  const DUE = {
    orgId: 'org-1',
    month: '2026-10',
    amount: '$10.61',
    readers: 2,
    openedAtMs: Date.UTC(2026, 10, 2, 3),
    turnsOffAtMs: Date.UTC(2026, 10, 16, 3),
    hostIds: ['host-1', 'host-gone'],
  }

  it('emails the members who manage billing, by the key, with the amount, the stores and the day 4G turns off', async () => {
    expect(await sendPosCellularPaymentDueNotice(DUE)).toBe(true)
    expect(mockSent.map((message) => message['to']).sort()).toEqual(['billing@example.com', 'owner@example.com'])
    expect(mockSent[0]).toMatchObject({
      context: 'pos-cellular-payment-due',
      subject: '4G turns off on November 16, 2026 unless the October 2026 charge is paid',
    })
    expect(JSON.parse(String(mockSent[0]['text']))).toEqual({
      'org.name': 'Acme Builders',
      'cellular.month': 'October 2026',
      'cellular.amount': '$10.61',
      'cellular.readers': '2 Stripe Reader S710s',
      'cellular.openedOn': 'November 2, 2026',
      'cellular.turnsOffOn': 'November 16, 2026',
      // A store deleted since is left out.
      'cellular.stores': 'Main Street',
      'cellular.billingUrl': expect.stringMatching(/\/acme\/billing$/),
    })
    expect(mockFeed).toEqual([
      {
        uids: ['uid-owner', 'uid-billing'],
        payload: expect.objectContaining({
          type: 'billing.paymentFailed',
          level: 'warning',
          link: '/acme/billing',
          orgId: 'org-1',
          title: '4G turns off on November 16, 2026 unless the October 2026 charge is paid',
          body: expect.stringContaining('before November 16, 2026'),
        }),
        options: { skipEmail: true },
      },
    ])
  })

  it('names the days in the workspace’s time zone', async () => {
    fakeDocs.set('orgs/org-1', { ...mockOrg, timeZone: 'America/Chicago' })
    await sendPosCellularPaymentDueNotice(DUE)
    // 03:00 UTC is the evening before in Chicago.
    expect(JSON.parse(String(mockSent[0]['text']))).toMatchObject({
      'cellular.openedOn': 'November 1, 2026',
      'cellular.turnsOffOn': 'November 15, 2026',
    })
  })

  it('counts as told when nobody holds "Manage billing", and still puts nothing in anyone else’s feed', async () => {
    BILLING.clear()
    try {
      expect(await sendPosCellularPaymentDueNotice(DUE)).toBe(true)
      expect(mockSent).toEqual([])
      expect(mockFeed.flatMap((entry) => entry.uids)).toEqual([])
    } finally {
      BILLING.add('uid-owner')
      BILLING.add('uid-billing')
    }
  })

  it('sends a banned account nothing, and says nobody was told', async () => {
    fakeDocs.set('orgs/org-1', { ...mockOrg, suspendedAt: 1, suspendedReasonCode: 'abuse' })
    expect(await sendPosCellularPaymentDueNotice(DUE)).toBe(false)
    expect(mockSent).toEqual([])
    expect(mockFeed).toEqual([])
  })
})

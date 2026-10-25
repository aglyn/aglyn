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

import {
  HOLDING_STATUSES,
  nextRenewalAtMs,
  registrationView,
  type DomainRegistrationDoc,
} from './registration'

/** What an owner sees of a registration (AGL-3962, AGL-4040). */

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-01T00:00:00Z')

const DOC = {
  domain: 'testbakery.com',
  orgId: 'org-1',
  hostId: null,
  registrar: 'vercel',
  status: 'active',
  autoRenew: true,
  firstYearCents: 1599,
  renewalCents: 1599,
  costUsd: 11.25,
  renewalCostUsd: 11.25,
  expiresAtMs: NOW + 200 * DAY,
  registrant: { name: 'Alex Test', email: 'alex@testbakery.com' },
  registrantContact: {
    firstName: 'Alex', lastName: 'Test', email: 'alex@testbakery.com', phone: '+1.5125550123',
    address1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US',
  },
  contactChange: { updatedAtMs: NOW - DAY, updatedBy: 'user-1' },
  contactVerification: { verified: true, checkedAtMs: NOW },
  createdBy: 'user-1',
  createdAtMs: NOW,
  updatedAtMs: NOW,
  history: [],
} as unknown as DomainRegistrationDoc

describe('registrationView', () => {
  it('never carries the stored contact, the costs or the invoices', () => {
    const view = registrationView(DOC) as unknown as Record<string, unknown>
    for (const field of ['registrantContact', 'costUsd', 'renewalCostUsd', 'invoiceIds', 'purchaseInvoiceId']) {
      expect(field in view).toBe(false)
    }
    expect(JSON.stringify(view)).not.toContain('1 Main St')
  })

  it('says a contact change is waiting, and the ICANN check as read', () => {
    const view = registrationView(DOC)
    expect(view.contactPendingSinceMs).toBe(NOW - DAY)
    expect(view.contactVerified).toBe(true)
    expect(registrationView({ ...DOC, contactVerification: undefined }).contactVerified).toBeNull()
    expect(view.origin).toBe('purchase')
  })

  it('shows a transfer’s status only while it runs', () => {
    const moving = {
      ...DOC,
      status: 'transferring-in',
      origin: 'transfer-in',
      transfer: { orderId: 'o', startedAtMs: NOW, lastStatus: 'pending_unlock' },
    } as DomainRegistrationDoc
    expect(registrationView(moving)).toMatchObject({
      status: 'transferring-in',
      origin: 'transfer-in',
      transferStatus: 'pending_unlock',
      transferStartedAtMs: NOW,
    })
    expect(registrationView({ ...moving, status: 'active' }).transferStatus).toBeNull()
    expect(HOLDING_STATUSES).toContain('transferring-in')
  })
})

describe('nextRenewalAtMs', () => {
  it('is about 30 days before expiry, never in the past, and null without auto-renew', () => {
    const view = registrationView(DOC)
    expect(nextRenewalAtMs(view, NOW)).toBe(NOW + 170 * DAY)
    expect(nextRenewalAtMs({ ...view, expiresAtMs: NOW + 10 * DAY }, NOW)).toBe(NOW)
    expect(nextRenewalAtMs({ ...view, autoRenew: false }, NOW)).toBeNull()
    expect(nextRenewalAtMs({ ...view, status: 'expired' }, NOW)).toBeNull()
  })
})

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
 * THE SITE CARE RECONCILIATION'S COMPARISON (AGL-3959). Pure: requests as
 * recorded against Stripe's items as listed. Each finding code is produced
 * by the case that names it, and a clean month produces none.
 */

import { siteCareExtraTimeCents, type SiteCareCharge, type SiteCareRequest } from '@aglyn/aglyn/app-utils/site-care'
import { compareSiteCareCharges } from './site-care-reconcile'
import type { StripeExtraTimeItem } from './site-care-stripe'

jest.mock('./org-billing', () => ({ __esModule: true, readOrgBilling: async () => ({}) }))
jest.mock('./notifications', () => ({ __esModule: true, notifyStaff: async () => undefined }))
jest.mock('./operator-alerts', () => ({ __esModule: true, raiseOperatorAlert: async () => ({ outcome: 'raised' }) }))
jest.mock('./site-care-emails', () => ({ __esModule: true, sendSiteCareEmail: async () => ({ sent: false }) }))

function charge(over: Partial<SiteCareCharge> = {}): SiteCareCharge {
  return {
    status: 'pending',
    hours: 1,
    amountCents: siteCareExtraTimeCents(1),
    description: 'Site Care extra time',
    idempotencyKey: 'site-care:t1:charge:1',
    invoiceItemId: 'ii_1',
    invoiceId: null,
    creditNoteId: null,
    refundId: null,
    error: null,
    updatedAtMs: 0,
    ...over,
  }
}

function row(id: string, over: Partial<SiteCareRequest> = {}) {
  const request = {
    source: 'console',
    hostId: null,
    requesterEmail: null,
    state: 'closed',
    month: '2026-10',
    timerStartedAtMs: null,
    timerStartedByUid: null,
    closedAtMs: 1,
    minutesLogged: 90,
    timerMinutes: null,
    countedMinutes: 90,
    includedMinutesUsed: 60,
    overMinutes: 30,
    billedHours: 1,
    absorbed: false,
    approval: null,
    charge: charge(),
    chargeSeq: 1,
    publish: null,
    ...over,
  } as SiteCareRequest
  return { id, orgId: 'org-1', subject: `Request ${id}`, request }
}

function item(over: Partial<StripeExtraTimeItem> = {}): StripeExtraTimeItem {
  return {
    id: 'ii_1',
    amountCents: 7_900,
    quantity: 1,
    description: 'Site Care extra time',
    requestId: 't1',
    month: '2026-10',
    ...over,
  }
}

const codes = (findings: Array<{ code: string }>) => findings.map((finding) => finding.code)

describe('compareSiteCareCharges', () => {
  it('finds nothing when the record and Stripe agree', () => {
    expect(compareSiteCareCharges({ orgId: 'org-1', requests: [row('t1')], items: [item()] })).toEqual([])
  })

  it('reports an item edited in the Stripe dashboard', () => {
    const findings = compareSiteCareCharges({
      orgId: 'org-1',
      requests: [row('t1')],
      items: [item({ amountCents: 9_900, quantity: 2, description: 'edited' })],
    })
    expect(codes(findings)).toContain('item-mismatch')
    expect(findings[0].detail).toContain('amount 9900 ≠ 7900')
    expect(findings[0].detail).toContain('quantity 2 ≠ 1')
    expect(findings[0].detail).toContain('description differs')
  })

  it('reports a pending charge whose item is gone, and the month total that follows', () => {
    expect(codes(compareSiteCareCharges({ orgId: 'org-1', requests: [row('t1')], items: [] }))).toEqual([
      'item-missing',
      'month-total',
    ])
    const deleted = compareSiteCareCharges({
      orgId: 'org-1',
      requests: [row('t1')],
      items: [],
      readItems: new Map([['ii_1', { deleted: true, item: null }]]),
    })
    expect(codes(deleted)).toContain('item-missing')
  })

  it('reports a charge stuck in creating, naming the item Stripe made', () => {
    const findings = compareSiteCareCharges({
      orgId: 'org-1',
      requests: [row('t1', { charge: charge({ status: 'creating', invoiceItemId: null }) })],
      items: [item()],
    })
    expect(codes(findings)).toEqual(['charge-stuck'])
    expect(findings[0].detail).toContain('ii_1 exists')
  })

  it('reports a failed charge still owing hours', () => {
    expect(
      codes(
        compareSiteCareCharges({
          orgId: 'org-1',
          requests: [row('t1', { charge: charge({ status: 'failed', invoiceItemId: null, error: 'card' }) })],
          items: [],
        }),
      ),
    ).toEqual(['charge-failed'])
  })

  it('reports billed hours with no charge, and hours that differ from the charge', () => {
    expect(codes(compareSiteCareCharges({ orgId: 'org-1', requests: [row('t1', { charge: null })], items: [] }))).toEqual([
      'hours-mismatch',
    ])
    expect(
      codes(compareSiteCareCharges({ orgId: 'org-1', requests: [row('t1', { billedHours: 2 })], items: [item()] })),
    ).toEqual(['hours-mismatch'])
  })

  it('reports a voided charge whose item is still in Stripe', () => {
    expect(
      codes(
        compareSiteCareCharges({
          orgId: 'org-1',
          requests: [row('t1', { charge: charge({ status: 'voided' }) })],
          items: [item()],
        }),
      ),
    ).toEqual(['item-not-voided'])
  })

  it('reports a Stripe item no request records', () => {
    const findings = compareSiteCareCharges({
      orgId: 'org-1',
      requests: [row('t1')],
      items: [item(), item({ id: 'ii_stray', requestId: 't9' })],
    })
    expect(codes(findings)).toEqual(['item-without-row'])
    expect(findings[0]).toEqual(expect.objectContaining({ requestId: 't9', month: '2026-10' }))
  })

  it('leaves credited and refunded charges alone', () => {
    expect(
      compareSiteCareCharges({
        orgId: 'org-1',
        requests: [
          row('t1', { charge: charge({ status: 'credited' }) }),
          row('t2', { charge: charge({ status: 'refunded', invoiceItemId: 'ii_2' }) }),
        ],
        items: [item(), item({ id: 'ii_2', requestId: 't2' })],
      }),
    ).toEqual([])
  })
})

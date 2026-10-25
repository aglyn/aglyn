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

import type { OwnerApprovalRecord } from '@aglyn/aglyn/app-utils/owner-approval-record'
import { siteCareExtraTimeCents, type SiteCareCharge, type SiteCareRequest } from '@aglyn/aglyn/app-utils/site-care'
import { compareSiteCareCharges, compareSiteCareLedger, reconcileSiteCare, siteCareLedgerHours } from './site-care-reconcile'
import type { StripeExtraTimeItem } from './site-care-stripe'

jest.mock('./org-billing', () => ({ __esModule: true, readOrgBilling: async () => ({}) }))
jest.mock('./notifications', () => ({ __esModule: true, notifyStaff: async () => undefined }))
jest.mock('./operator-alerts', () => ({ __esModule: true, raiseOperatorAlert: async () => ({ outcome: 'raised' }) }))
jest.mock('./site-care-emails', () => ({ __esModule: true, sendSiteCareEmail: async () => ({ sent: false }) }))
jest.mock('./site-care-project-reconcile', () => ({
  __esModule: true,
  reconcileSiteCareProjects: async () => ({ projects: 0, findings: [], errors: [] }),
}))

function approval(hours: number): OwnerApprovalRecord {
  return {
    hours,
    rateUsd: 79,
    channel: 'phone',
    approvedAtMs: 1,
    recordedAtMs: 1,
    recordedByUid: 'staff-1',
    recordedByEmail: null,
    note: null,
    version: 1,
    corrected: false,
    correctionReason: null,
  } as OwnerApprovalRecord
}

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
    approval: approval(1),
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
    // 2 h recorded on 30 minutes of over-time with 1 h approved: the charge
    // and Stripe agree on 1 h, and the ledger says the record is the one off.
    expect(
      codes(compareSiteCareCharges({ orgId: 'org-1', requests: [row('t1', { billedHours: 2 })], items: [item()] })),
    ).toEqual(['hours-mismatch', 'ledger-hours'])
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
        // Two requests that each used a full hour: the month had an hour of goodwill.
        goodwillByMonth: new Map([['2026-10', 60]]),
      }),
    ).toEqual([])
  })
})

describe('siteCareLedgerHours', () => {
  it('bills whole started hours of over-time, never below the approval, nothing within the hour or absorbed', () => {
    const base = row('t1').request
    expect(siteCareLedgerHours({ ...base, overMinutes: 15, approval: approval(1) })).toBe(1)
    expect(siteCareLedgerHours({ ...base, overMinutes: 70, approval: approval(2) })).toBe(2)
    expect(siteCareLedgerHours({ ...base, overMinutes: 30, approval: approval(3) })).toBe(3)
    expect(siteCareLedgerHours({ ...base, overMinutes: 0, approval: approval(3) })).toBe(0)
    expect(siteCareLedgerHours({ ...base, overMinutes: 90, approval: null, absorbed: true })).toBe(0)
    expect(siteCareLedgerHours({ ...base, overMinutes: 90, approval: null })).toBeNull()
    expect(siteCareLedgerHours({ ...base, overMinutes: 90, approval: approval(1) })).toBeNull()
  })
})

describe('compareSiteCareLedger', () => {
  const ledger = (requests: ReturnType<typeof row>[], goodwill?: Map<string, number>) =>
    compareSiteCareLedger({ orgId: 'org-1', requests, goodwillByMonth: goodwill })

  it('finds nothing in a request whose minutes, approval and charge agree', () => {
    expect(ledger([row('t1')])).toEqual([])
    expect(
      ledger([row('t2', { minutesLogged: 40, countedMinutes: 45, includedMinutesUsed: 45, overMinutes: 0, billedHours: 0, charge: null })]),
    ).toEqual([])
  })

  it('reports a pending charge, and the Stripe item that matches it, for more than the logged time comes to', () => {
    // 30 minutes over with 1 h approved is 1 h ($79); the record, the charge
    // and Stripe all say 2 h ($158).
    const drifted = row('t1', { billedHours: 2, charge: charge({ hours: 2, amountCents: siteCareExtraTimeCents(2) }) })
    const findings = compareSiteCareCharges({
      orgId: 'org-1',
      requests: [drifted],
      items: [item({ amountCents: 15_800, quantity: 2 })],
    })
    expect(codes(findings)).toEqual(['ledger-amount', 'ledger-hours', 'ledger-hours', 'month-ledger'])
    expect(findings[0].detail).toContain('Stripe will invoice 15800 cents; the logged time and approval come to 7900')
    expect(findings.find((finding) => finding.code === 'month-ledger')?.detail).toContain('record 15800 cents')
  })

  it('reports a charge whose amount is not its hours at the rate', () => {
    const findings = ledger([row('t1', { charge: charge({ amountCents: 9_900 }) })])
    expect(codes(findings)).toEqual(['ledger-amount', 'month-ledger'])
    expect(findings[0].detail).toContain('records 9900 cents for 1 h, which is 7900')
  })

  it('reports extra time billed with no approval, or past the approval, and over-time neither billed nor absorbed', () => {
    expect(codes(ledger([row('t1', { approval: null })]))).toEqual(['ledger-unapproved', 'month-ledger'])
    expect(
      codes(ledger([row('t1', { overMinutes: 90, countedMinutes: 150, minutesLogged: 150, billedHours: 2, charge: charge({ hours: 2, amountCents: siteCareExtraTimeCents(2) }) })])),
    ).toEqual(['ledger-unapproved', 'month-ledger'])
    expect(codes(ledger([row('t1', { approval: null, billedHours: 0, charge: null })]))).toEqual(['ledger-unapproved'])
    expect(ledger([row('t1', { approval: null, billedHours: 0, absorbed: true, charge: null })])).toEqual([])
  })

  it('reports minutes that do not add up, and a month that used more than its allowance', () => {
    expect(codes(ledger([row('t1', { countedMinutes: 75 })]))).toEqual(['ledger-minutes'])
    const twice = [row('t1'), row('t2', { charge: charge({ invoiceItemId: 'ii_2' }) })]
    expect(codes(ledger(twice))).toEqual(['ledger-minutes'])
    expect(ledger(twice, new Map([['2026-10', 60]]))).toEqual([])
  })

  it('leaves reversed charges to the request: voided, credited and refunded owe nothing', () => {
    expect(
      ledger(
        [
          row('t1', { charge: charge({ status: 'voided' }) }),
          row('t2', { billedHours: 0, absorbed: true, charge: charge({ status: 'credited', invoiceItemId: 'ii_2' }) }),
        ],
        new Map([['2026-10', 60]]),
      ),
    ).toEqual([])
  })
})

describe('reconcileSiteCare', () => {
  function fakeFirestore(docs: Record<string, Record<string, unknown>>, tickets: Array<{ id: string; data: Record<string, unknown> }>) {
    const docRef = (path: string): unknown => ({
      get: async () => ({ exists: path in docs, get: (field: string) => docs[path]?.[field] }),
      collection: (name: string) => collectionRef(`${path}/${name}`),
    })
    const collectionRef = (path: string): unknown => ({
      doc: (id: string) => docRef(`${path}/${id}`),
      where: () => ({
        limit: () => ({
          get: async () => ({
            docs: path === 'supportTickets' ? tickets.map((t) => ({ id: t.id, get: (field: string) => t.data[field] })) : [],
          }),
        }),
      }),
    })
    return { collection: (name: string) => collectionRef(name) } as unknown as FirebaseFirestore.Firestore
  }

  it('checks a workspace with no charge against its own ledger, with its goodwill, without Stripe', async () => {
    const nowMs = Date.UTC(2026, 9, 20, 18)
    const overTime = { ...row('t1', { approval: null, billedHours: 0, charge: null }).request }
    const firestore = fakeFirestore(
      { 'orgs/org-1/siteCareMonths/2026-10': { goodwillMinutes: 30 } },
      [{ id: 't1', data: { orgId: 'org-1', subject: 'Hours', siteCare: overTime } }],
    )
    const report = await reconcileSiteCare(firestore, { nowMs, dryRun: true })
    expect(report.errors).toEqual([])
    expect(report.findings.map((finding) => finding.code)).toEqual(['ledger-unapproved'])
    expect(report.findings[0]).toEqual(expect.objectContaining({ orgId: 'org-1', month: '2026-10', requestId: 't1' }))
  })
})

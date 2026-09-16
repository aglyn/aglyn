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
 * MOVING A WORKSPACE'S OVERAGE STANDING (AGL-3011).
 *
 * Every write to the document the gate reads on each request past the band.
 * The cases worth proving are the ones where two facts arrive close together
 * and the wrong one wins: a renewal paid while an AI charge is still open, a
 * dispute landing behind a failed charge, the same month counted twice.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

import {
  dropAiOverageQualifyingMonth,
  pauseAiOverage,
  recordAiOverageDispute,
  recordAiOveragePaidInvoice,
  recordAiOveragePaymentMethod,
  resetAiOverageStep,
  resumeAiOverage,
  setAiOverageStaffOverride,
} from './ai-overage-standing-writes'
import { readAiOverageStanding } from './ai-overage-standing'

let docs = new Map<string, Record<string, unknown>>()
const STANDING = 'orgs/org-1/aiBilling/standing'
const NOW = new Date('2026-10-16T12:00:00.000Z')

function makeFirestore(): FirebaseFirestore.Firestore {
  const makeDoc = (path: string) => ({
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
  })
  const makeCollection = (path: string) => ({
    doc: (id: string) => makeDoc(`${path}/${id}`),
  })
  return {
    collection: (name: string) => makeCollection(name),
    runTransaction: async <T,>(
      fn: (tx: {
        get: (ref: { path: string }) => Promise<unknown>
        set: (ref: { path: string }, data: Record<string, unknown>) => void
      }) => Promise<T>,
    ): Promise<T> => {
      const queued: Array<() => void> = []
      const result = await fn({
        get: async (ref) => ({
          exists: docs.has(ref.path),
          data: () => docs.get(ref.path),
          get: (field: string) => (docs.get(ref.path) ?? {})[field],
        }),
        set: (ref, data) => {
          queued.push(() => {
            docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data })
          })
        },
      })
      for (const write of queued) write()
      return result
    },
  } as unknown as FirebaseFirestore.Firestore
}

function standing() {
  return readAiOverageStanding(docs.get(STANDING) ?? null)
}

beforeEach(() => {
  docs = new Map()
})

describe('pausing', () => {
  it('keeps the FIRST reason, so the sentence keeps naming what to pay', async () => {
    const db = makeFirestore()
    await pauseAiOverage(db, 'org-1', {
      reason: 'charge_failed',
      invoiceId: 'in_1',
      now: NOW,
    })
    await pauseAiOverage(db, 'org-1', { reason: 'past_due', now: NOW })
    expect(standing().pause).toMatchObject({ reason: 'charge_failed', invoiceId: 'in_1' })
  })

  it('lets a dispute take over any other pause', async () => {
    const db = makeFirestore()
    await pauseAiOverage(db, 'org-1', { reason: 'past_due', now: NOW })
    await pauseAiOverage(db, 'org-1', { reason: 'dispute', now: NOW })
    expect(standing().pause?.reason).toBe('dispute')
  })
})

describe('resuming', () => {
  it('lifts only the pause the paid invoice set', async () => {
    const db = makeFirestore()
    await pauseAiOverage(db, 'org-1', {
      reason: 'charge_failed',
      invoiceId: 'in_1',
      now: NOW,
    })
    await resumeAiOverage(db, 'org-1', { invoiceId: 'in_other' })
    expect(standing().pause?.reason).toBe('charge_failed')
    await resumeAiOverage(db, 'org-1', { invoiceId: 'in_1' })
    expect(standing().pause).toBeNull()
  })

  it('lets a paid renewal clear past_due and NOT a failed AI charge', async () => {
    // The case that would otherwise let the unpaid balance grow: the AI
    // invoice is still open, and a renewal paying has nothing to do with it.
    const db = makeFirestore()
    await pauseAiOverage(db, 'org-1', {
      reason: 'charge_failed',
      invoiceId: 'in_ai',
      now: NOW,
    })
    await resumeAiOverage(db, 'org-1', { reason: 'past_due' })
    expect(standing().pause?.reason).toBe('charge_failed')

    docs.delete(STANDING)
    await pauseAiOverage(db, 'org-1', { reason: 'past_due', now: NOW })
    await resumeAiOverage(db, 'org-1', { reason: 'past_due' })
    expect(standing().pause).toBeNull()
  })

  it('never lifts a dispute pause except by force', async () => {
    const db = makeFirestore()
    await pauseAiOverage(db, 'org-1', { reason: 'dispute', now: NOW })
    await resumeAiOverage(db, 'org-1', {})
    await resumeAiOverage(db, 'org-1', { reason: 'dispute' })
    expect(standing().pause?.reason).toBe('dispute')
    await resumeAiOverage(db, 'org-1', { force: true })
    expect(standing().pause).toBeNull()
  })
})

describe('payment history', () => {
  it('takes the first payment as the baseline, not a step', async () => {
    const db = makeFirestore()
    await recordAiOveragePaidInvoice(db, 'org-1', {
      month: '2026-09',
      amountPaidCents: 4900,
      paidOutOfBand: false,
    })
    expect(standing().firstPaidMonth).toBe('2026-09')
    expect(standing().qualifyingMonths).toEqual([])
  })

  it('counts each later month once, however many invoices it had', async () => {
    const db = makeFirestore()
    docs.set(STANDING, { firstPaidMonth: '2026-08' })
    for (let i = 0; i < 4; i += 1) {
      await recordAiOveragePaidInvoice(db, 'org-1', {
        month: '2026-09',
        amountPaidCents: 2500,
        paidOutOfBand: false,
      })
    }
    // Counting INVOICES would reach the top of the ladder in an afternoon:
    // threshold charges can arrive several times a day.
    expect(standing().qualifyingMonths).toEqual(['2026-09'])
    expect(docs.get(STANDING)?.['step']).toBe(1)
  })

  it('ignores a payment that is not evidence money moved', async () => {
    const db = makeFirestore()
    docs.set(STANDING, { firstPaidMonth: '2026-08' })
    await recordAiOveragePaidInvoice(db, 'org-1', {
      month: '2026-09',
      amountPaidCents: 4900,
      paidOutOfBand: true,
    })
    await recordAiOveragePaidInvoice(db, 'org-1', {
      month: '2026-09',
      amountPaidCents: 0,
      paidOutOfBand: false,
    })
    expect(standing().qualifyingMonths).toEqual([])
  })

  it('takes a month back off when it ended with an AI charge unpaid', async () => {
    const db = makeFirestore()
    docs.set(STANDING, { firstPaidMonth: '2026-07', qualifyingMonths: ['2026-08', '2026-09'] })
    await dropAiOverageQualifyingMonth(db, 'org-1', '2026-09')
    expect(standing().qualifyingMonths).toEqual(['2026-08'])
    expect(docs.get(STANDING)?.['step']).toBe(1)
  })
})

describe('a dispute', () => {
  it('resets the ladder AND pauses, and records when', async () => {
    const db = makeFirestore()
    docs.set(STANDING, {
      firstPaidMonth: '2026-06',
      qualifyingMonths: ['2026-07', '2026-08'],
      step: 2,
    })
    await recordAiOverageDispute(db, 'org-1', NOW)
    const after = standing()
    expect(after.qualifyingMonths).toEqual([])
    expect(after.firstPaidMonth).toBeNull()
    expect(after.pause?.reason).toBe('dispute')
    expect(after.lastDisputeAt).toBe(NOW.toISOString())
    expect(docs.get(STANDING)?.['step']).toBe(0)
  })
})

describe('the payment method mirror', () => {
  it('records a real answer, including "no default"', async () => {
    const db = makeFirestore()
    await recordAiOveragePaymentMethod(db, 'org-1', 'card')
    expect(standing().paymentMethodType).toBe('card')
    await recordAiOveragePaymentMethod(db, 'org-1', null)
    // A real answer, and it must be STORED — "no default" is a fact about the
    // workspace, where an absent field means nobody has looked.
    expect(docs.get(STANDING)).toHaveProperty('paymentMethodType', null)
    expect(standing().paymentMethodType).toBeNull()
  })

  it('writes nothing when the answer has not changed', async () => {
    const db = makeFirestore()
    await recordAiOveragePaymentMethod(db, 'org-1', 'card')
    const first = docs.get(STANDING)
    await recordAiOveragePaymentMethod(db, 'org-1', 'card')
    expect(docs.get(STANDING)).toBe(first)
  })
})

describe('staff', () => {
  it('sets and clears a ceiling override with its reason and expiry', async () => {
    const db = makeFirestore()
    await setAiOverageStaffOverride(
      db,
      'org-1',
      { ceilingUsd: 750, reason: 'launch week', setBy: 'staff-1', expiresAt: null },
      NOW,
    )
    expect(standing().staffOverride).toMatchObject({
      ceilingUsd: 750,
      reason: 'launch week',
      setBy: 'staff-1',
      expiresAt: null,
    })
    await setAiOverageStaffOverride(db, 'org-1', null, NOW)
    expect(standing().staffOverride).toBeNull()
  })

  it('resets the step without pausing — a correction is not a chargeback', async () => {
    const db = makeFirestore()
    docs.set(STANDING, { qualifyingMonths: ['2026-07', '2026-08'], step: 2 })
    await resetAiOverageStep(db, 'org-1')
    expect(standing().qualifyingMonths).toEqual([])
    expect(standing().pause).toBeNull()
  })
})

/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * Credits given back (AGL-3595): the meter arithmetic every reader shares,
 * the one writer's bounds and key, and the property the whole control exists
 * for — a Free workspace at its wall is admitted again once staff give the
 * credits back, on both the workspace band and the owner's allowance.
 *
 * The fake below models `increment` and deep `set(merge)` the way Firestore
 * does: a fake that replaced instead of adding would fabricate a green meter.
 */

let mockDocs = new Map<string, Record<string, unknown>>()

const isPlainMap = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  !('__inc' in (value as object))

function mockApply(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const base = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    const inc = (value as { __inc?: number } | null)?.__inc
    if (typeof inc === 'number') base[key] = Number(base[key] ?? 0) + inc
    else if (isPlainMap(value)) {
      base[key] = mockApply(isPlainMap(base[key]) ? base[key] : undefined, value, true)
    } else base[key] = value
  }
  return base
}

const mockSnapshot = (path: string) => ({
  exists: mockDocs.has(path),
  data: () => mockDocs.get(path),
  get: (field: string) => (mockDocs.get(path) ?? {})[field],
})

function mockFirestore(): any {
  const doc = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
  })
  const collection = (prefix: string): any => ({
    doc: (id: string) => doc(`${prefix}/${id}`),
  })
  return {
    collection,
    runTransaction: async <T,>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const queued: Array<() => void> = []
      const tx = {
        get: async (ref: { path: string }) => mockSnapshot(ref.path),
        set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          queued.push(() =>
            mockDocs.set(ref.path, mockApply(mockDocs.get(ref.path), data, Boolean(options?.merge))),
          )
        },
      }
      const result = await fn(tx)
      for (const write of queued) write()
      return result
    },
  }
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/staff-alert-email', () => ({
  __esModule: true,
  sendStaffAlertEmail: async () => ({ sent: true }),
}))

jest.mock('./ai-allotment-alerts', () => ({
  __esModule: true,
  announceAiAllotmentAlerts: async () => 0,
}))

import {
  assistMonthSpendUsd,
  assistReturnableCredits,
  assistReturnedCredits,
  assistSpendAfterReturnsUsd,
} from './assist-credit-returns'
import {
  accountCreditMeter,
  returnAssistCredits,
  workspaceCreditMeter,
} from './assist-credit-returns-write'
import { reserveAssistMessage } from './assist-usage'

const NOW = new Date('2026-10-06T15:00:00Z')
const MONTH = '2026-10'
const ORG = 'IuH0x_G1kT'
const OWNER = 'owner-1'
const ORG_MONTH = `orgs/${ORG}/assistUsage/${MONTH}`
const ACCOUNT_MONTH = `users/${OWNER}/aiUsage/${MONTH}`
const FREE = { plan: 'free' as const, ownerUid: OWNER }

const request = (overrides: Partial<Parameters<typeof returnAssistCredits>[1]> = {}) => {
  const firestore = mockFirestore()
  return {
    firestore,
    request: {
      month: MONTH,
      meters: [
        workspaceCreditMeter(firestore, ORG, MONTH),
        accountCreditMeter(firestore, OWNER, MONTH),
      ],
      credits: 227 as number | 'all',
      key: 'key-0000-0001',
      reason: 'Planner refused the plan after spending (AGL-3595)',
      actorUid: 'staff-1',
      source: 'staff',
      jobId: 'job-1',
      ...overrides,
    },
  }
}

beforeEach(() => {
  mockDocs = new Map()
})

describe('the adjusted meter (AGL-3595)', () => {
  it('takes what was given back off what was spent', () => {
    expect(assistSpendAfterReturnsUsd(0.227, 0.2)).toBe(0.027)
    expect(assistMonthSpendUsd({ estCostUsd: 0.3, returnedUsd: 0.1 })).toBe(0.2)
  })

  it('never reads below zero, however much was returned', () => {
    expect(assistSpendAfterReturnsUsd(0.1, 0.5)).toBe(0)
    expect(assistMonthSpendUsd({ returnedUsd: 1 })).toBe(0)
  })

  it('reads a document with nothing given back as its spend, and junk as nothing', () => {
    expect(assistMonthSpendUsd({ estCostUsd: 0.227 })).toBe(0.227)
    expect(assistSpendAfterReturnsUsd('junk', undefined)).toBe(0)
    expect(assistMonthSpendUsd(null)).toBe(0)
  })

  it('a give-back of exactly the spend reads as zero credits, not a float’s residue rounded up', () => {
    // 0.3 - 0.1 is 0.19999999999999998 in floating point; rounded up into
    // credits unrounded, that would read one credit too many.
    expect(assistReturnableCredits({ estCostUsd: 0.3, returnedUsd: 0.1 })).toBe(200)
    expect(assistReturnableCredits({ estCostUsd: 0.2275, returnedUsd: 0.2275 })).toBe(0)
  })

  it('counts what was given back in whole credits', () => {
    expect(assistReturnedCredits({ returnedUsd: 0.227 })).toBe(227)
    expect(assistReturnedCredits({})).toBe(0)
  })
})

describe('returnAssistCredits — the one writer (AGL-3595)', () => {
  it('returns to both meters, keeping the spend and recording the act', async () => {
    mockDocs.set(ORG_MONTH, { estCostUsd: 0.227, messages: 4 })
    mockDocs.set(ACCOUNT_MONTH, { estCostUsd: 0.227, requests: 4 })
    const { firestore, request: input } = request()
    const outcome = await returnAssistCredits(firestore, input)
    expect(outcome.status).toBe('returned')
    expect(outcome.lines.map((line) => [line.meter, line.usedBefore, line.credits])).toEqual([
      ['workspace', 227, 227],
      ['account', 227, 227],
    ])
    // The spend is untouched; the give-back is a second field and a record.
    expect(mockDocs.get(ORG_MONTH)).toMatchObject({
      estCostUsd: 0.227,
      messages: 4,
      returnedUsd: 0.227,
      creditReturns: {
        'key-0000-0001': {
          credits: 227,
          usd: 0.227,
          actorUid: 'staff-1',
          source: 'staff',
          jobId: 'job-1',
          reason: 'Planner refused the plan after spending (AGL-3595)',
        },
      },
    })
    expect(assistReturnableCredits(mockDocs.get(ORG_MONTH))).toBe(0)
    expect(assistReturnableCredits(mockDocs.get(ACCOUNT_MONTH))).toBe(0)
  })

  it('REFUSES to return more than the month used, and writes nothing', async () => {
    mockDocs.set(ORG_MONTH, { estCostUsd: 0.227 })
    mockDocs.set(ACCOUNT_MONTH, { estCostUsd: 0.1 })
    const { firestore, request: input } = request({ credits: 150 })
    const outcome = await returnAssistCredits(firestore, input)
    // 150 fits the workspace's 227 but not the account's 100.
    expect(outcome.status).toBe('over')
    expect(outcome.lines.map((line) => line.usedBefore)).toEqual([227, 100])
    expect(mockDocs.get(ORG_MONTH)).toEqual({ estCostUsd: 0.227 })
    expect(mockDocs.get(ACCOUNT_MONTH)).toEqual({ estCostUsd: 0.1 })
  })

  it('bounds by what is left after EARLIER give-backs, so two cannot add up past the spend', async () => {
    mockDocs.set(ORG_MONTH, { estCostUsd: 0.227 })
    const firestore = mockFirestore()
    const meters = [workspaceCreditMeter(firestore, ORG, MONTH)]
    const base = { month: MONTH, meters, reason: 'r', actorUid: 'staff-1', source: 'staff' }
    expect((await returnAssistCredits(firestore, { ...base, credits: 200, key: 'key-first-01' })).status).toBe('returned')
    expect((await returnAssistCredits(firestore, { ...base, credits: 200, key: 'key-second-1' })).status).toBe('over')
    expect((await returnAssistCredits(firestore, { ...base, credits: 27, key: 'key-third-01' })).status).toBe('returned')
    expect(assistReturnableCredits(mockDocs.get(ORG_MONTH))).toBe(0)
  })

  it('is idempotent on its key: a double-click returns once', async () => {
    mockDocs.set(ORG_MONTH, { estCostUsd: 0.227 })
    mockDocs.set(ACCOUNT_MONTH, { estCostUsd: 0.227 })
    const { firestore, request: input } = request({ credits: 100 })
    const audit = jest.fn()
    expect((await returnAssistCredits(firestore, input, audit)).status).toBe('returned')
    const again = await returnAssistCredits(firestore, input, audit)
    expect(again.status).toBe('duplicate')
    expect(audit).toHaveBeenCalledTimes(1)
    expect(mockDocs.get(ORG_MONTH)?.['returnedUsd']).toBe(0.1)
    expect(mockDocs.get(ACCOUNT_MONTH)?.['returnedUsd']).toBe(0.1)
  })

  it('a reset returns each meter its OWN figure, never past its spend', async () => {
    mockDocs.set(ORG_MONTH, { estCostUsd: 0.2275 })
    mockDocs.set(ACCOUNT_MONTH, { estCostUsd: 0.29 })
    const { firestore, request: input } = request({ credits: 'all' })
    const outcome = await returnAssistCredits(firestore, input)
    expect(outcome.lines.map((line) => [line.meter, line.credits])).toEqual([
      ['workspace', 228],
      ['account', 290],
    ])
    // The fraction of the rounded-up credit is not banked against next spend.
    expect(mockDocs.get(ORG_MONTH)?.['returnedUsd']).toBe(0.2275)
  })

  it('answers `nothing` for a month with nothing used', async () => {
    const { firestore, request: input } = request({ credits: 'all' })
    expect((await returnAssistCredits(firestore, input)).status).toBe('nothing')
    expect(mockDocs.size).toBe(0)
  })

  it('refuses a malformed key or amount before reading anything', async () => {
    const { firestore, request: input } = request()
    await expect(returnAssistCredits(firestore, { ...input, key: 'x' })).rejects.toThrow('key')
    await expect(returnAssistCredits(firestore, { ...input, credits: 1.5 })).rejects.toThrow('whole')
    await expect(returnAssistCredits(firestore, { ...input, credits: 0 })).rejects.toThrow('whole')
  })
})

describe('the reservation admits again after a give-back at a Free wall (AGL-3595)', () => {
  it('the WORKSPACE band: refused at 300, admitted once credits are given back', async () => {
    const firestore = mockFirestore()
    mockDocs.set(ORG_MONTH, { messages: 4, estCostUsd: 0.3 })
    const refused = await reserveAssistMessage(firestore, ORG, false, NOW, FREE)
    expect(refused).toMatchObject({ allowed: false, refusedBy: 'band' })

    await returnAssistCredits(firestore, {
      month: MONTH,
      meters: [workspaceCreditMeter(firestore, ORG, MONTH)],
      credits: 227,
      key: 'key-band-0001',
      reason: 'r',
      actorUid: 'staff-1',
      source: 'staff',
    })
    const admitted = await reserveAssistMessage(firestore, ORG, false, NOW, FREE)
    expect(admitted).toMatchObject({ allowed: true, refusedBy: null })
    // The figure the usage strip is built from is the adjusted one.
    expect(admitted.costUsd).toBe(0.073)
  })

  it('the OWNER’s allowance: refused as `account`, admitted once it is given back', async () => {
    const firestore = mockFirestore()
    mockDocs.set(ACCOUNT_MONTH, { estCostUsd: 0.3 })
    const refused = await reserveAssistMessage(firestore, ORG, false, NOW, FREE)
    expect(refused).toMatchObject({ allowed: false, refusedBy: 'account' })

    await returnAssistCredits(firestore, {
      month: MONTH,
      meters: [accountCreditMeter(firestore, OWNER, MONTH)],
      credits: 'all',
      key: 'key-acct-0001',
      reason: 'r',
      actorUid: 'staff-1',
      source: 'staff',
    })
    const admitted = await reserveAssistMessage(firestore, ORG, false, NOW, FREE)
    expect(admitted).toMatchObject({ allowed: true, refusedBy: null })
  })

  it('THE NEGATIVE CONTROL: a give-back to the OTHER meter leaves the wall standing', async () => {
    const firestore = mockFirestore()
    mockDocs.set(ACCOUNT_MONTH, { estCostUsd: 0.3 })
    mockDocs.set(ORG_MONTH, { estCostUsd: 0.1 })
    await returnAssistCredits(firestore, {
      month: MONTH,
      meters: [workspaceCreditMeter(firestore, ORG, MONTH)],
      credits: 100,
      key: 'key-wrong-001',
      reason: 'r',
      actorUid: 'staff-1',
      source: 'staff',
    })
    const still = await reserveAssistMessage(firestore, ORG, false, NOW, FREE)
    expect(still).toMatchObject({ allowed: false, refusedBy: 'account' })
  })
})

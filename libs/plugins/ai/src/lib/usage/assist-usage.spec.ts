/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * Aglyn Assist metering (AGL-1860): the free daily cap and the entitled
 * monthly runaway guard must both be able to go RED, and the exchange batch
 * must fold increments correctly — the fake below models Firestore
 * `increment` + `set(merge)` semantics exactly (a fake that replaces
 * instead of adding would fabricate green counters).
 */

import {
  assistMonthOverage,
  assistOwnControlRefusalText,
  assistRefusedByHardCap,
  assistRefusedByOverageCap,
  assistUsdFromCredits,
} from '@aglyn/aglyn/app-utils/assist-credits'
import {
  FREE_AI_TASTE_CREDITS_PER_MONTH,
  PLAN_ENTITLEMENTS,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
  assistOrgMonthlyCostLimitUsd,
} from '@aglyn/aglyn/app-utils/usage-budget'
import {
  aiBilledRatesForModel,
  aiProviderRatesForModel,
} from '../providers/catalog'
import type { AssistRefusedBy } from '@aglyn/aglyn/app-utils/assist-credits'
import type { AiRefusedBy } from '../model/ai-allotments'

/**
 * A reservation's refusal as core's helpers take it. `allotment` is the
 * plugin's own rung (AGL-2942) and none of core's controls, so it reads as
 * no control at all.
 */
const coreRefusal = (refusedBy: AiRefusedBy): AssistRefusedBy =>
  refusedBy === 'allotment' ? null : refusedBy

let mockDocs = new Map<string, Record<string, unknown>>()

/** A map value, as opposed to a sentinel, an array or a scalar. */
function isPlainMap(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    !('__inc' in (value as object))
  )
}

/**
 * Faithful `increment` + merge semantics (the AGL test-double lesson).
 *
 * Maps merge DEEPLY under `{ merge: true }`, with increments applied at
 * their nested path — which is what Firestore does, and what the Free
 * taste's account document (`days.{day}.requests`, AGL-2925) depends on. A
 * fake that replaced the whole `days` map on every write would zero every
 * other day's counters and fabricate a green daily cap.
 */
function applyData(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const base = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    const inc = (value as { __inc?: number } | null)?.__inc
    if (typeof inc === 'number') {
      const current = Number(base[key] ?? 0)
      base[key] = current + inc
    } else if (isPlainMap(value)) {
      const current = merge && isPlainMap(base[key]) ? base[key] : undefined
      base[key] = applyData(current, value, true)
    } else {
      base[key] = value
    }
  }
  return base
}

let mockAutoId = 0

/** Serialises the fake's transactions, one at a time, FIFO. */
let mockTxChain: Promise<void> = Promise.resolve()
function mockTxLock(): Promise<() => void> {
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  const waitFor = mockTxChain
  mockTxChain = mockTxChain.then(() => next)
  return waitFor.then(() => release)
}

function mockMakeFirestore() {
  const makeDoc = (path: string) => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => ({
      exists: mockDocs.has(path),
      data: () => mockDocs.get(path),
      get: (field: string) => (mockDocs.get(path) ?? {})[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, applyData(mockDocs.get(path), data, Boolean(options?.merge)))
    },
    update: async (data: Record<string, unknown>) => {
      if (!mockDocs.has(path)) throw new Error('update on missing doc')
      mockDocs.set(path, applyData(mockDocs.get(path), data, true))
    },
  })
  const makeCollection = (prefix: string) => ({
    doc: (id?: string) => makeDoc(`${prefix}/${id ?? `auto-${++mockAutoId}`}`),
    add: async (data: Record<string, unknown>) => {
      const ref = makeDoc(`${prefix}/auto-${++mockAutoId}`)
      mockDocs.set(ref.path, applyData(undefined, data, false))
      return ref
    },
  })
  return {
    collection: (name: string) => makeCollection(name),
    /**
     * Serializable transactions, faithfully: the callback's reads see a
     * consistent snapshot and its writes land atomically, and two overlapping
     * transactions are ordered rather than interleaved (real Firestore gets
     * there by contention + retry; the outcome is what the code under test
     * depends on). A fake that let two callbacks interleave their read phases
     * would fabricate the very race `reserveAssistMessage` exists to close —
     * it would go GREEN on the broken code.
     */
    runTransaction: async <T,>(
      fn: (tx: {
        get: (ref: { path: string }) => Promise<unknown>
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => void
      }) => Promise<T>,
    ): Promise<T> => {
      const release = await mockTxLock()
      try {
        const queued: Array<() => void> = []
        const tx = {
          get: async (ref: { path: string }) => ({
            exists: mockDocs.has(ref.path),
            data: () => mockDocs.get(ref.path),
            get: (field: string) => (mockDocs.get(ref.path) ?? {})[field],
          }),
          set: (
            ref: { path: string },
            data: Record<string, unknown>,
            options?: { merge?: boolean },
          ) => {
            queued.push(() => {
              mockDocs.set(
                ref.path,
                applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)),
              )
            })
          },
        }
        const result = await fn(tx as never)
        for (const write of queued) write()
        return result
      } finally {
        release()
      }
    },
    batch: () => {
      const queued: Array<() => void> = []
      const batch = {
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          queued.push(() => {
            mockDocs.set(
              ref.path,
              applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)),
            )
          })
          return batch
        },
        commit: async () => {
          for (const write of queued) write()
        },
      }
      return batch
    },
  }
}

// The module under test reads `FieldValue` straight off the SDK (AGL-2073),
// so the sentinel factory is stubbed there rather than on the admin barrel.
// Mocking the barrel would no longer intercept anything, and the tests would
// silently run against real Firestore transforms the fake cannot interpret.
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

/**
 * A soft allotment's crossings (AGL-2942), captured at the lazily loaded
 * module the reservation hands them to — the notification and mail writers
 * behind it are proven in their own suite.
 */
const mockAllotmentAlerts: Array<{ orgId: string; month: string; alerts: unknown[] }> = []
jest.mock('./ai-allotment-alerts', () => ({
  __esModule: true,
  announceAiAllotmentAlerts: async (
    _firestore: unknown,
    input: { orgId: string; month: string; alerts: unknown[] },
  ) => {
    mockAllotmentAlerts.push(input)
    return input.alerts.length
  },
}))

/** The staff mail the platform ceiling sends (AGL-2925), captured. */
const mockStaffAlerts: Array<{ subject: string; text: string; context: string }> = []
jest.mock('@aglyn/tenant-data-admin/server/staff-alert-email', () => ({
  __esModule: true,
  sendStaffAlertEmail: async (input: { subject: string; text: string; context: string }) => {
    mockStaffAlerts.push(input)
    return { sent: true }
  },
}))

const {
  ASSIST_EXCHANGE_RETENTION_DAYS,
  assistEntitledMonthlyLimit,
  assistExchangeExpiry,
  assistFreeDailyLimit,
  assistMonthlyCeilingUsd,
  publicAssistQuota,
  recordAssistCost,
  assistUsageDay,
  assistUsageMonth,
  checkAssistQuota,
  estimateAssistCostUsd,
  estimateAssistProviderCostUsd,
  recordAssistExchange,
  recordAssistFeedback,
  releaseAssistMessage,
  reserveAssistMessage,
} = require('./assist-usage') as typeof import('./assist-usage')
const {
  aiFreeDailyPlatformCeilingUsd,
  aiFreeDailyRequests,
  freeAssistAccount,
  readPlatformFreeSpend,
} = require('./assist-free-taste') as typeof import('./assist-free-taste')

const NOW = new Date('2026-08-17T12:00:00Z')
const ORG = 'org-assist'

/**
 * An org that sells NO assist band (AGL-2925). Every case below about the
 * operator backstop used to pass no org at all, and a plan-less org
 * resolves as Free — which since the Free taste carries a band of its own,
 * a small one that binds long before the $40 default. Starter is the one
 * plan left whose band is genuinely none; `entitled` is a separate
 * argument here, so the same fixture serves the monthly-gated cases too.
 */
const NO_BAND = { plan: 'starter' as const }

const firestore = () =>
  mockMakeFirestore() as unknown as FirebaseFirestore.Firestore

beforeEach(() => {
  mockDocs = new Map()
  mockAutoId = 0
  mockStaffAlerts.length = 0
  delete process.env.ASSIST_FREE_DAILY_LIMIT
  delete process.env.ASSIST_ENTITLED_MONTHLY_LIMIT
  delete process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD
  delete process.env.AI_FREE_DAILY_REQUESTS
  delete process.env.AI_FREE_DAILY_PLATFORM_CEILING_USD
})

describe('period keys and limits', () => {
  it('derives UTC month and day keys', () => {
    expect(assistUsageMonth(NOW)).toBe('2026-08')
    expect(assistUsageDay(NOW)).toBe('2026-08-17')
  })

  it('defaults, and honors env overrides', () => {
    expect(assistFreeDailyLimit()).toBe(10)
    expect(assistEntitledMonthlyLimit()).toBe(1000)
    process.env.ASSIST_FREE_DAILY_LIMIT = '3'
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '50'
    expect(assistFreeDailyLimit()).toBe(3)
    expect(assistEntitledMonthlyLimit()).toBe(50)
  })

  it('ignores junk env values', () => {
    process.env.ASSIST_FREE_DAILY_LIMIT = 'lots'
    expect(assistFreeDailyLimit()).toBe(10)
  })
})

describe('estimateAssistCostUsd', () => {
  it('prices tokens at Sonnet list rates', () => {
    const cost = estimateAssistCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      'claude-sonnet-5',
    )
    expect(cost).toBe(18)
  })

  it('prices cache reads at a tenth of input', () => {
    const cost = estimateAssistCostUsd(
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 0,
      },
      'claude-sonnet-5',
    )
    expect(cost).toBe(0.3)
  })

  it('follows the SERVING model, so an ASSIST_MODEL swap cannot understate cost', () => {
    // The whole point of the meter is that per-org cost is trustworthy. A
    // model override that kept reporting Sonnet money would read as
    // "roughly right" while being wrong by the exact factor that matters.
    const million = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    expect(estimateAssistCostUsd(million, 'claude-sonnet-5')).toBe(18)
    expect(estimateAssistCostUsd(million, 'claude-opus-5')).toBe(30)
    expect(estimateAssistCostUsd(million, 'claude-haiku-4-5')).toBe(6)
  })

  it('an unknown model id errs HIGH rather than low, on BOTH rates', () => {
    // A pinned snapshot id, a model released after this table was written,
    // a typo in the env var: none of them may quietly make an org look
    // cheap. The fallback is the dearest tier on purpose — and since
    // AGL-3015 there are two rates to fall back on, each of which errs in
    // its own direction if it is left behind: a low billed rate under-draws
    // the customer's credits, a low provider rate over-states the margin.
    for (const rates of [aiBilledRatesForModel, aiProviderRatesForModel]) {
      const rate = rates('claude-something-not-in-the-table')
      expect(rate.inputPerToken).toBeGreaterThan(
        rates('claude-opus-5').inputPerToken,
      )
      expect(rate.outputPerToken).toBeGreaterThan(
        rates('claude-opus-5').outputPerToken,
      )
    }
  })
})

describe('checkAssistQuota — the caps must be able to go RED', () => {
  it('allows a free org under the daily cap', async () => {
    mockDocs.set(`orgs/${ORG}/counters/assistMessagesDaily`, {
      '2026-08-17': 9,
    })
    const verdict = await checkAssistQuota(firestore(), ORG, false, NOW)
    expect(verdict).toEqual({
      allowed: true,
      period: 'day',
      used: 9,
      limit: 10,
      remaining: 1,
    })
  })

  it('DENIES a free org at the daily cap', async () => {
    mockDocs.set(`orgs/${ORG}/counters/assistMessagesDaily`, {
      '2026-08-17': 10,
    })
    const verdict = await checkAssistQuota(firestore(), ORG, false, NOW)
    expect(verdict.allowed).toBe(false)
    expect(verdict.remaining).toBe(0)
  })

  it("yesterday's traffic never counts against today", async () => {
    mockDocs.set(`orgs/${ORG}/counters/assistMessagesDaily`, {
      '2026-08-16': 500,
    })
    const verdict = await checkAssistQuota(firestore(), ORG, false, NOW)
    expect(verdict.allowed).toBe(true)
    expect(verdict.used).toBe(0)
  })

  it('meters entitled orgs monthly, not daily', async () => {
    mockDocs.set(`orgs/${ORG}/counters/assistMessagesDaily`, {
      '2026-08-17': 999,
    })
    mockDocs.set(`orgs/${ORG}/assistUsage/2026-08`, { messages: 12 })
    const verdict = await checkAssistQuota(firestore(), ORG, true, NOW)
    expect(verdict).toMatchObject({ allowed: true, period: 'month', used: 12 })
  })

  it('DENIES an entitled org at the monthly runaway guard', async () => {
    mockDocs.set(`orgs/${ORG}/assistUsage/2026-08`, { messages: 1000 })
    const verdict = await checkAssistQuota(firestore(), ORG, true, NOW)
    expect(verdict.allowed).toBe(false)
  })

  it('a missing counter doc reads as zero usage, not a denial', async () => {
    const verdict = await checkAssistQuota(firestore(), ORG, false, NOW)
    expect(verdict).toMatchObject({ allowed: true, used: 0 })
  })
})

describe('reserveAssistMessage — the cap must be spent BEFORE the tokens', () => {
  const dailyPath = `orgs/${ORG}/counters/assistMessagesDaily`
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`

  it('admits a free org under the cap AND counts the message immediately', async () => {
    mockDocs.set(dailyPath, { '2026-08-17': 9 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW)
    expect(reservation).toMatchObject({
      allowed: true,
      period: 'day',
      dayKey: '2026-08-17',
      monthKey: '2026-08',
      used: 10,
      limit: 10,
      remaining: 0,
    })
    // The point of the whole change: the counter has ALREADY moved, before
    // the caller has had the chance to spend a token.
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 10 })
    expect(mockDocs.get(monthPath)).toMatchObject({ month: '2026-08', messages: 1 })
  })

  it('REFUSES a free org at the cap and moves no counter', async () => {
    mockDocs.set(dailyPath, { '2026-08-17': 10 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW)
    expect(reservation.allowed).toBe(false)
    expect(reservation.remaining).toBe(0)
    // Forced RED by flipping the fixture to 9: the assertion above starts
    // failing immediately, which is what proves it is live rather than
    // vacuously true.
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 10 })
    // No COUNTER moved. The month document may now exist — a refusal is
    // counted there under `refusals` (AGL-2930) — but `messages` must not.
    const monthAfterRefusal = mockDocs.get(monthPath) as
      | { messages?: unknown; refusals?: { messages?: unknown } }
      | undefined
    expect(monthAfterRefusal?.messages).toBeUndefined()
    expect(monthAfterRefusal?.refusals?.messages).toBeTruthy()
  })

  it('THE FAIL-OPEN: concurrent requests cannot all pass the same cap', async () => {
    // The bug this closes. `checkAssistQuota` READ the counter and the count
    // only moved at stream completion, so eight simultaneous requests each
    // saw `used: 8` and eight answers were generated against a cap of ten.
    // With the reservation the arithmetic is atomic: exactly the remaining
    // two are admitted, whatever the concurrency.
    mockDocs.set(dailyPath, { '2026-08-17': 8 })
    const store = firestore()
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveAssistMessage(store, ORG, false, NOW),
      ),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(2)
    expect(results.filter((r) => !r.allowed)).toHaveLength(6)
    // And the counter lands exactly ON the cap — never past it.
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 10 })
  })

  it('GUARD IS LIVE: the same eight all pass when there is room for eight', async () => {
    // The inverse fixture. Without this the test above is satisfied by a
    // function that refuses everything.
    mockDocs.set(dailyPath, { '2026-08-17': 2 })
    const store = firestore()
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveAssistMessage(store, ORG, false, NOW),
      ),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(8)
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 10 })
  })

  it('creates the counter document on an org\'s very first message', async () => {
    // `update()` would throw NOT_FOUND here; a merging `set` conjures it.
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW)
    expect(reservation).toMatchObject({ allowed: true, used: 1 })
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 1 })
  })

  it('meters an entitled org against the MONTH, and refuses at the guard', async () => {
    mockDocs.set(monthPath, { messages: 1000 })
    const denied = await reserveAssistMessage(firestore(), ORG, true, NOW)
    expect(denied).toMatchObject({ allowed: false, period: 'month', used: 1000 })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 1000 })

    mockDocs.set(monthPath, { messages: 999 })
    const allowed = await reserveAssistMessage(firestore(), ORG, true, NOW)
    expect(allowed).toMatchObject({ allowed: true, used: 1000 })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 1000 })
    // An entitled reservation still moves the daily counter, so a plan change
    // mid-day cannot hand the org a fresh free allowance.
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 1 })
  })

  it('THE PAID TIER IS NOT CAPPED DAILY: entitled reserves past the free cap', async () => {
    // The negative control for the whole free-tier story (AGL-2245). "Free
    // workspaces get ten messages a day" is satisfied just as well by a
    // build that gives EVERY workspace ten a day, and every other assertion
    // in this block is written against a free org — so the regression that
    // breaks the tier customers pay for would not turn a single test red.
    //
    // Seeded well past the free cap, at a count no free org could reach —
    // and the month seeded separately, so `used` says WHICH counter was
    // consulted. Without that the test survives a build that gates every
    // tier on the daily counter and merely raises the number, which is the
    // same defect with the arithmetic hidden.
    mockDocs.set(dailyPath, { '2026-08-17': 40 })
    mockDocs.set(monthPath, { messages: 5 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW)
    expect(reservation).toMatchObject({
      allowed: true,
      period: 'month',
      limit: assistEntitledMonthlyLimit(),
      used: 6,
    })
    // The daily counter still MOVES — it is the audit trail and the thing
    // that stops a plan change mid-day minting a fresh free allowance — it
    // simply is not the gate for this tier.
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 41 })
  })

  it('and the same fixture DOES refuse the free org, so the cap is real', async () => {
    // The paired positive. Without it the test above is satisfied by a build
    // that caps nobody, which is the opposite failure and the expensive one:
    // the free tier is the surface with no invoice behind it.
    mockDocs.set(dailyPath, { '2026-08-17': 40 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW)
    expect(reservation).toMatchObject({ allowed: false, period: 'day' })
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 40 })
  })

  it('honours the env override, so the cap can be tightened without a deploy', async () => {
    process.env.ASSIST_FREE_DAILY_LIMIT = '1'
    const store = firestore()
    expect((await reserveAssistMessage(store, ORG, false, NOW)).allowed).toBe(true)
    expect((await reserveAssistMessage(store, ORG, false, NOW)).allowed).toBe(false)
  })
})

/**
 * The DOLLAR half of the cap (AGL-2264).
 *
 * A message cap bounds money only through an assumed cost per message, and
 * every input to that assumption is mutable at runtime: `ASSIST_MODEL`, the
 * prompt's length, and how much history a client chooses to post. So these
 * assert against the MEASURED figure the meters already write.
 *
 * The ceiling ships ON, at a repo default of $40 (decided) — an
 * unset ceiling was the fail-open AGL-2264 was opened about, so a fresh
 * deployment and a self-hoster must both inherit a bound without knowing
 * the variable exists. Which means the load-bearing test in this block is
 * the last one: the default posture has to be pinned, or a later change
 * could quietly restore the fail-open and nothing here would notice.
 *
 * $40 changes no charged amount. It is a ceiling on OUR provider cost, and
 * it sits above anything the 1,000-message entitled guard can produce at
 * Sonnet (~$28), so no plan behaves differently for it.
 */
describe('the monthly SPEND ceiling — a message cap is not a dollar cap', () => {
  const dailyPath = `orgs/${ORG}/counters/assistMessagesDaily`
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`

  it('defaults to $40, and junk falls back to it rather than to zero or none', () => {
    expect(assistOrgMonthlyCostLimitUsd(process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD)).toBe(
      ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
    )
    expect(ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD).toBe(40)
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '120'
    expect(assistOrgMonthlyCostLimitUsd(process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD)).toBe(120)
    // Junk must not become a ceiling of $0, which would refuse every
    // workspace on the deployment. Nor an empty string — `Number('')` is 0,
    // the same outage by a different route — and nor NO ceiling, which is
    // the fail-open this whole mechanism closes. All three read as
    // unconfigured and take the default.
    for (const junk of ['forty dollars', '', '  ', '-5', '0']) {
      process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = junk
      expect(assistOrgMonthlyCostLimitUsd(process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD)).toBe(
        ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
      )
    }
    // Removing it takes a WORD, so nobody reaches "no ceiling" by mistyping
    // a digit — every mistyped digit above landed on the default instead.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = 'OFF'
    expect(assistOrgMonthlyCostLimitUsd(process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD)).toBeNull()
  })

  it('REFUSES an entitled org over the ceiling, and moves no counter', async () => {
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '40'
    // Note what is NOT wrong here: 12 messages against a 1,000-message
    // guard. The org has 988 messages in hand and is refused anyway, which
    // is the entire point — the messages were dear, not many.
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 41.5 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, NO_BAND)
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'budget',
      costUsd: 41.5,
      costLimitUsd: 40,
    })
    // And it says so honestly: messages remain, so a surface that renders
    // "N of M left" cannot claim the org ran out of messages.
    expect(reservation.remaining).toBeGreaterThan(0)
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 12 })
    expect(mockDocs.get(dailyPath)).toBeUndefined()
  })

  it('THE NEGATIVE CONTROL: the same fixture with the ceiling OFF reserves', async () => {
    // Without this the test above passes for a build that refuses any org
    // carrying a cost at all, or one that refuses entitled orgs outright.
    // The only difference between the two fixtures is the env var.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = 'off'
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 41.5 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, NO_BAND)
    expect(reservation).toMatchObject({
      allowed: true,
      refusedBy: null,
      // Reported because the entitled gate opens this document anyway.
      costUsd: 41.5,
      costLimitUsd: null,
    })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
  })

  it('reports costUsd as NULL when nothing consulted it, never as zero', async () => {
    // The free tier gates on the daily counter, so with the ceiling turned
    // OFF there is no reason to open the monthly document — and a
    // reservation that answered `costUsd: 0` there would be reporting a
    // constant under a measurement's name. The org below has spent $41.50.
    //
    // This path is now only reachable by an operator who wrote `off`, since
    // the shipped default always configures a ceiling. It is kept precisely
    // so `costUsd: null` keeps meaning "nobody looked" rather than decaying
    // into a value that can never occur.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = 'off'
    mockDocs.set(dailyPath, { '2026-08-17': 1 })
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 41.5 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, NO_BAND)
    expect(reservation).toMatchObject({ allowed: true, costUsd: null })
    // And with a ceiling configured the same call DOES look, so the null
    // above means "not consulted" rather than "never reads this field".
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '999'
    const looked = await reserveAssistMessage(firestore(), ORG, false, NOW, NO_BAND)
    expect(looked).toMatchObject({ allowed: true, costUsd: 41.5 })
  })

  it('THE SECOND NEGATIVE CONTROL: a dollar under the ceiling still reserves', async () => {
    // And this one stops a build that merely refuses whenever a ceiling is
    // configured, which would pass both tests above.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '40'
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 39 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, NO_BAND)
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
  })

  it('binds the DAILY-GATED tier too, whose gate is a different document', async () => {
    // An unentitled workspace gates on `counters/assistMessagesDaily`, so the
    // spend figure is in a document the reservation would otherwise never
    // open. A build that reads the ceiling off the gate document passes
    // every entitled test above and leaves that tier unbounded. Starter,
    // because Free now carries a band of its own that binds first — see the
    // Free taste block below.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '40'
    mockDocs.set(dailyPath, { '2026-08-17': 0 })
    mockDocs.set(monthPath, { messages: 400, estCostUsd: 45 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, NO_BAND)
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'budget',
      period: 'day',
    })
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 0 })
  })

  it('the MESSAGE cap still wins when both apply, so the words stay true', async () => {
    // Ordering is not cosmetic. "You are out of messages today" is a claim
    // the user can check and a wait they can measure; a spend refusal is
    // neither. When both ceilings are crossed the checkable one is the
    // honest thing to say.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '40'
    mockDocs.set(dailyPath, { '2026-08-17': 10 })
    mockDocs.set(monthPath, { messages: 400, estCostUsd: 45 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, NO_BAND)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'messages' })
  })

  it('SHIPS BOUNDED: with NOTHING configured, a runaway org is refused', async () => {
    // The pinned default posture, and the test that would stop a later edit
    // restoring the fail-open. No environment variable is set here — this is
    // a fresh deployment, or a self-hoster who has never heard of the
    // variable — and the org has run $100,000 of provider spend against a
    // subscription that did not move.
    expect(process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD).toBeUndefined()
    mockDocs.set(monthPath, { messages: 3, estCostUsd: 100_000 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, NO_BAND)
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'budget',
      costLimitUsd: 40,
    })
    // Refused, and nothing moved: the org above the ceiling spends nothing
    // more rather than spending less.
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 3 })
  })

  it('THE PAIRED DEFAULT CONTROL: an ordinary month is untouched by it', async () => {
    // $40 sits above anything the 1,000-message guard can produce at Sonnet
    // (~$28 worst case, AGL-2441), so turning the ceiling on by default must
    // change no paying workspace's behaviour. Without this the test above is
    // satisfied by a build that refuses every entitled org.
    expect(process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD).toBeUndefined()
    mockDocs.set(monthPath, { messages: 950, estCostUsd: 28 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, NO_BAND)
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 951 })
  })

  it('and the DEFAULT binds the daily-gated tier too, without a separate figure', async () => {
    // A bandless tier needs no ceiling of its own — 10 messages a UTC day
    // bounds it at roughly $0.28/day — but it must not be EXEMPT from this
    // one, or a tier-scoped read would leave the unpriced surface unbounded.
    expect(process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD).toBeUndefined()
    mockDocs.set(dailyPath, { '2026-08-17': 0 })
    mockDocs.set(monthPath, { messages: 400, estCostUsd: 4_000 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, NO_BAND)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'budget' })
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 0 })
  })
})

describe('releaseAssistMessage — an outage must not cost a message', () => {
  const dailyPath = `orgs/${ORG}/counters/assistMessagesDaily`
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`

  it('gives both counters back', async () => {
    const store = firestore()
    const reservation = await reserveAssistMessage(store, ORG, false, NOW)
    await releaseAssistMessage(store, ORG, reservation)
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 0 })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 0 })
  })

  it('releases against the RESERVED day, never against "now"', async () => {
    // The midnight case: reserved at 23:59:59, released after the rollover.
    const store = firestore()
    const lastSecond = new Date('2026-08-17T23:59:59Z')
    const reservation = await reserveAssistMessage(store, ORG, false, lastSecond)
    expect(reservation.dayKey).toBe('2026-08-17')
    await releaseAssistMessage(store, ORG, reservation)
    // The 18th must be untouched — a credit landing there is free capacity.
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 0 })
    expect(mockDocs.get(dailyPath)?.['2026-08-18']).toBeUndefined()
  })

  it('never drives a counter below zero, however often it is called', async () => {
    const store = firestore()
    const reservation = await reserveAssistMessage(store, ORG, false, NOW)
    await releaseAssistMessage(store, ORG, reservation)
    await releaseAssistMessage(store, ORG, reservation)
    await releaseAssistMessage(store, ORG, reservation)
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 0 })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 0 })
  })

  it('is a no-op for a reservation that was REFUSED', async () => {
    mockDocs.set(dailyPath, { '2026-08-17': 10 })
    const store = firestore()
    const refused = await reserveAssistMessage(store, ORG, false, NOW)
    expect(refused.allowed).toBe(false)
    await releaseAssistMessage(store, ORG, refused)
    // A refusal that credited a message would be an infinite allowance.
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 10 })
  })
})

describe('recordAssistExchange', () => {
  const record = {
    uid: 'user-1',
    question: 'How do I publish?',
    answer: 'Open the screen and press Publish.',
    route: '/acme/screens',
    hostId: 'host-1',
    model: 'claude-sonnet-5',
    tier: 'free' as const,
    usage: {
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
    },
    docsPaths: ['/getting-started/publish-your-first-screen#steps'],
    stopReason: 'end_turn',
  }

  it('writes the exchange, the signal, the daily counter, and the meter', async () => {
    const store = firestore()
    const exchangeId = await recordAssistExchange(store, ORG, record, NOW)
    expect(exchangeId).toBeTruthy()

    const exchange = mockDocs.get(`orgs/${ORG}/assistExchanges/${exchangeId}`)
    expect(exchange).toMatchObject({
      uid: 'user-1',
      question: 'How do I publish?',
      answer: record.answer,
    })

    const signal = mockDocs.get(`orgs/${ORG}/assistSignals/${exchangeId}`)
    expect(signal).toMatchObject({
      tier: 'free',
      feedback: null,
      docsPaths: record.docsPaths,
      // A refusal and a truncation both look like a short answer without
      // this — and they need opposite fixes.
      stopReason: 'end_turn',
    })

    // NO message counting here any more (AGL-2057) — the counters move in
    // `reserveAssistMessage`, before the tokens are spent. Recording again
    // would double-count every message and would put the cap back behind the
    // stream completion that abandoned requests never reach.
    expect(
      mockDocs.get(`orgs/${ORG}/counters/assistMessagesDaily`),
    ).toBeUndefined()

    const month = mockDocs.get(`orgs/${ORG}/assistUsage/2026-08`)
    expect(month).toMatchObject({
      month: '2026-08',
      inputTokens: 1200,
      outputTokens: 300,
    })
    expect(month?.messages).toBeUndefined()

    // AGL-2245: the recorded cost is the ARITHMETIC, not merely a positive
    // number. `toBeGreaterThan(0)` alone is satisfied by a constant, by a
    // function that ignores the usage, and by one that prices every model
    // the same — the last being exactly what the per-model table was added
    // to prevent. Cost telemetry nobody has tied to tokens can drift from
    // the truth with nothing going red, and tuning price against measured
    // margin is this meter's entire reason to exist.
    const priced = (rate: ReturnType<typeof aiBilledRatesForModel>) =>
      1200 * rate.inputPerToken +
      300 * rate.outputPerToken +
      800 * rate.cacheReadPerToken +
      100 * rate.cacheWritePerToken
    const rate = aiBilledRatesForModel('claude-sonnet-5')
    const expected = priced(rate)
    expect(Number(month?.estCostUsd)).toBeCloseTo(expected, 9)
    // Every term is load-bearing: a formula that dropped the cache columns
    // would still be proportional to the tokens and still positive.
    expect(Number(month?.estCostUsd)).not.toBeCloseTo(
      1200 * rate.inputPerToken + 300 * rate.outputPerToken,
      9,
    )
    expect(Number(signal?.estCostUsd)).toBeCloseTo(expected, 9)

    // AGL-3015: the SAME tokens, priced a second time at what the provider
    // charges, on the same three documents. Sonnet 5 is billed above its
    // provider rate, so this is a strictly smaller number — and asserting
    // it as its own arithmetic is what stops the second field being filled
    // in from the first.
    const providerExpected = priced(aiProviderRatesForModel('claude-sonnet-5'))
    expect(providerExpected).toBeLessThan(expected)
    expect(Number(month?.providerCostUsd)).toBeCloseTo(providerExpected, 9)
    expect(Number(signal?.providerCostUsd)).toBeCloseTo(providerExpected, 9)

    // And the asker's own month (AGL-2928), on the same batch: the same
    // money, keyed by the uid the signal deliberately does not carry.
    const person = mockDocs.get(`orgs/${ORG}/aiUsageByUser/user-1/months/2026-08`)
    expect(person).toMatchObject({ uid: 'user-1', month: '2026-08', requests: 1 })
    expect(Number(person?.estCostUsd)).toBeCloseTo(expected, 9)
    expect(signal?.uid).toBeUndefined()
  })

  it('the cost FOLLOWS the tokens — double the usage, double the money', async () => {
    // Proportionality, asserted without naming a rate: this one stays true
    // through a price change and goes red the moment the estimate stops
    // reading the usage it was handed.
    const single = estimateAssistCostUsd(record.usage, record.model)
    const double = estimateAssistCostUsd(
      {
        inputTokens: 2400,
        outputTokens: 600,
        cacheReadTokens: 1600,
        cacheWriteTokens: 200,
      },
      record.model,
    )
    expect(double).toBeCloseTo(single * 2, 9)
    expect(estimateAssistCostUsd(
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      record.model,
    )).toBe(0)
  })

  it('the cost FOLLOWS the model — an Opus turn is not billed as Sonnet', async () => {
    // `ASSIST_MODEL` is an env override for incident response. A one-line
    // swap to a dearer model that kept reporting Sonnet money would make
    // per-org cost read roughly right while margin quietly inverted, which
    // is the specific failure this table exists for.
    const store = firestore()
    await recordAssistExchange(store, ORG, { ...record, model: 'claude-opus-5' }, NOW)
    const opus = Number(
      mockDocs.get(`orgs/${ORG}/assistUsage/2026-08`)?.estCostUsd,
    )
    expect(opus).toBeCloseTo(
      estimateAssistCostUsd(record.usage, 'claude-opus-5'),
      9,
    )
    expect(opus).toBeGreaterThan(estimateAssistCostUsd(record.usage, 'claude-sonnet-5'))
    // And an id the table has never heard of prices at the DEAREST tier, not
    // the cheapest: a cost estimate that errs low is worse than one that
    // errs high, because only one of the two gets noticed.
    expect(estimateAssistCostUsd(record.usage, 'some-model-shipped-next-year'))
      .toBeGreaterThan(estimateAssistCostUsd(record.usage, 'claude-opus-5'))
  })

  it('a second exchange ACCUMULATES rather than replacing', async () => {
    const store = firestore()
    await recordAssistExchange(store, ORG, record, NOW)
    await recordAssistExchange(store, ORG, record, NOW)
    expect(
      mockDocs.get(`orgs/${ORG}/counters/assistMessagesDaily`),
    ).toBeUndefined()
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/2026-08`)).toMatchObject({
      inputTokens: 2400,
    })
  })
})

describe('recordAssistFeedback', () => {
  it('stamps feedback on the SIGNAL, which outlives the prose', async () => {
    mockDocs.set(`orgs/${ORG}/assistSignals/x1`, { feedback: null })
    const recorded = await recordAssistFeedback(firestore(), ORG, 'x1', 'down')
    expect(recorded).toBe(true)
    expect(mockDocs.get(`orgs/${ORG}/assistSignals/x1`)).toMatchObject({
      feedback: 'down',
    })
  })

  it('a thumbs-down survives the exchange being reaped', async () => {
    // The whole point of the split (AGL-1972). A rating recorded against a
    // signal whose exchange has already TTL'd away must still land: the
    // rating is the data loop's most valuable row and it is not prose.
    // Before the split this wrote to `assistExchanges` and would have
    // returned false here.
    mockDocs.set(`orgs/${ORG}/assistSignals/x2`, { feedback: null })
    // No `assistExchanges/x2` — expired.
    const recorded = await recordAssistFeedback(firestore(), ORG, 'x2', 'up')
    expect(recorded).toBe(true)
    expect(mockDocs.get(`orgs/${ORG}/assistSignals/x2`)).toMatchObject({
      feedback: 'up',
    })
  })

  it('refuses an unknown exchange', async () => {
    const recorded = await recordAssistFeedback(firestore(), ORG, 'nope', 'up')
    expect(recorded).toBe(false)
  })
})

describe('assist retention — the period has to be able to go BOTH ways', () => {
  const record = {
    uid: 'user-1',
    question: 'How do I publish?',
    answer: 'Press Publish.',
    route: '/acme/screens',
    hostId: 'host-1',
    model: 'claude-sonnet-5',
    tier: 'free' as const,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    docsPaths: ['/getting-started/publish-your-first-screen'],
    stopReason: 'end_turn',
  }

  /**
   * A TTL cannot be waited out in a unit test, so the assertion is on the
   * stamped boundary rather than on a deletion — the same reason
   * `mediaTombstones` is tested through `mediaTombstoneExpiry` and not by
   * sleeping for a week. The CONFIGURATION half (that a policy exists and
   * targets this field) is `assist-retention-config.spec.ts`.
   */
  it('stamps expiresAt exactly one period ahead, as a Date not a number', async () => {
    const store = firestore()
    const id = await recordAssistExchange(store, ORG, record, NOW)
    const expiresAt = mockDocs.get(`orgs/${ORG}/assistExchanges/${id}`)
      ?.expiresAt as Date

    // A number here governs NOTHING: a TTL policy keys on a Timestamp and
    // silently ignores a number field (`bookings.expiresAtMs`). The Admin
    // SDK converts a Date; it does not convert an epoch integer.
    expect(expiresAt).toBeInstanceOf(Date)
    expect(expiresAt.getTime() - NOW.getTime()).toBe(
      ASSIST_EXCHANGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    )
  })

  it('THE NEGATIVE CONTROL: an exchange INSIDE its period is not expired', async () => {
    // A retention guard that only proves deletion passes trivially if the
    // code deletes everything, so this asserts the surviving direction too.
    //
    // ⚠️ The bounds are LITERAL DAYS, deliberately not derived from
    // ASSIST_EXCHANGE_RETENTION_DAYS. Written the obvious way — comparing
    // against `(RETENTION_DAYS - 1)` — this test is a tautology: it moves
    // with the constant it is meant to constrain and stays green when the
    // period is set to zero. It was written that way first and proved
    // exactly that when the constant was flipped to 0, which is why the
    // numbers below are hard-coded.
    //
    // What they encode is a POLICY BAND, not the current value: a
    // conversation log must survive long enough to be read late (90 days is
    // a quarter), and must not become an indefinite archive (a year is the
    // outer edge of defensible for free-text prose). Any period inside that
    // band is a product decision; either edge is a defect.
    const store = firestore()
    const id = await recordAssistExchange(store, ORG, record, NOW)
    const expiresAt = mockDocs.get(`orgs/${ORG}/assistExchanges/${id}`)
      ?.expiresAt as Date
    const day = 24 * 60 * 60 * 1000

    // SURVIVES: still live a full quarter after it was written.
    expect(expiresAt.getTime()).toBeGreaterThan(NOW.getTime() + 90 * day)
    // EXPIRES: and gone within the year.
    expect(expiresAt.getTime()).toBeLessThan(NOW.getTime() + 365 * day)
  })

  it('the SIGNAL half carries no expiry and no uid', async () => {
    // If the signal expired too, the split would buy nothing and the docs
    // loop would lose its corpus anyway. If it carried the uid, the expiry
    // would retire the prose and keep the person — the split would be
    // cosmetic.
    const store = firestore()
    const id = await recordAssistExchange(store, ORG, record, NOW)
    const signal = mockDocs.get(`orgs/${ORG}/assistSignals/${id}`) ?? {}
    expect(signal.expiresAt).toBeUndefined()
    expect(signal.uid).toBeUndefined()
    expect(signal.question).toBeUndefined()
    expect(signal.answer).toBeUndefined()
    // …and it still carries what the loop reads.
    expect(signal.docsPaths).toEqual(record.docsPaths)
  })

  it('the counters and the monthly meter are NOT given an expiry', async () => {
    // Deliberate, and stated so a future reader does not "fix" it: these
    // are integers, not content. The monthly rollup is the cost history the
    // pricing decision reads, and the daily counter is ONE document per org
    // keyed by field — TTL deletes documents, so it could only reap the
    // whole quota state, cap included.
    const store = firestore()
    await recordAssistExchange(store, ORG, record, NOW)
    expect(
      mockDocs.get(`orgs/${ORG}/assistUsage/2026-08`)?.expiresAt,
    ).toBeUndefined()
    expect(
      mockDocs.get(`orgs/${ORG}/counters/assistMessagesDaily`)?.expiresAt,
    ).toBeUndefined()
  })

  it('assistExchangeExpiry is pure and moves with its argument', () => {
    const a = assistExchangeExpiry(new Date('2026-01-01T00:00:00Z'))
    const b = assistExchangeExpiry(new Date('2026-01-02T00:00:00Z'))
    expect(b.getTime() - a.getTime()).toBe(24 * 60 * 60 * 1000)
  })
})

/**
 * The two assist shapes the band has to tell apart, in TOKENS.
 *
 * These are the fixtures the whole cost-metered design stands on. A question
 * is a short grounded answer; a build carries the node tree, the component
 * catalog and the theme tokens in as cached context, writes a large cache
 * entry, and emits structured markup. Everything below prices them through
 * the meter's own estimator rather than asserting dollars picked by hand.
 */
const A_QUESTION = {
  inputTokens: 1_800,
  outputTokens: 480,
  cacheReadTokens: 900,
  cacheWriteTokens: 0,
}
const A_SCREEN_BUILD = {
  inputTokens: 6_000,
  outputTokens: 8_000,
  cacheReadTokens: 54_000,
  cacheWriteTokens: 20_000,
}

const signal = (usage: typeof A_QUESTION) => ({
  route: '/org/acme/hosts',
  hostId: null,
  model: 'claude-sonnet-5',
  tier: 'entitled' as const,
  usage,
  docsPaths: [],
  stopReason: 'end_turn',
})

describe('a CHEAP action and an EXPENSIVE one draw the band differently', () => {
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`

  it('prices them an order of magnitude apart through the real meter', () => {
    const question = estimateAssistCostUsd(A_QUESTION, 'claude-sonnet-5')
    const build = estimateAssistCostUsd(A_SCREEN_BUILD, 'claude-sonnet-5')
    // PINNED to `assist-credits.spec.ts`, which carries these same two
    // figures as dollars because it cannot import this estimator. A rate
    // change has to break both files, not leave one asserting a stale ratio.
    expect(question).toBe(0.01287)
    expect(build).toBe(0.2292)
    expect(build).toBeGreaterThan(question * 10)
  })

  it('MOVES THE METER by cost, not by message count', () => {
    // The single assertion a message-counting design would fail. Both calls
    // record exactly one turn; the money they draw is not close.
    return (async () => {
      const store = firestore()
      await recordAssistCost(store, ORG, signal(A_QUESTION), NOW)
      const afterQuestion = Number(mockDocs.get(monthPath)?.estCostUsd)
      await recordAssistCost(store, ORG, signal(A_SCREEN_BUILD), NOW)
      const afterBuild = Number(mockDocs.get(monthPath)?.estCostUsd)
      const drawnByBuild = afterBuild - afterQuestion
      expect(drawnByBuild).toBeGreaterThan(afterQuestion * 10)
    })()
  })

  it('EXHAUSTS a Pro band with builds where the same count of questions does not', async () => {
    const store = firestore()
    // The org's own hard cap is on (AGL-2653), so the band is a wall here
    // rather than the line it is by default — this case is about which
    // workspace REACHES it, and a band that sells past itself reaches it
    // silently.
    const org = { plan: 'pro' as const, assistOverage: { hardCap: true } }
    // Forty builds spend $9.17 against a $2.75 Pro band; forty questions
    // spend $0.51 of it. Same forty turns either way — under a message
    // allowance these two workspaces are indistinguishable.
    for (let i = 0; i < 40; i += 1) {
      await recordAssistCost(store, ORG, signal(A_SCREEN_BUILD), NOW)
    }
    const afterBuilds = await reserveAssistMessage(store, ORG, true, NOW, org)
    expect(afterBuilds).toMatchObject({ allowed: false, refusedBy: 'band' })

    mockDocs = new Map()
    const store2 = firestore()
    for (let i = 0; i < 40; i += 1) {
      await recordAssistCost(store2, ORG, signal(A_QUESTION), NOW)
    }
    const afterQuestions = await reserveAssistMessage(store2, ORG, true, NOW, org)
    expect(afterQuestions).toMatchObject({ allowed: true, refusedBy: null })
  })

  it('a DEFLECTED turn spends nothing, so the band never moves for it', async () => {
    // The docs-only path is metered under a zero-rate sentinel. A workspace
    // at its band keeps getting every answer the docs index can give it —
    // and this is why: those turns cost nothing to serve and draw nothing.
    const store = firestore()
    for (let i = 0; i < 500; i += 1) {
      await recordAssistCost(
        store,
        ORG,
        { ...signal({ ...A_QUESTION, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }), model: 'docs-retrieval', deflected: true },
        NOW,
      )
    }
    expect(Number(mockDocs.get(monthPath)?.estCostUsd)).toBe(0)
    expect(Number(mockDocs.get(monthPath)?.deflected)).toBe(500)
    const reservation = await reserveAssistMessage(store, ORG, true, NOW, {
      plan: 'pro',
    })
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
  })
})

describe("the PLAN's band binds, and the operator default may not undercut it", () => {
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`
  /**
   * Every refusal in this block is taken with the org's own hard cap ON
   * (AGL-2653). The band is a line by default now — a plan with a rate sells
   * past it — so a case about WHICH figure binds at the band has to make the
   * band a wall first, and the switch is the one thing that does. The
   * admissions run both ways: with the cap on, to show the band and not the
   * $40 default is the ceiling; with it off, to show the same spend reserves.
   */
  const STOPPED = { assistOverage: { hardCap: true } }

  it('REFUSES a Business org at its band, well under the $40 default', async () => {
    // $8 of spend against a $7.50 band. The repo default is $40, so a build
    // that ignored the plan band would let this through — which is precisely
    // the fail-open under test.
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 8 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'business',
      ...STOPPED,
    })
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'band',
      costLimitUsd: 7.5,
      budgetUsd: 7.5,
    })
    // Refused, and nothing moved.
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 12 })
  })

  it('THE NEGATIVE CONTROL: the same spend under the band reserves', async () => {
    // Without this the test above passes for a build that refuses every
    // Business org, or every org carrying any cost at all.
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 7 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'business',
      ...STOPPED,
    })
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
  })

  it('ADMITS an Agency org above $40, which the default alone would refuse', async () => {
    // The other direction, and the one that costs a customer rather than us.
    // $50 of spend is over the $40 repo default and under Agency's $58 band.
    // A build that took the lower of the two would cut a paying workspace off
    // well before the capacity it bought.
    expect(process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD).toBeUndefined()
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 50 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'agency',
      ...STOPPED,
    })
    expect(reservation).toMatchObject({
      allowed: true,
      refusedBy: null,
      costLimitUsd: 58,
      budgetUsd: 58,
    })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
    // With the cap OFF the band is not a ceiling at all, so nothing is: the
    // default stays out of it exactly as above, and the standing still names
    // the band the org bought.
    const selling = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'agency',
    })
    expect(selling).toMatchObject({
      allowed: true,
      refusedBy: null,
      costLimitUsd: null,
      budgetUsd: 58,
    })
  })

  it('and still refuses that Agency org at ITS band', async () => {
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 59 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'agency',
      ...STOPPED,
    })
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band' })
  })

  it('takes a CONTRACTED Enterprise band over the plan fallback', async () => {
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 120 })
    // The fallback is 116,000 credits — $116, twice Agency's band since
    // 2026-09-07 — so this org is over it. No switch here: Enterprise sells
    // no overage rate, so its band is a wall whatever the org's map says, and
    // the refusal is still the band's.
    const onFallback = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'enterprise',
    })
    expect(onFallback).toMatchObject({
      allowed: false,
      refusedBy: 'band',
      costLimitUsd: 116,
    })
    // The same spend against a contract that bought more.
    const contracted = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'enterprise',
      entitlements: { assistCreditsPerMonth: 1_000_000 },
    })
    expect(contracted).toMatchObject({
      allowed: true,
      refusedBy: null,
      costLimitUsd: 1000,
    })
  })

  it('an org with NO band is unchanged — the default still binds it', async () => {
    // Starter sells no assist band. Its assistant is bounded by the daily
    // message cap and by the operator backstop, exactly as before. (Free
    // did too, until the taste gave it a band — AGL-2925.)
    expect(assistMonthlyCeilingUsd(null)).toBe(
      ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
    )
    mockDocs.set(monthPath, { messages: 400, estCostUsd: 45 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, {
      plan: 'starter',
    })
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'budget',
      costLimitUsd: 40,
      budgetUsd: null,
    })
  })
})

describe('the operator ceiling composes with a band without erasing it', () => {
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`

  it('an EXPLICIT figure wins when it is lower — that is what setting it means', () => {
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '25'
    expect(assistMonthlyCeilingUsd(58)).toBe(25)
    // ...and does not RAISE a band it sits above.
    expect(assistMonthlyCeilingUsd(7.5)).toBe(7.5)
  })

  it('`off` removes the BACKSTOP and leaves the band standing', () => {
    // The word turns off a backstop. A band is not one — it is what the
    // customer was sold, and an environment variable does not un-sell it.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = 'off'
    expect(assistMonthlyCeilingUsd(null)).toBeNull()
    expect(assistMonthlyCeilingUsd(58)).toBe(58)
  })

  it('refuses an Agency org at its band even with the backstop OFF', async () => {
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = 'off'
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 200 })
    // The org asked to be stopped (AGL-2653); `off` turns off a backstop and
    // does not un-ask that.
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'agency',
      assistOverage: { hardCap: true },
    })
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band' })
  })

  it('a MISTYPED figure falls back to the band, never to no ceiling', () => {
    for (const junk of ['forty', '  ', '-5', '0']) {
      process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = junk
      expect(assistMonthlyCeilingUsd(7.5)).toBe(7.5)
      // And an org with no band still lands on the repo default, unchanged.
      expect(assistMonthlyCeilingUsd(null)).toBe(
        ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
      )
    }
  })
})

describe('ANTI-VACUITY: a stubbed entitlements module must not refuse everyone', () => {
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`

  it('a band of ZERO reads as NO BAND, so the clamp cannot go green empty', async () => {
    // A test double that answers 0 for every quota is the shape that makes a
    // clamp pass having refused every request. Zero here means "this plan
    // sells no assist band", so the org falls through to the operator
    // backstop and its assistant still runs.
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 1 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'business',
      entitlements: { assistCreditsPerMonth: 0 },
    })
    expect(reservation).toMatchObject({
      allowed: true,
      refusedBy: null,
      budgetUsd: null,
      costLimitUsd: ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
    })
  })

  it('THE OTHER WAY: a real band is still enforced on the same fixture shape', async () => {
    // Without this, the test above is satisfied by a build that ignores every
    // band and enforces nothing — the defect this work exists to close. The
    // org's hard cap is on so the band is a wall (AGL-2653); the point here is
    // that a band of 500 is a band, not that Business refuses by default.
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 1 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'business',
      entitlements: { assistCreditsPerMonth: 500 },
      assistOverage: { hardCap: true },
    })
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'band',
      budgetUsd: 0.5,
    })
  })
})

describe('the band is SOLD past by default, and the org’s switch makes it a wall (AGL-2653)', () => {
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`
  /** $3.00 of spend: past Pro's $2.75 band, far under every backstop. */
  const PAST_PRO_BAND = { messages: 12, estCostUsd: 3 }

  it('OFF (the default, an absent map): a Pro org past its band RESERVES and is counted', async () => {
    // FORCED RED by `bandRefuses = true` inside `reserveAssistMessage`: the
    // reservation came back `allowed: false, refusedBy: 'band'`.
    expect(process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD).toBeUndefined()
    mockDocs.set(monthPath, PAST_PRO_BAND)
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'pro',
    })
    expect(reservation).toMatchObject({
      allowed: true,
      refusedBy: null,
      // No ceiling bound this reservation; the band is still reported, so
      // the surface can say what it was measured against.
      costLimitUsd: null,
      budgetUsd: 2.75,
      costUsd: 3,
    })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
  })

  it('ON: the same org, same spend, is REFUSED at the band and nothing moves', async () => {
    // FORCED RED by ignoring `assistOverage` in `assistBandRefuses`: the
    // reservation was admitted and the counter moved to 13.
    mockDocs.set(monthPath, PAST_PRO_BAND)
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'pro',
      assistOverage: { hardCap: true },
    })
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'band',
      costLimitUsd: 2.75,
      budgetUsd: 2.75,
    })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 12 })
  })

  it('ON, under the band: still reserves — the switch is a wall AT the band, not a gate', async () => {
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 2 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'pro',
      assistOverage: { hardCap: true },
    })
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
  })

  it('only the boolean `true` counts — a hand-written string or 1 keeps selling', async () => {
    // The map is server-written, but a truthy value that is not the boolean
    // must not switch an assistant off at the band.
    for (const hardCap of ['true', 1, 'on'] as unknown[]) {
      mockDocs.set(monthPath, PAST_PRO_BAND)
      const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
        plan: 'pro',
        assistOverage: { hardCap: hardCap as boolean },
      })
      expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
    }
  })

  it('a plan with NO rate refuses at its band whatever the switch says', async () => {
    // Enterprise: nothing to sell the excess at, so the band stays the wall
    // it always was, and the refusal is the band's — not a spend ceiling's.
    // The fallback band is 116,000 credits ($116), so $120 is over it.
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 120 })
    for (const assistOverage of [undefined, { hardCap: false }, { hardCap: true }]) {
      const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
        plan: 'enterprise',
        ...(assistOverage ? { assistOverage } : {}),
      })
      expect(reservation).toMatchObject({
        allowed: false,
        refusedBy: 'band',
        costLimitUsd: 116,
      })
    }
  })

  it('an operator figure BELOW the band refuses in the operator’s name, switch or no switch', async () => {
    // The refusal that names the switch has to be the one the switch caused.
    // Here the operator's $2 undercuts Pro's $2.75, so the org would be
    // refused with the switch off too — that is the operator's decision and
    // keeps the operator's word.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '2'
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 2.5 })
    const stopped = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'pro',
      assistOverage: { hardCap: true },
    })
    expect(stopped).toMatchObject({ allowed: false, refusedBy: 'budget', costLimitUsd: 2 })
    const selling = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'pro',
    })
    expect(selling).toMatchObject({ allowed: false, refusedBy: 'budget', costLimitUsd: 2 })
  })

  it('assistMonthlyCeilingUsd: a band that does not refuse is no ceiling, and only an explicit figure is', () => {
    // Unset: nothing binds. The $40 default is a backstop for orgs with no
    // band, and this org has one — it is just not a wall.
    expect(assistMonthlyCeilingUsd(2.75, false)).toBeNull()
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '25'
    expect(assistMonthlyCeilingUsd(2.75, false)).toBe(25)
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = 'off'
    expect(assistMonthlyCeilingUsd(2.75, false)).toBeNull()
    // And a band that DOES refuse is unchanged by the second argument.
    delete process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD
    expect(assistMonthlyCeilingUsd(2.75, true)).toBe(2.75)
    // No band at all is untouched either way.
    expect(assistMonthlyCeilingUsd(null, false)).toBe(
      ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
    )
  })

  it('the credit standing reads against the BAND while the org buys past it', async () => {
    // FORCED RED by reading `costLimitUsd` alone in `publicAssistQuota`: the
    // standing came back `{ used: 3000, limit: null, remaining: null }` — a
    // workspace told it had drawn 3,000 of nothing.
    mockDocs.set(monthPath, PAST_PRO_BAND)
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'pro',
    })
    expect(publicAssistQuota(reservation).credits).toEqual({
      used: 3_000,
      limit: 2_750,
      remaining: 0,
    })
    // An operator figure ABOVE the band does not raise the standing: the
    // band is what the org bought, and the operator's number is ours.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '100'
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 1 })
    const roomy = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'pro',
    })
    expect(publicAssistQuota(roomy).credits).toEqual({
      used: 1_000,
      limit: 2_750,
      remaining: 1_750,
    })
  })
})

describe('what leaves the server is credits, never our provider bill', () => {
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`

  it('strips every dollar figure and reports the credit standing', async () => {
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 4.5 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'business',
    })
    const view = publicAssistQuota(reservation)
    expect(view.credits).toEqual({
      used: 4_500,
      limit: 7_500,
      remaining: 3_000,
    })
    const wire = JSON.stringify(view)
    for (const leak of ['costUsd', 'costLimitUsd', 'budgetUsd', '4.5']) {
      expect(wire).not.toContain(leak)
    }
    // The message standing survives: the free tier's daily cap is a real,
    // separately-worded limit the panel renders, and credits cannot say it.
    expect(view).toMatchObject({ period: 'month', allowed: true })
    expect(typeof view.limit).toBe('number')
  })

  it('reports NO credit standing for an org with no band', async () => {
    // A Starter workspace refused at the operator backstop has no credit
    // balance. Converting $40 into "40,000 credits" would name a band it
    // never bought.
    mockDocs.set(monthPath, { messages: 400, estCostUsd: 45 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, {
      plan: 'starter',
    })
    expect(reservation.allowed).toBe(false)
    expect(publicAssistQuota(reservation).credits).toBeNull()
  })

  it('reports the TASTE as a credit standing on a Free workspace (AGL-2925)', async () => {
    // Free carries a real band now, so a Free workspace refused at it is
    // told "300 of 300" — a band it was given, in the unit it was given in.
    mockDocs.set(monthPath, { messages: 4, estCostUsd: 0.3 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, {
      plan: 'free',
    })
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band' })
    expect(publicAssistQuota(reservation).credits).toEqual({
      used: 300,
      limit: 300,
      remaining: 0,
    })
  })
})

describe('the org’s own ceiling on OVERAGE refuses inside the transaction (AGL-2898)', () => {
  const dailyPath = `orgs/${ORG}/counters/assistMessagesDaily`
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`
  /** Pro: 2,750 credits at $3.00 per 1,000 — 2,000 credits over is $6.00. */
  const PRO_BAND = 2_750
  const proCapped = { plan: 'pro' as const, assistOverage: { capUsd: 6 } }

  it('REFUSES as `cap` once the priced overage meets the ceiling, and moves no counter', async () => {
    // FORCED RED by dropping the cap check from the transaction: the
    // reservation admitted the org and moved `messages` to 13.
    mockDocs.set(monthPath, {
      messages: 12,
      estCostUsd: assistUsdFromCredits(PRO_BAND + 2_000),
    })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, proCapped)
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'cap',
      // Messages remain — the ceiling is dollars, not messages.
      remaining: expect.any(Number),
    })
    expect(reservation.remaining).toBeGreaterThan(0)
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 12 })
    expect(mockDocs.get(dailyPath)).toBeUndefined()
    // And the sentence for it is the org's own, telling the ceiling from
    // the switch.
    expect(assistOwnControlRefusalText(proCapped, coreRefusal(reservation.refusedBy))).toContain('$6.00')
    expect(assistRefusedByHardCap(proCapped, coreRefusal(reservation.refusedBy))).toBe(false)
  })

  it('THE NEGATIVE CONTROL: the same spend with NO ceiling reserves', async () => {
    mockDocs.set(monthPath, {
      messages: 12,
      estCostUsd: assistUsdFromCredits(PRO_BAND + 2_000),
    })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, { plan: 'pro' })
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
  })

  it('THE SECOND NEGATIVE CONTROL: overage under the ceiling still reserves', async () => {
    // $5.97 of overage against $6: the org is past its band, buying credits
    // at the plan's rate, and has not yet reached the figure it chose.
    mockDocs.set(monthPath, {
      messages: 12,
      estCostUsd: assistUsdFromCredits(PRO_BAND + 1_990),
    })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, proCapped)
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
  })

  it('the switch outranks the ceiling: with the band a wall, the refusal is `band`', async () => {
    // With the switch on nothing past the band is sold, so there is no
    // overage for a ceiling to bound — the band refuses first and in its
    // own name.
    const stopped = { plan: 'pro' as const, assistOverage: { hardCap: true, capUsd: 6 } }
    mockDocs.set(monthPath, {
      messages: 12,
      estCostUsd: assistUsdFromCredits(PRO_BAND + 2_000),
    })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, stopped)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band' })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 12 })
  })

  it('the MESSAGE cap still wins when both apply, so the words stay true', async () => {
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '12'
    mockDocs.set(monthPath, {
      messages: 12,
      estCostUsd: assistUsdFromCredits(PRO_BAND + 2_000),
    })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, proCapped)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'messages' })
  })

  it('holds under concurrency: eight requests at the ceiling all refuse, none slip through', async () => {
    mockDocs.set(monthPath, {
      messages: 12,
      estCostUsd: assistUsdFromCredits(PRO_BAND + 2_000),
    })
    const store = firestore()
    const results = await Promise.all(
      Array.from({ length: 8 }, () => reserveAssistMessage(store, ORG, true, NOW, proCapped)),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(0)
    expect(results.every((r) => r.refusedBy === 'cap')).toBe(true)
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 12 })
  })
})

describe('Free is a WALL, even when given a band (AGL-2898)', () => {
  const dailyPath = `orgs/${ORG}/counters/assistMessagesDaily`
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`
  /**
   * A Free org on the REAL plan row (AGL-2925): 300 credits, the taste, and
   * no rate to sell past it at, so the band is a wall — refused there in the
   * plan's name, not by any control the org could set. This block was
   * written against an entitlements override of 300 before the constant
   * existed; it now reads the constant, and the override case below shows
   * a widened band is a wall all the same.
   */
  const freeWithBand = { plan: 'free' as const }

  it('the real row IS the band this block measures', () => {
    expect(PLAN_ENTITLEMENTS.free.assistCreditsPerMonth).toBe(300)
    expect(PLAN_ENTITLEMENTS.free.assistCreditsPerMonth).toBe(FREE_AI_TASTE_CREDITS_PER_MONTH)
  })

  it('is refused AT the band as `band`, on its own daily rung, with nothing billed', async () => {
    // FORCED RED by making `assistBandRefuses` answer false for a null
    // rate: the band stopped being a ceiling and the org reserved past it.
    mockDocs.set(dailyPath, { '2026-08-17': 2 })
    mockDocs.set(monthPath, { messages: 40, estCostUsd: assistUsdFromCredits(300) })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, freeWithBand)
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'band',
      period: 'day',
      // Daily messages remain — this is the band, not the message cap.
      remaining: 8,
    })
    expect(mockDocs.get(dailyPath)).toMatchObject({ '2026-08-17': 2 })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 40 })
    // Nothing is owed for the refusal or for anything before it.
    expect(assistMonthOverage(freeWithBand, reservation.costUsd ?? 0).overageMonthlyUsd).toBe(0)
    // And no control is named: the switch did not cause this, and neither
    // could a ceiling — so the doors answer the plain credits sentence and a
    // 429, never a 402 pointing at a control that does nothing.
    expect(assistRefusedByHardCap(freeWithBand, coreRefusal(reservation.refusedBy))).toBe(false)
    expect(assistOwnControlRefusalText(freeWithBand, coreRefusal(reservation.refusedBy))).toBeNull()
  })

  it('reads the same with a switch or a ceiling written on it — both are inert', async () => {
    for (const assistOverage of [{ hardCap: true }, { capUsd: 1 }, { hardCap: false, capUsd: 1 }]) {
      mockDocs = new Map()
      mockDocs.set(monthPath, { messages: 40, estCostUsd: assistUsdFromCredits(900) })
      const org = { ...freeWithBand, assistOverage }
      const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, org)
      expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band' })
      expect(assistOwnControlRefusalText(org, coreRefusal(reservation.refusedBy))).toBeNull()
      expect(assistMonthOverage(org, 0.9).overageMonthlyUsd).toBe(0)
    }
  })

  it('THE PAIRED CONTROL: inside the band, the same Free org is answered', async () => {
    mockDocs.set(monthPath, { messages: 40, estCostUsd: assistUsdFromCredits(200) })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, freeWithBand)
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
  })

  it('a band WIDENED by staff is still a wall, and still the org’s own', async () => {
    mockDocs.set(monthPath, { messages: 40, estCostUsd: assistUsdFromCredits(900) })
    const widened = { plan: 'free' as const, entitlements: { assistCreditsPerMonth: 900 } }
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, widened)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band', budgetUsd: 0.9 })
    expect(assistOwnControlRefusalText(widened, coreRefusal(reservation.refusedBy))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The Free taste (AGL-2925): 300 credits behind a wall, metered per ACCOUNT
// as well as per workspace, with a daily request cap, a refusal pause and a
// platform-wide ceiling — every one of them forced red, and each with the
// negative control that proves the refusal was that rung and not a blanket.
// ---------------------------------------------------------------------------
describe('the Free taste is metered per ACCOUNT, across every workspace one person owns (AGL-2925)', () => {
  const day = '2026-08-17'
  const orgMonthPath = `orgs/${ORG}/assistUsage/2026-08`
  const accountPath = 'users/owner-1/aiUsage/2026-08'
  const platformPath = 'platformAiFreeSpend/2026-08-17'
  const FREE = { plan: 'free' as const, ownerUid: 'owner-1' }

  it('attributes a Free reservation to the OWNER, and counts the request there', async () => {
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, FREE)
    expect(reservation).toMatchObject({ allowed: true, free: { accountUid: 'owner-1' } })
    expect(mockDocs.get(accountPath)).toMatchObject({
      month: '2026-08',
      requests: 1,
      days: { [day]: { requests: 1 } },
    })
    // A second workspace of the SAME owner lands on the same document.
    await reserveAssistMessage(firestore(), 'org-two', false, NOW, FREE)
    expect(mockDocs.get(accountPath)).toMatchObject({
      requests: 2,
      days: { [day]: { requests: 2 } },
    })
  })

  it('a member of someone else’s free workspace draws on the OWNER’s allowance, never their own', async () => {
    // The reservation takes no requester uid at all — the attribution is a
    // fact about the workspace, read off `ownerUid`, so there is no path by
    // which an invited member's account could be charged or could be the
    // one that runs out.
    await reserveAssistMessage(firestore(), ORG, false, NOW, FREE)
    expect([...mockDocs.keys()].filter((path) => path.startsWith('users/'))).toEqual([accountPath])
  })

  it('falls back to the CREATOR for an org that names no owner, and skips the account rungs for one that names neither', async () => {
    const created = await reserveAssistMessage(firestore(), ORG, false, NOW, {
      plan: 'free',
      createdByUid: 'creator-1',
    })
    expect(created.free).toEqual({ accountUid: 'creator-1' })
    expect(mockDocs.get('users/creator-1/aiUsage/2026-08')).toMatchObject({ requests: 1 })
    const orphan = await reserveAssistMessage(firestore(), 'org-orphan', false, NOW, {
      plan: 'free',
    })
    expect(orphan).toMatchObject({ allowed: true, free: { accountUid: null } })
  })

  it('a PAID workspace is attributed to nobody and touches no account document', async () => {
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'pro',
      ownerUid: 'owner-1',
    })
    expect(reservation).toMatchObject({ allowed: true, free: null })
    expect(mockDocs.get(accountPath)).toBeUndefined()
  })

  it('REFUSES as `account` once the owner’s 300 credits are spent across workspaces', async () => {
    // FORCED RED by dropping the account read from the transaction: this
    // workspace's own band is untouched, so it reserved.
    mockDocs.set(accountPath, { estCostUsd: 0.3 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, FREE)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'account' })
    // Nothing moved — not the org's counters, not the account's request.
    // The org month carries only the refusal count the staff card reads
    // (AGL-2930), never a message or a cost.
    expect(mockDocs.get(orgMonthPath)).toEqual({ month: '2026-08', refusals: { account: 1 } })
    expect(mockDocs.get(accountPath)).toEqual({ estCostUsd: 0.3 })
  })

  it('THE NEGATIVE CONTROL: another owner’s workspace, same spend on the first, reserves', async () => {
    mockDocs.set(accountPath, { estCostUsd: 0.3 })
    const reservation = await reserveAssistMessage(firestore(), 'org-other', false, NOW, {
      plan: 'free',
      ownerUid: 'owner-2',
    })
    expect(reservation).toMatchObject({ allowed: true, free: { accountUid: 'owner-2' } })
  })

  it('the WORKSPACE band wins over the account band when both apply, so the words stay true', async () => {
    // "This workspace used its credits" is checkable on the workspace's own
    // meter; "your other workspaces used them" is not, so the nearer
    // explanation is given when both are true.
    mockDocs.set(orgMonthPath, { messages: 4, estCostUsd: 0.3 })
    mockDocs.set(accountPath, { estCostUsd: 0.3 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, FREE)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band' })
  })

  it('REFUSES as `requests` at the account’s daily cap, and honours the env override', async () => {
    mockDocs.set(accountPath, { requests: 30, days: { [day]: { requests: 30 } } })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: false, refusedBy: 'requests' })
    // One under: reserves, and the count moves to exactly the cap.
    mockDocs.set(accountPath, { requests: 29, days: { [day]: { requests: 29 } } })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: true })
    expect(mockDocs.get(accountPath)).toMatchObject({ days: { [day]: { requests: 30 } } })
    // Yesterday's requests never count against today.
    mockDocs.set(accountPath, { requests: 30, days: { '2026-08-16': { requests: 30 } } })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: true })
    // Tightened without a deploy.
    process.env.AI_FREE_DAILY_REQUESTS = '2'
    mockDocs.set(accountPath, { requests: 2, days: { [day]: { requests: 2 } } })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: false, refusedBy: 'requests' })
  })

  it('REFUSES as `refusals` after three declined briefs in a day — two is not a pause', async () => {
    mockDocs.set(accountPath, { days: { [day]: { refusals: 3 } } })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: false, refusedBy: 'refusals' })
    mockDocs.set(accountPath, { days: { [day]: { refusals: 2 } } })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: true })
  })

  it('REFUSES as `platform` at the day’s ceiling, and a PAID workspace is untouched by it', async () => {
    mockDocs.set(platformPath, { estCostUsd: 25 })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: false, refusedBy: 'platform' })
    // The recorded pause refuses even when the running figure is under —
    // an operator raising the ceiling mid-day does not un-pause the day.
    mockDocs.set(platformPath, { estCostUsd: 1, pausedAt: '__now__' })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: false, refusedBy: 'platform' })
    // Paid: the same day document, and the reservation never reads it.
    expect(
      await reserveAssistMessage(firestore(), ORG, true, NOW, { plan: 'pro' }),
    ).toMatchObject({ allowed: true, refusedBy: null })
    // Under the ceiling: reserves. Env-tunable.
    mockDocs.set(platformPath, { estCostUsd: 24.99 })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: true })
    process.env.AI_FREE_DAILY_PLATFORM_CEILING_USD = '10'
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: false, refusedBy: 'platform' })
  })

  it('the MESSAGE cap still wins over every taste rung, so the checkable refusal is given', async () => {
    mockDocs.set(`orgs/${ORG}/counters/assistMessagesDaily`, { [day]: 10 })
    mockDocs.set(platformPath, { estCostUsd: 25 })
    mockDocs.set(accountPath, { estCostUsd: 0.3, days: { [day]: { requests: 30 } } })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, FREE),
    ).toMatchObject({ allowed: false, refusedBy: 'messages' })
  })

  it('THE FAIL-OPEN, on the account: concurrent requests cannot all pass the daily cap', async () => {
    process.env.AI_FREE_DAILY_REQUESTS = '2'
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        reserveAssistMessage(firestore(), `org-${i}`, false, NOW, FREE),
      ),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(2)
    expect(results.filter((r) => r.refusedBy === 'requests')).toHaveLength(4)
    expect(mockDocs.get(accountPath)).toMatchObject({ days: { [day]: { requests: 2 } } })
  })

  it('releasing a Free reservation hands the account’s request back, and never below zero', async () => {
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, FREE)
    expect(mockDocs.get(accountPath)).toMatchObject({ requests: 1, days: { [day]: { requests: 1 } } })
    await releaseAssistMessage(firestore(), ORG, reservation)
    expect(mockDocs.get(accountPath)).toMatchObject({ requests: 0, days: { [day]: { requests: 0 } } })
    await releaseAssistMessage(firestore(), ORG, reservation)
    expect(mockDocs.get(accountPath)).toMatchObject({ requests: 0, days: { [day]: { requests: 0 } } })
    // A caller that carries no attribution — the older reservation shape —
    // still releases the org's counters and touches no account.
    const paid = await reserveAssistMessage(firestore(), ORG, true, NOW, { plan: 'pro' })
    await releaseAssistMessage(firestore(), ORG, {
      allowed: paid.allowed,
      dayKey: paid.dayKey,
      monthKey: paid.monthKey,
    })
    expect(mockDocs.get(orgMonthPath)).toMatchObject({ messages: 0 })
  })
})

describe('a Free turn is metered on the account and the platform; a refusal draws no credits (AGL-2925)', () => {
  const day = '2026-08-17'
  const orgMonthPath = `orgs/${ORG}/assistUsage/2026-08`
  const accountPath = 'users/owner-1/aiUsage/2026-08'
  const platformPath = 'platformAiFreeSpend/2026-08-17'
  const usage = { inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const cost = estimateAssistCostUsd(usage, 'claude-sonnet-5')
  const record = (stopReason: string | null, free: { accountUid: string | null } | null) => ({
    route: '/api/ai/assist/section',
    hostId: null,
    model: 'claude-sonnet-5',
    tier: 'free' as const,
    usage,
    docsPaths: [],
    stopReason,
    free,
  })

  it('an answered Free turn lands on the org, the account AND the platform day', async () => {
    await recordAssistCost(firestore(), ORG, record('end_turn', { accountUid: 'owner-1' }), NOW)
    expect(mockDocs.get(orgMonthPath)).toMatchObject({ estCostUsd: cost, refusedTurns: 0, refusedCostUsd: 0 })
    expect(mockDocs.get(accountPath)).toMatchObject({ month: '2026-08', estCostUsd: cost })
    expect(mockDocs.get(platformPath)).toMatchObject({ day, estCostUsd: cost, requests: 1, refusals: 0 })
    // Accumulates, on all three, through the other writer too.
    await recordAssistExchange(
      firestore(),
      ORG,
      { ...record('end_turn', { accountUid: 'owner-1' }), uid: 'member-9', question: 'q', answer: 'a' },
      NOW,
    )
    expect(mockDocs.get(accountPath)).toMatchObject({ estCostUsd: cost * 2 })
    expect(mockDocs.get(platformPath)).toMatchObject({ estCostUsd: cost * 2, requests: 2 })
  })

  it('a REFUSED Free turn costs the platform, counts on the account’s day, and draws NO credits', async () => {
    // FORCED RED by metering a refusal like any other turn: the org's
    // `estCostUsd` moved and the account's did too.
    await recordAssistCost(firestore(), ORG, record('refusal', { accountUid: 'owner-1' }), NOW)
    expect(mockDocs.get(orgMonthPath)).toMatchObject({ estCostUsd: 0, refusedTurns: 1, refusedCostUsd: cost })
    expect(mockDocs.get(accountPath)).toMatchObject({ days: { [day]: { refusals: 1 } } })
    expect(mockDocs.get(accountPath)?.estCostUsd).toBeUndefined()
    expect(mockDocs.get(platformPath)).toMatchObject({ estCostUsd: cost, requests: 1, refusals: 1 })
    // The signal keeps the true cost: the staff board reads our money there.
    const signal = [...mockDocs.entries()].find(([path]) => path.includes('/assistSignals/'))?.[1]
    expect(signal).toMatchObject({ stopReason: 'refusal', estCostUsd: cost })
  })

  it('a PAID turn — no attribution — is metered exactly as before, refusal or not', async () => {
    await recordAssistCost(firestore(), ORG, { ...record('refusal', null), tier: 'entitled' }, NOW)
    expect(mockDocs.get(orgMonthPath)).toMatchObject({ estCostUsd: cost, refusedTurns: 0, refusedCostUsd: 0 })
    expect(mockDocs.get(platformPath)).toBeUndefined()
    expect([...mockDocs.keys()].some((path) => path.startsWith('users/'))).toBe(false)
  })

  it('a metered turn leaves the gate’s refusal map intact — the two counts are two fields (AGL-2986)', async () => {
    // FORCED RED by writing the declined-turn count back under `refusals`:
    // an increment over the map replaces it, and the staff card's refusals
    // would only ever count back to the last answered request.
    mockDocs.set(orgMonthPath, { month: '2026-08', refusals: { band: 2, cap: 1 } })
    await recordAssistCost(firestore(), ORG, { ...record('end_turn', null), tier: 'entitled' }, NOW)
    await recordAssistCost(firestore(), ORG, record('refusal', { accountUid: 'owner-1' }), NOW)
    expect(mockDocs.get(orgMonthPath)).toMatchObject({
      refusals: { band: 2, cap: 1 },
      refusedTurns: 1,
    })
  })

  it('a Free workspace with NO owner meters the platform day and nothing else', async () => {
    await recordAssistCost(firestore(), ORG, record('end_turn', { accountUid: null }), NOW)
    expect(mockDocs.get(platformPath)).toMatchObject({ estCostUsd: cost, requests: 1 })
    expect([...mockDocs.keys()].some((path) => path.startsWith('users/'))).toBe(false)
  })

  it('tells staff ONCE at 80% of the day’s ceiling, and records the pause ONCE at 100%', async () => {
    process.env.AI_FREE_DAILY_PLATFORM_CEILING_USD = '1'
    // Under 80%: silence.
    mockDocs.set(platformPath, { estCostUsd: 0.5 })
    await recordAssistCost(firestore(), ORG, record('end_turn', { accountUid: 'owner-1' }), NOW)
    expect(mockStaffAlerts).toHaveLength(0)
    // Cross 80%: one mail, `alertedAt` stamped.
    mockDocs.set(platformPath, { estCostUsd: 0.8 })
    await recordAssistCost(firestore(), ORG, record('end_turn', { accountUid: 'owner-1' }), NOW)
    expect(mockStaffAlerts).toHaveLength(1)
    expect(mockStaffAlerts[0].subject).toContain('80%')
    expect(mockDocs.get(platformPath)).toMatchObject({ alertedAt: '__now__' })
    // Another turn in the eighties: still one mail.
    await recordAssistCost(firestore(), ORG, record('end_turn', { accountUid: 'owner-1' }), NOW)
    expect(mockStaffAlerts).toHaveLength(1)
    // Cross 100%: the pause is stamped, one audit row, one more mail.
    mockDocs.set(platformPath, { ...mockDocs.get(platformPath), estCostUsd: 1 })
    await recordAssistCost(firestore(), ORG, record('end_turn', { accountUid: 'owner-1' }), NOW)
    expect(mockStaffAlerts).toHaveLength(2)
    expect(mockStaffAlerts[1].subject).toContain('paused')
    expect(mockDocs.get(platformPath)).toMatchObject({ pausedAt: '__now__' })
    const audits = [...mockDocs.entries()].filter(([path]) => path.startsWith('adminAudit/'))
    expect(audits).toHaveLength(1)
    expect(audits[0][1]).toMatchObject({
      action: 'platform.aiFreeSpend.paused',
      target: 'platformAiFreeSpend/2026-08-17',
      actorUid: 'system:ai-free-spend',
    })
    // And it stays paused for every Free reservation until the day rolls.
    expect(
      await reserveAssistMessage(firestore(), ORG, false, NOW, { plan: 'free', ownerUid: 'owner-1' }),
    ).toMatchObject({ allowed: false, refusedBy: 'platform' })
    expect(
      await reserveAssistMessage(firestore(), ORG, false, new Date('2026-08-18T00:00:01Z'), {
        plan: 'free',
        ownerUid: 'owner-1',
      }),
    ).toMatchObject({ allowed: true })
    // A further turn past the ceiling announces nothing again.
    await recordAssistCost(firestore(), ORG, record('end_turn', { accountUid: 'owner-1' }), NOW)
    expect(mockStaffAlerts).toHaveLength(2)
    expect([...mockDocs.keys()].filter((path) => path.startsWith('adminAudit/'))).toHaveLength(1)
  })

  it('the staff mail names the day, the figure and the manual stop, and never a customer', async () => {
    process.env.AI_FREE_DAILY_PLATFORM_CEILING_USD = '1'
    mockDocs.set(platformPath, { estCostUsd: 1 })
    await recordAssistCost(firestore(), ORG, record('end_turn', { accountUid: 'owner-1' }), NOW)
    const mail = mockStaffAlerts[0]
    expect(mail.context).toBe('ai-free-spend')
    expect(mail.text).toContain('2026-08-17')
    expect(mail.text).toContain('ai-generate')
    expect(mail.text).not.toContain('owner-1')
    expect(mail.text).not.toContain(ORG)
  })
})

describe('the Free taste readout and knobs (AGL-2925)', () => {
  const platformPath = 'platformAiFreeSpend/2026-08-17'

  it('reads the day against the ceiling, and reports a pause from the stamp OR the figure', async () => {
    expect(await readPlatformFreeSpend(firestore(), '2026-08-17')).toEqual({
      day: '2026-08-17',
      estCostUsd: 0,
      requests: 0,
      refusals: 0,
      ceilingUsd: 25,
      alerted: false,
      paused: false,
    })
    mockDocs.set(platformPath, { estCostUsd: 26, requests: 40, refusals: 2 })
    expect(await readPlatformFreeSpend(firestore(), '2026-08-17')).toMatchObject({
      estCostUsd: 26,
      requests: 40,
      refusals: 2,
      paused: true,
      alerted: false,
    })
    mockDocs.set(platformPath, { estCostUsd: 3, alertedAt: '__now__', pausedAt: '__now__' })
    expect(await readPlatformFreeSpend(firestore(), '2026-08-17')).toMatchObject({
      paused: true,
      alerted: true,
    })
  })

  it('attributes by plan, not by field: a dead subscription is Free again', () => {
    expect(freeAssistAccount({ plan: 'pro', ownerUid: 'o' })).toBeNull()
    expect(freeAssistAccount({ plan: 'free', ownerUid: 'o', createdByUid: 'c' })).toEqual({ accountUid: 'o' })
    expect(freeAssistAccount({ plan: 'free', createdByUid: 'c' })).toEqual({ accountUid: 'c' })
    expect(freeAssistAccount({ plan: 'free' })).toEqual({ accountUid: null })
    expect(freeAssistAccount(null)).toEqual({ accountUid: null })
    expect(
      freeAssistAccount({ plan: 'agency', ownerUid: 'o', subscription: { status: 'canceled' } } as never),
    ).toEqual({ accountUid: 'o' })
  })

  it('a comped workspace is not metered as Free, whatever its dead subscription says (AGL-3034)', () => {
    // test-org's shape once comped: the stored plan and the canceled
    // subscription alone read Free, and the owner's 300-credit account
    // allowance capped a 5,000-credit override. The comp is the plan now.
    const canceled = { plan: 'pro', billingStatus: 'canceled', ownerUid: 'o' }
    expect(freeAssistAccount(canceled as never)).toEqual({ accountUid: 'o' })
    expect(
      freeAssistAccount({
        ...canceled,
        entitlements: { assistCreditsPerMonth: 5000, planComp: { plan: 'pro', reason: 'beta' } },
      } as never),
    ).toBeNull()
    // …and a comp a live Free subscription outranks is still Free's taste.
    expect(
      freeAssistAccount({
        plan: 'free',
        billingStatus: 'active',
        ownerUid: 'o',
        entitlements: { planComp: { plan: 'pro' } },
      } as never),
    ).toEqual({ accountUid: 'o' })
  })

  it('the knobs default, honour a number, and never fail open', () => {
    expect(aiFreeDailyRequests()).toBe(30)
    expect(aiFreeDailyPlatformCeilingUsd()).toBe(25)
    process.env.AI_FREE_DAILY_REQUESTS = '5'
    process.env.AI_FREE_DAILY_PLATFORM_CEILING_USD = '2.5'
    expect(aiFreeDailyRequests()).toBe(5)
    expect(aiFreeDailyPlatformCeilingUsd()).toBe(2.5)
    // Zero requests is a decision; a zero ceiling is not a number to honour.
    process.env.AI_FREE_DAILY_REQUESTS = '0'
    process.env.AI_FREE_DAILY_PLATFORM_CEILING_USD = '0'
    expect(aiFreeDailyRequests()).toBe(0)
    expect(aiFreeDailyPlatformCeilingUsd()).toBe(25)
    for (const junk of ['lots', '', '-3', 'off']) {
      process.env.AI_FREE_DAILY_REQUESTS = junk
      process.env.AI_FREE_DAILY_PLATFORM_CEILING_USD = junk
      expect(aiFreeDailyRequests()).toBe(30)
      expect(aiFreeDailyPlatformCeilingUsd()).toBe(25)
    }
  })
})

describe('AI allotments sit inside the band (AGL-2942)', () => {
  const PRO = { plan: 'pro' as const }
  const month = '2026-08'
  const orgMonthPath = `orgs/${ORG}/assistUsage/${month}`
  const allotment = (subject: string, data: Record<string, unknown>) =>
    mockDocs.set(`orgs/${ORG}/aiAllotments/${subject}`, { subject, ...data })
  const personMonth = (uid: string, data: Record<string, unknown>) =>
    mockDocs.set(`orgs/${ORG}/aiUsageByUser/${uid}/months/${month}`, { uid, month, ...data })
  /** $0.30 at the balanced tier's input rate: 300 credits, rounded as the meter rounds. */
  const spend = (uid: string, hostId: string | null) =>
    recordAssistCost(
      firestore(),
      ORG,
      {
        route: '/api/ai/assist/section',
        hostId,
        model: 'claude-sonnet-5',
        tier: 'entitled',
        usage: { inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        docsPaths: [],
        stopReason: 'end_turn',
        uid,
      },
      NOW,
    )

  beforeEach(() => {
    mockAllotmentAlerts.length = 0
  })

  it('a HARD member allotment refuses at its line, as `allotment`, moving no counter', async () => {
    // FORCED RED by deleting the rung: the reservation admits and counts.
    allotment('member:u1', { credits: 300, mode: 'hard' })
    personMonth('u1', { credits: 300 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, PRO, { uid: 'u1' })
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'allotment' })
    expect(reservation.allotment?.refusal).toMatchObject({ subject: 'member:u1', used: 300, credits: 300 })
    expect(mockDocs.get(orgMonthPath)?.messages).toBeUndefined()
    expect(mockDocs.get(`orgs/${ORG}/counters/assistMessagesDaily`)).toBeUndefined()
    // Counted where every other refusal is, under its own reason.
    expect(mockDocs.get(orgMonthPath)).toMatchObject({ refusals: { allotment: 1 } })
    // One credit under the line is admitted.
    personMonth('u1', { credits: 299 })
    expect(
      await reserveAssistMessage(firestore(), ORG, true, NOW, PRO, { uid: 'u1' }),
    ).toMatchObject({ allowed: true, refusedBy: null })
  })

  it('the workspace’s own wall refuses FIRST, and no allotment is read behind it', async () => {
    const walled = { plan: 'pro' as const, assistOverage: { hardCap: true } }
    const band = assistUsdFromCredits(PLAN_ENTITLEMENTS.pro.assistCreditsPerMonth)
    mockDocs.set(orgMonthPath, { month, estCostUsd: band, messages: 1 })
    allotment('member:u1', { credits: 1, mode: 'hard' })
    personMonth('u1', { credits: 5000 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, walled, { uid: 'u1' })
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band' })
    // The allotment was never consulted: the band is the outer wall.
    expect(reservation.allotment).toBeUndefined()
  })

  it('an allotment never grants past the band: a roomy allotment on a workspace at its wall is still refused', async () => {
    const walled = { plan: 'pro' as const, assistOverage: { hardCap: true } }
    mockDocs.set(orgMonthPath, {
      month,
      estCostUsd: assistUsdFromCredits(PLAN_ENTITLEMENTS.pro.assistCreditsPerMonth),
    })
    allotment('member:u1', { credits: 10_000_000, mode: 'hard' })
    expect(
      await reserveAssistMessage(firestore(), ORG, true, NOW, walled, { uid: 'u1' }),
    ).toMatchObject({ allowed: false, refusedBy: 'band' })
  })

  it('a SOFT allotment admits past its line and hands the crossing to the alert pipeline', async () => {
    allotment('member:u1', { credits: 300, mode: 'soft' })
    personMonth('u1', { credits: 450 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, PRO, { uid: 'u1' })
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockAllotmentAlerts).toEqual([
      expect.objectContaining({
        orgId: ORG,
        month,
        alerts: [expect.objectContaining({ threshold: 100 })],
      }),
    ])
  })

  it('a SITE allotment is a ceiling over everyone on the site, and touches no other site', async () => {
    // Two collaborators spend 300 credits each on h1; the meter folds both
    // into the site's month beside the org rollup.
    await spend('u1', 'h1')
    await spend('u2', 'h1')
    expect(mockDocs.get(orgMonthPath)).toMatchObject({ byHost: { h1: 600 } })
    allotment('host:h1', { credits: 600, mode: 'hard' })
    // A third person, with nothing spent, is refused on the site…
    const refused = await reserveAssistMessage(firestore(), ORG, true, NOW, PRO, { uid: 'u3', hostId: 'h1' })
    expect(refused).toMatchObject({ allowed: false, refusedBy: 'allotment' })
    expect(refused.allotment?.refusal).toMatchObject({ scope: 'host', used: 600 })
    // …and admitted on another site, and where the request names no site.
    expect(
      await reserveAssistMessage(firestore(), ORG, true, NOW, PRO, { uid: 'u3', hostId: 'h2' }),
    ).toMatchObject({ allowed: true })
    expect(
      await reserveAssistMessage(firestore(), ORG, true, NOW, PRO, { uid: 'u3' }),
    ).toMatchObject({ allowed: true })
  })

  it('a collaborator’s allotment counts their credits on THAT site only', async () => {
    await spend('u1', 'h2')
    allotment('collab:h1:u1', { credits: 100, mode: 'hard' })
    expect(
      await reserveAssistMessage(firestore(), ORG, true, NOW, PRO, { uid: 'u1', hostId: 'h1' }),
    ).toMatchObject({ allowed: true })
    await spend('u1', 'h1')
    expect(
      await reserveAssistMessage(firestore(), ORG, true, NOW, PRO, { uid: 'u1', hostId: 'h1' }),
    ).toMatchObject({ allowed: false, refusedBy: 'allotment' })
  })

  it('a request that names nobody meets no allotment', async () => {
    allotment('member:u1', { credits: 1, mode: 'hard' })
    personMonth('u1', { credits: 500 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, PRO)
    expect(reservation).toMatchObject({ allowed: true })
    expect(reservation.allotment).toBeNull()
  })

  it('carries the caller’s month, the binding allotment and the allowlists for the strip and the model switch', async () => {
    allotment('member:u1', { credits: 5000, mode: 'hard', models: ['a', 'b'] })
    allotment('host:h1', { credits: 700, mode: 'soft', models: ['b', 'c'] })
    allotment('org', { models: ['b'] })
    personMonth('u1', { credits: 120, byHost: { h1: 120 } })
    mockDocs.set(orgMonthPath, { month, byHost: { h1: 650 } })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, PRO, { uid: 'u1', hostId: 'h1' })
    expect(reservation.allotment).toMatchObject({
      personalCredits: 120,
      binding: { subject: 'host:h1', used: 650, credits: 700 },
      models: ['b'],
      orgModels: ['b'],
    })
  })
})

describe('tokens by kind on the month, on the signal and on the person’s month (AGL-2937)', () => {
  const orgMonthPath = `orgs/${ORG}/assistUsage/2026-08`
  const usage = { inputTokens: 1_200, outputTokens: 300, cacheReadTokens: 3_000, cacheWriteTokens: 400 }
  const cost = estimateAssistCostUsd(usage, 'claude-sonnet-5')
  const providerCost = estimateAssistProviderCostUsd(usage, 'claude-sonnet-5')
  const step = {
    route: 'ai/jobs',
    hostId: 'host-1',
    model: 'claude-sonnet-5',
    tier: 'entitled' as const,
    usage,
    docsPaths: [],
    stopReason: 'tool_use',
    uid: 'member-1',
    kind: 'page' as const,
  }

  it('splits each model request’s tokens and measured cost by kind, and leaves a docs answer out', async () => {
    await recordAssistCost(firestore(), ORG, step, NOW)
    await recordAssistCost(firestore(), ORG, step, NOW)
    await recordAssistExchange(
      firestore(),
      ORG,
      {
        route: '/acme/hosts',
        hostId: null,
        model: 'docs-retrieval',
        tier: 'entitled',
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        docsPaths: ['/building-sites/publish'],
        stopReason: null,
        deflected: true,
        uid: 'member-1',
        question: 'How do I publish?',
        answer: 'Press Publish.',
      },
      NOW,
    )
    const month = mockDocs.get(orgMonthPath)
    expect(month?.['kinds']).toEqual({
      page: {
        requests: 2,
        estCostUsd: cost * 2,
        // Both figures per kind (AGL-3015), so the staff card can ask what a
        // kind COST without reading what it drew.
        providerCostUsd: providerCost * 2,
        tokens: { input: 2_400, cached: 6_000, cacheWrite: 800, output: 600 },
      },
    })
    expect(providerCost).toBeLessThan(cost)
    // The month's own totals keep counting every request, as they always did.
    expect(month).toMatchObject({
      inputTokens: 2_400,
      cacheReadTokens: 6_000,
      cacheWriteTokens: 800,
      outputTokens: 600,
    })
  })

  it('names the kind on the signal, and adds the tokens to the person’s month', async () => {
    await recordAssistCost(firestore(), ORG, step, NOW)
    const signals = [...mockDocs.entries()]
      .filter(([path]) => path.includes('/assistSignals/'))
      .map(([, data]) => data)
    expect(signals).toEqual([expect.objectContaining({ kind: 'page', route: 'ai/jobs' })])
    expect(mockDocs.get(`orgs/${ORG}/aiUsageByUser/member-1/months/2026-08`)).toMatchObject({
      estCostUsd: cost,
      tokens: { input: 1_200, cached: 3_000, cacheWrite: 400, output: 300 },
    })
  })

  it('reads a chat turn as assist, whatever route it was asked from', async () => {
    await recordAssistExchange(
      firestore(),
      ORG,
      { ...step, route: '/acme/hosts/host-1/besigner', kind: undefined, question: 'q', answer: 'a' },
      NOW,
    )
    expect(mockDocs.get(orgMonthPath)?.['kinds']).toMatchObject({ assist: { requests: 1 } })
  })
})

describe('Starter WITH the AI add-on is metered like the plan whose rate it carries (AGL-3014)', () => {
  const monthPath = `orgs/${ORG}/assistUsage/2026-08`
  /** The add-on's band on Starter, sold past at $3.00 per 1,000. */
  const ADDON_BAND = 4_000
  const starterWithAi = { plan: 'starter' as const, seatAddons: { aiAddon: 1 } }
  /** 2,000 credits past the band: $6.00 at the add-on's rate. */
  const PAST_ADDON_BAND = {
    messages: 12,
    estCostUsd: assistUsdFromCredits(ADDON_BAND + 2_000),
  }

  beforeAll(() => {
    // The band arrives with the plugin's declaration of the add-on, as the
    // declarations manifest registers it in a running app — by a call.
    const { registerAiDeclarations } = require('../declarations') as typeof import('../declarations')
    registerAiDeclarations()
  })

  it('keeps answering past the add-on band, measured against that band', async () => {
    // The gate asks `assistBandRefuses`, the same resolver the card, the
    // alert and the invoice ask, so past the band the workspace is SOLD
    // credits rather than walled — which is what makes the invoice line in
    // `report-usage` a line for credits the workspace actually received.
    mockDocs.set(monthPath, PAST_ADDON_BAND)
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, starterWithAi)
    expect(reservation).toMatchObject({
      allowed: true,
      refusedBy: null,
      costLimitUsd: null,
      budgetUsd: 4,
    })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
    expect(publicAssistQuota(reservation).credits).toEqual({
      used: 6_000,
      limit: ADDON_BAND,
      remaining: 0,
    })
  })

  it('its own ceiling refuses as `cap`, and the door names the ceiling rather than a 429', async () => {
    // `assistRefusedByOverageCap` read the rate off `PLAN_PRICING` before
    // AGL-3014 and answered false here, so the refusal fell through to the
    // doors' generic 429 while the ceiling the workspace set had caused it.
    // FORCED RED by restoring that table read: `assistOwnControlRefusalText`
    // answered null.
    const capped = { ...starterWithAi, assistOverage: { capUsd: 6 } }
    mockDocs.set(monthPath, PAST_ADDON_BAND)
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, capped)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'cap', capReason: 'customer' })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 12 })
    const refusedBy = coreRefusal(reservation.refusedBy)
    expect(assistRefusedByOverageCap(capped, refusedBy)).toBe(true)
    expect(assistOwnControlRefusalText(capped, refusedBy)).toContain('$6.00')
  })

  it('its switch walls the band, and the sentence quotes the rate turning it off buys', async () => {
    const stopped = { ...starterWithAi, assistOverage: { hardCap: true } }
    mockDocs.set(monthPath, PAST_ADDON_BAND)
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, stopped)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band', costLimitUsd: 4 })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 12 })
    expect(assistOwnControlRefusalText(stopped, coreRefusal(reservation.refusedBy))).toContain(
      '$3.00 per 1,000 credits',
    )
  })

  it('THE CONTROL: without the add-on the same spend meets no band, and a stored ceiling binds nothing', async () => {
    // Starter alone sells no band, so there is no overage for a ceiling to
    // reach: only the operator backstop measures it, and $6 is under that.
    mockDocs.set(monthPath, PAST_ADDON_BAND)
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'starter',
      assistOverage: { capUsd: 6 },
    })
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null, budgetUsd: null })
  })
})

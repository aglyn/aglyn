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

export {}

let mockDocs = new Map<string, Record<string, unknown>>()

/** Faithful `increment` + merge semantics (the AGL test-double lesson). */
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

const {
  ASSIST_EXCHANGE_RETENTION_DAYS,
  assistEntitledMonthlyLimit,
  assistExchangeExpiry,
  assistFreeDailyLimit,
  assistMonthlyCeilingUsd,
  ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
  assistOrgMonthlyCostLimitUsd,
  publicAssistQuota,
  recordAssistCost,
  assistUsageDay,
  assistUsageMonth,
  assistRatesForModel,
  checkAssistQuota,
  estimateAssistCostUsd,
  recordAssistExchange,
  recordAssistFeedback,
  releaseAssistMessage,
  reserveAssistMessage,
} = require('./assist-usage') as typeof import('./assist-usage')

const NOW = new Date('2026-08-17T12:00:00Z')
const ORG = 'org-assist'

const firestore = () =>
  mockMakeFirestore() as unknown as FirebaseFirestore.Firestore

beforeEach(() => {
  mockDocs = new Map()
  mockAutoId = 0
  delete process.env.ASSIST_FREE_DAILY_LIMIT
  delete process.env.ASSIST_ENTITLED_MONTHLY_LIMIT
  delete process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD
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
    const cost = estimateAssistCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(cost).toBe(18)
  })

  it('prices cache reads at a tenth of input', () => {
    const cost = estimateAssistCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    })
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

  it('an unknown model id errs HIGH rather than low', () => {
    // A pinned snapshot id, a model released after this table was written,
    // a typo in the env var: none of them may quietly make an org look
    // cheap. The fallback is the dearest tier on purpose.
    const rate = assistRatesForModel('claude-something-not-in-the-table')
    expect(rate.inputPerToken).toBeGreaterThan(
      assistRatesForModel('claude-opus-5').inputPerToken,
    )
    expect(rate.outputPerToken).toBeGreaterThan(
      assistRatesForModel('claude-opus-5').outputPerToken,
    )
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
    expect(mockDocs.get(monthPath)).toBeUndefined()
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
    expect(assistOrgMonthlyCostLimitUsd()).toBe(
      ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
    )
    expect(ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD).toBe(40)
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '120'
    expect(assistOrgMonthlyCostLimitUsd()).toBe(120)
    // Junk must not become a ceiling of $0, which would refuse every
    // workspace on the deployment. Nor an empty string — `Number('')` is 0,
    // the same outage by a different route — and nor NO ceiling, which is
    // the fail-open this whole mechanism closes. All three read as
    // unconfigured and take the default.
    for (const junk of ['forty dollars', '', '  ', '-5', '0']) {
      process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = junk
      expect(assistOrgMonthlyCostLimitUsd()).toBe(
        ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
      )
    }
    // Removing it takes a WORD, so nobody reaches "no ceiling" by mistyping
    // a digit — every mistyped digit above landed on the default instead.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = 'OFF'
    expect(assistOrgMonthlyCostLimitUsd()).toBeNull()
  })

  it('REFUSES an entitled org over the ceiling, and moves no counter', async () => {
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '40'
    // Note what is NOT wrong here: 12 messages against a 1,000-message
    // guard. The org has 988 messages in hand and is refused anyway, which
    // is the entire point — the messages were dear, not many.
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 41.5 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW)
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
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW)
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
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW)
    expect(reservation).toMatchObject({ allowed: true, costUsd: null })
    // And with a ceiling configured the same call DOES look, so the null
    // above means "not consulted" rather than "never reads this field".
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '999'
    const looked = await reserveAssistMessage(firestore(), ORG, false, NOW)
    expect(looked).toMatchObject({ allowed: true, costUsd: 41.5 })
  })

  it('THE SECOND NEGATIVE CONTROL: a dollar under the ceiling still reserves', async () => {
    // And this one stops a build that merely refuses whenever a ceiling is
    // configured, which would pass both tests above.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '40'
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 39 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW)
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
  })

  it('binds the FREE tier too, whose gate is a different document', async () => {
    // The free tier gates on `counters/assistMessagesDaily`, so the spend
    // figure is in a document the reservation would otherwise never open.
    // A build that reads the ceiling off the gate document passes every
    // entitled test above and leaves the free tier unbounded.
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '40'
    mockDocs.set(dailyPath, { '2026-08-17': 0 })
    mockDocs.set(monthPath, { messages: 400, estCostUsd: 45 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW)
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
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW)
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
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW)
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
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW)
    expect(reservation).toMatchObject({ allowed: true, refusedBy: null })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 951 })
  })

  it('and the DEFAULT binds the free tier too, without a separate figure', async () => {
    // The free tier needs no ceiling of its own — 10 messages a UTC day
    // bounds it at roughly $0.28/day — but it must not be EXEMPT from this
    // one, or a tier-scoped read would leave the unpriced surface unbounded.
    expect(process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD).toBeUndefined()
    mockDocs.set(dailyPath, { '2026-08-17': 0 })
    mockDocs.set(monthPath, { messages: 400, estCostUsd: 4_000 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW)
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
    const rate = assistRatesForModel('claude-sonnet-5')
    const expected =
      1200 * rate.inputPerToken +
      300 * rate.outputPerToken +
      800 * rate.cacheReadPerToken +
      100 * rate.cacheWritePerToken
    expect(Number(month?.estCostUsd)).toBeCloseTo(expected, 9)
    // Every term is load-bearing: a formula that dropped the cache columns
    // would still be proportional to the tokens and still positive.
    expect(Number(month?.estCostUsd)).not.toBeCloseTo(
      1200 * rate.inputPerToken + 300 * rate.outputPerToken,
      9,
    )
    expect(Number(signal?.estCostUsd)).toBeCloseTo(expected, 9)
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
    const org = { plan: 'pro' as const }
    // Forty builds spend $9.17 against a $7.50 Pro band; forty questions
    // spend $0.51 of it. Same forty turns either way — under a message
    // allowance these two workspaces are indistinguishable.
    for (let i = 0; i < 40; i += 1) {
      await recordAssistCost(store, ORG, signal(A_SCREEN_BUILD), NOW)
    }
    const afterBuilds = await reserveAssistMessage(store, ORG, true, NOW, org)
    expect(afterBuilds).toMatchObject({ allowed: false, refusedBy: 'budget' })

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

  it('REFUSES a Business org at its band, well under the $40 default', async () => {
    // $8 of spend against a $7.50 band. The repo default is $40, so a build
    // that ignored the plan band would let this through — which is precisely
    // the fail-open under test.
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 8 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'business',
    })
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'budget',
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
    })
    expect(reservation).toMatchObject({
      allowed: true,
      refusedBy: null,
      costLimitUsd: 58,
      budgetUsd: 58,
    })
    expect(mockDocs.get(monthPath)).toMatchObject({ messages: 13 })
  })

  it('and still refuses that Agency org at ITS band', async () => {
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 59 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'agency',
    })
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'budget' })
  })

  it('takes a CONTRACTED Enterprise band over the plan fallback', async () => {
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 100 })
    // The fallback is 87,000 credits — $87 — so this org is over it.
    const onFallback = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'enterprise',
    })
    expect(onFallback).toMatchObject({
      allowed: false,
      refusedBy: 'budget',
      costLimitUsd: 87,
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
    // Free and Starter sell no assist band. Their assistant is bounded by the
    // daily message cap and by the operator backstop, exactly as before.
    expect(assistMonthlyCeilingUsd(null)).toBe(
      ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD,
    )
    mockDocs.set(monthPath, { messages: 400, estCostUsd: 45 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, {
      plan: 'free',
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
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'agency',
    })
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'budget' })
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
    // band and enforces nothing — the defect this work exists to close.
    mockDocs.set(monthPath, { messages: 12, estCostUsd: 1 })
    const reservation = await reserveAssistMessage(firestore(), ORG, true, NOW, {
      plan: 'business',
      entitlements: { assistCreditsPerMonth: 500 },
    })
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'budget',
      budgetUsd: 0.5,
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
    // A Free workspace refused at the operator backstop has no credit balance.
    // Converting $40 into "40,000 credits" would name a band it never bought.
    mockDocs.set(monthPath, { messages: 400, estCostUsd: 45 })
    const reservation = await reserveAssistMessage(firestore(), ORG, false, NOW, {
      plan: 'free',
    })
    expect(reservation.allowed).toBe(false)
    expect(publicAssistQuota(reservation).credits).toBeNull()
  })
})

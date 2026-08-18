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

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    firestore: {
      FieldValue: {
        increment: (n: number) => ({ __inc: n }),
        serverTimestamp: () => '__now__',
      },
    },
  },
}))

const {
  ASSIST_EXCHANGE_RETENTION_DAYS,
  assistEntitledMonthlyLimit,
  assistExchangeExpiry,
  assistFreeDailyLimit,
  assistUsageDay,
  assistUsageMonth,
  assistRatesForModel,
  checkAssistQuota,
  estimateAssistCostUsd,
  recordAssistExchange,
  recordAssistFeedback,
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

    expect(
      mockDocs.get(`orgs/${ORG}/counters/assistMessagesDaily`),
    ).toMatchObject({ '2026-08-17': 1 })

    const month = mockDocs.get(`orgs/${ORG}/assistUsage/2026-08`)
    expect(month).toMatchObject({
      month: '2026-08',
      messages: 1,
      inputTokens: 1200,
      outputTokens: 300,
    })
    expect(Number(month?.estCostUsd)).toBeGreaterThan(0)
  })

  it('a second exchange ACCUMULATES rather than replacing', async () => {
    const store = firestore()
    await recordAssistExchange(store, ORG, record, NOW)
    await recordAssistExchange(store, ORG, record, NOW)
    expect(
      mockDocs.get(`orgs/${ORG}/counters/assistMessagesDaily`),
    ).toMatchObject({ '2026-08-17': 2 })
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/2026-08`)).toMatchObject({
      messages: 2,
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

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
 * @jest-environment node
 */

const docs = new Map<string, Record<string, unknown>>()
let writes = 0
const raised: Array<{ type: string; options: Record<string, any> }> = []

const fakeFirestore = {
  collection: (name: string) => ({
    get: async () => ({
      docs: [...docs.entries()]
        .filter(([path]) => path.startsWith(`${name}/`))
        .map(([, data]) => ({ data: () => ({ ...data }) })),
    }),
    doc: (id: string) => {
      const path = `${name}/${id}`
      return {
        path,
        get: async () => ({
          exists: docs.has(path),
          get: (field: string) => docs.get(path)?.[field],
        }),
      }
    },
  }),
  // One at a time, as Firestore's retries make two transactions on one
  // document behave.
  runTransaction: (work: (transaction: any) => Promise<unknown>) => {
    const run = transactions.then(() => runOne(work))
    transactions = run.catch(() => undefined)
    return run
  },
}

let transactions: Promise<unknown> = Promise.resolve()

function runOne(work: (transaction: any) => Promise<unknown>) {
  return work({
    get: async (ref: { path: string }) => ({
      exists: docs.has(ref.path),
      data: () => docs.get(ref.path),
    }),
    set: (ref: { path: string }, data: Record<string, unknown>) => {
      writes += 1
      docs.set(ref.path, { ...data })
    },
    update: (ref: { path: string }, data: Record<string, unknown>) => {
      writes += 1
      docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data })
    },
  })
}

jest.mock('./firebase-admin', () => {
  const admin = { app: () => ({ firestore: () => fakeFirestore }) }
  return { __esModule: true, default: admin, firebaseAdmin: admin }
})
jest.mock('./operator-alerts', () => ({
  raiseOperatorAlert: async (type: string, options: Record<string, unknown>) => {
    raised.push({ type, options })
    return { outcome: 'delivered', type }
  },
}))

import {
  describeHealthDuration,
  escalateStillDegradedHealth,
  healthEscalationStep,
  healthStateOfBody,
  recordHealthState,
  resetOperatorHealthCacheForTests,
} from './operator-health'

beforeEach(() => {
  docs.clear()
  writes = 0
  raised.length = 0
  resetOperatorHealthCacheForTests()
})

describe('recordHealthState (AGL-3377)', () => {
  it('says nothing about a check first seen healthy', async () => {
    expect(await recordHealthState('crons', 'ok', 'All checks pass.')).toBeNull()
    expect(raised).toHaveLength(0)
    expect(docs.get('operatorHealthState/crons')).toMatchObject({ status: 'ok' })
  })

  it('raises degraded on the edge, once, and recovered on the way back', async () => {
    const t0 = 1_000_000_000_000
    await recordHealthState('crons', 'ok', 'fine', { label: 'Scheduled jobs', now: t0 })
    expect(await recordHealthState('crons', 'degraded', 'Failing: report-usage (job-silent).', { label: 'Scheduled jobs', now: t0 + 1 })).toBe('degraded')
    // Another poll of the same state, on this instance or another: no edge.
    expect(await recordHealthState('crons', 'degraded', 'still', { now: t0 + 2 })).toBeNull()
    resetOperatorHealthCacheForTests()
    expect(await recordHealthState('crons', 'degraded', 'still', { now: t0 + 3 })).toBeNull()
    expect(await recordHealthState('crons', 'ok', 'fine', { label: 'Scheduled jobs', now: t0 + 1 + 65 * 60_000 })).toBe('recovered')
    expect(raised).toEqual([
      {
        type: 'system.healthDegraded',
        options: { dedupeKey: 'crons', context: { check: 'Scheduled jobs', detail: 'Failing: report-usage (job-silent).' } },
      },
      {
        type: 'system.healthRecovered',
        options: { dedupeKey: 'crons', context: { check: 'Scheduled jobs', duration: '1 h 5 min' } },
      },
    ])
  })

  it('a new instance that finds the stored status unchanged writes nothing', async () => {
    await recordHealthState('crons', 'ok', 'fine')
    expect(writes).toBe(1)
    resetOperatorHealthCacheForTests()
    expect(await recordHealthState('crons', 'ok', 'fine again')).toBeNull()
    expect(writes).toBe(1)
    expect(docs.get('operatorHealthState/crons')).toMatchObject({ detail: 'fine' })
  })

  it('an install broken before anybody watched is told', async () => {
    expect(await recordHealthState('backups', 'degraded', 'Failing: exports (stale).')).toBe('degraded')
    expect(raised.map((entry) => entry.type)).toEqual(['system.healthDegraded'])
  })
})

describe('escalateStillDegradedHealth (AGL-3860)', () => {
  const MIN = 60_000
  const t0 = 1_000_000_000_000
  const stillDegraded = () => raised.filter((entry) => entry.type === 'system.healthStillDegraded')

  async function degradeJourneys() {
    await recordHealthState('console-journeys', 'ok', 'All checks pass.', { label: 'Console journeys', now: t0 - MIN })
    await recordHealthState('console-journeys', 'degraded', 'Failing: sign-in (app-check-denied).', {
      label: 'Console journeys',
      now: t0,
    })
    raised.length = 0
  }

  it('owes the first reminder at 1 h and one every 2 h after', () => {
    expect(healthEscalationStep(59 * MIN)).toBe(0)
    expect(healthEscalationStep(60 * MIN)).toBe(1)
    expect(healthEscalationStep(179 * MIN)).toBe(1)
    expect(healthEscalationStep(180 * MIN)).toBe(2)
    expect(healthEscalationStep(300 * MIN)).toBe(3)
  })

  it('a check degraded for 61 min raises exactly one reminder, and the second only 2 h later', async () => {
    await degradeJourneys()
    // Not yet an hour: nothing.
    expect(await escalateStillDegradedHealth({ now: t0 + 59 * MIN })).toEqual([])

    expect(await escalateStillDegradedHealth({ now: t0 + 61 * MIN })).toEqual([
      { checkId: 'console-journeys', step: 1, tier: 'should', outcome: 'delivered' },
    ])
    expect(stillDegraded()).toEqual([
      {
        type: 'system.healthStillDegraded',
        options: {
          dedupeKey: 'console-journeys:1',
          tier: 'should',
          context: {
            check: 'Console journeys',
            duration: '1 h 1 min',
            detail: 'Failing: sign-in (app-check-denied).',
          },
        },
      },
    ])

    // Every tick for the next two hours, on this instance or another: quiet.
    for (let minute = 76; minute < 181; minute += 15) {
      resetOperatorHealthCacheForTests()
      expect(await escalateStillDegradedHealth({ now: t0 + minute * MIN })).toEqual([])
    }
    expect(stillDegraded()).toHaveLength(1)

    // Two more hours: the second, and by now it is a must-know.
    expect(await escalateStillDegradedHealth({ now: t0 + 181 * MIN })).toEqual([
      { checkId: 'console-journeys', step: 2, tier: 'must', outcome: 'delivered' },
    ])
    expect(stillDegraded()).toHaveLength(2)
    expect(stillDegraded()[1].options).toMatchObject({
      dedupeKey: 'console-journeys:2',
      tier: 'must',
      context: { duration: '3 h 1 min' },
    })
    expect(await escalateStillDegradedHealth({ now: t0 + 196 * MIN })).toEqual([])
  })

  it('two ticks reading the same states tell each step once', async () => {
    await degradeJourneys()
    const states = [{ ...docs.get('operatorHealthState/console-journeys') }] as any
    const [first, second] = await Promise.all([
      escalateStillDegradedHealth({ now: t0 + 61 * MIN, states }),
      escalateStillDegradedHealth({ now: t0 + 61 * MIN, states }),
    ])
    expect([...first, ...second]).toHaveLength(1)
    expect(stillDegraded()).toHaveLength(1)
  })

  it('a check that recovered in between is not reminded, and a new incident starts over', async () => {
    await degradeJourneys()
    const stale = [{ ...docs.get('operatorHealthState/console-journeys') }] as any
    await recordHealthState('console-journeys', 'ok', 'All checks pass.', { now: t0 + 30 * MIN })
    // A tick that listed the states before the recovery landed.
    expect(await escalateStillDegradedHealth({ now: t0 + 61 * MIN, states: stale })).toEqual([])

    await recordHealthState('console-journeys', 'degraded', 'Failing: sign-in.', { now: t0 + 90 * MIN })
    raised.length = 0
    expect(await escalateStillDegradedHealth({ now: t0 + 151 * MIN })).toMatchObject([
      { checkId: 'console-journeys', step: 1, tier: 'should' },
    ])
  })

  it('a sweep that was down for hours tells only the latest step', async () => {
    await degradeJourneys()
    expect(await escalateStillDegradedHealth({ now: t0 + 301 * MIN })).toEqual([
      { checkId: 'console-journeys', step: 3, tier: 'must', outcome: 'delivered' },
    ])
    expect(stillDegraded()).toHaveLength(1)
  })

  it('says nothing about a healthy check, and a dry run raises nothing', async () => {
    await recordHealthState('crons', 'ok', 'fine', { now: t0 })
    await degradeJourneys()
    expect(await escalateStillDegradedHealth({ now: t0 + 61 * MIN, dryRun: true })).toEqual([
      { checkId: 'console-journeys', step: 1, tier: 'should', outcome: 'dry-run' },
    ])
    expect(raised).toHaveLength(0)
    expect(docs.get('operatorHealthState/console-journeys')?.['escalatedStep']).toBeUndefined()
  })
})

describe('healthStateOfBody', () => {
  it('reads the endpoint’s own verdict and names each failing check', () => {
    expect(
      healthStateOfBody(
        { status: 'degraded', checks: { backups: { ok: true }, exports: { ok: false, code: 'stale' } } },
        503,
      ),
    ).toEqual({ status: 'degraded', detail: 'Failing: exports (stale).' })
    expect(healthStateOfBody({ status: 'ok', checks: { a: { ok: true } } }, 200)).toEqual({
      status: 'ok',
      detail: 'All checks pass.',
    })
    expect(healthStateOfBody(null, null).status).toBe('degraded')
  })
})

describe('describeHealthDuration', () => {
  it('rounds to what a person reads', () => {
    expect(describeHealthDuration(30_000)).toBe('1 min')
    expect(describeHealthDuration(2 * 3_600_000)).toBe('2 h')
    expect(describeHealthDuration(72 * 3_600_000)).toBe('3 days')
  })
})

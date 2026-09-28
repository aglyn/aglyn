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
const raised: Array<{ type: string; options: Record<string, any> }> = []

const fakeFirestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}` }),
  }),
  runTransaction: async (work: (transaction: any) => Promise<unknown>) =>
    work({
      get: async (ref: { path: string }) => ({
        exists: docs.has(ref.path),
        data: () => docs.get(ref.path),
      }),
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        docs.set(ref.path, { ...data })
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data })
      },
    }),
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
  healthStateOfBody,
  recordHealthState,
  resetOperatorHealthCacheForTests,
} from './operator-health'

beforeEach(() => {
  docs.clear()
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

  it('an install broken before anybody watched is told', async () => {
    expect(await recordHealthState('backups', 'degraded', 'Failing: exports (stale).')).toBe('degraded')
    expect(raised.map((entry) => entry.type)).toEqual(['system.healthDegraded'])
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

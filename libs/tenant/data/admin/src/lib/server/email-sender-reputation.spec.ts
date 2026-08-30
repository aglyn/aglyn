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
 * THE DURABLE HALF OF THE PER-TENANT CONTROLS.
 *
 * The policy is graded in `sender-reputation.spec.ts`; this covers the three
 * things the storage adds and the policy cannot have opinions about:
 *
 *  - the counters land where a rate can find them, on the day they happened;
 *  - the day's ramp is a CLAIM, so two campaigns in the same day cannot both
 *    take the last of it, and an undelivered remainder is given back;
 *  - every one of them FAILS OPEN. A control that refused a paying customer's
 *    campaign because of a Firestore blip would be an outage wearing a
 *    policy's clothes, and that is checked by breaking the store rather than
 *    by trusting the `catch`.
 */

function increment(value: number) {
  return { __increment: value }
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function mergeInto(
  existing: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const next = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && '__increment' in value) {
      next[key] = Number(existing[key] ?? 0) + Number(value['__increment'])
    } else {
      next[key] = value
    }
  }
  return next
}

const store = new Map<string, Record<string, any>>()
/** Flipped on to make every read and write throw, for the fail-open checks. */
let broken = false

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    exists: data !== undefined,
    id: path.split('/').pop() as string,
    ref: { path },
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    path,
    id: path.split('/').pop() as string,
    get: async () => {
      if (broken) throw new Error('firestore unavailable')
      return snapshotOf(path)
    },
    set: async (value: Record<string, any>) => {
      if (broken) throw new Error('firestore unavailable')
      store.set(path, mergeInto(store.get(path) ?? {}, value))
    },
  }
}

function mockFirestore(): any {
  return {
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${name}/${id}`),
    }),
    getAll: async (...refs: any[]) => {
      if (broken) throw new Error('firestore unavailable')
      return refs.map((ref) => snapshotOf(String(ref.path)))
    },
    runTransaction: async (body: (tx: any) => Promise<any>) => {
      if (broken) throw new Error('firestore unavailable')
      return body({
        get: async (ref: any) => snapshotOf(String(ref.path)),
        set: async (ref: any, value: Record<string, any>) => {
          store.set(
            String(ref.path),
            mergeInto(store.get(String(ref.path)) ?? {}, value),
          )
        },
      })
    },
  }
}

function adminDouble() {
  return {
    app: () => ({ firestore: () => mockFirestore() }),
    firestore: { FieldValue: { increment } },
  }
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: adminDouble(),
  firebaseAdmin: adminDouble(),
}))

import { EMAIL_RAMP_STEPS, emailRampVerdict } from '@aglyn/shared-util-email'
import {
  claimOrgEmailSendDay,
  emailReputationDocId,
  orgAgeDays,
  readSenderReputation,
  readSenderReputationWindow,
  reconcileOrgEmailSendDay,
  recordCampaignAccepted,
  recordEmailReputationFailure,
  resolveOrgEmailRamp,
} from './email-sender-reputation'

const ORG = 'org-1'
const NOW = Date.UTC(2026, 7, 30, 12)
const YESTERDAY = NOW - 86_400_000
const LONG_AGO = NOW - 30 * 86_400_000

beforeEach(() => {
  store.clear()
  broken = false
})

const db = () => mockFirestore()

describe('the counters', () => {
  it('file each event under the day it happened', async () => {
    await recordCampaignAccepted(ORG, 100, { atMs: NOW, firestore: db() })
    await recordEmailReputationFailure(ORG, 'bounce', {
      atMs: NOW,
      firestore: db(),
    })
    await recordEmailReputationFailure(ORG, 'complaint', {
      atMs: YESTERDAY,
      firestore: db(),
    })

    expect(
      store.get(`rateLimits/${emailReputationDocId('2026-08-30', ORG)}`),
    ).toMatchObject({ accepted: 100, bounced: 1 })
    expect(
      store.get(`rateLimits/${emailReputationDocId('2026-08-29', ORG)}`),
    ).toMatchObject({ complained: 1 })
  })

  it('carries an expiry so the window prunes itself', async () => {
    await recordCampaignAccepted(ORG, 1, { atMs: NOW, firestore: db() })
    const doc = store.get(`rateLimits/${emailReputationDocId('2026-08-30', ORG)}`)
    expect(doc?.['expiresAt']).toBeInstanceOf(Date)
    // NOT `lastAtMs` — the rate-limiter health probe queries this collection
    // on that field, and a per-day document in its range would compete with
    // the degradation markers it exists to find.
    expect(doc).not.toHaveProperty('lastAtMs')
  })

  it('records nothing for a workspace it cannot name', async () => {
    await recordCampaignAccepted('', 100, { atMs: NOW, firestore: db() })
    await recordCampaignAccepted(ORG, 0, { atMs: NOW, firestore: db() })
    await recordCampaignAccepted(ORG, -5, { atMs: NOW, firestore: db() })
    expect([...store.keys()]).toEqual([])
  })

  it('never throws — bookkeeping cannot break a delivered send', async () => {
    broken = true
    await expect(
      recordCampaignAccepted(ORG, 100, { atMs: NOW, firestore: db() }),
    ).resolves.toBeUndefined()
  })
})

describe('the window', () => {
  it('sums the days a rate divides by, and only those', async () => {
    await recordCampaignAccepted(ORG, 100, { atMs: NOW, firestore: db() })
    await recordCampaignAccepted(ORG, 200, { atMs: YESTERDAY, firestore: db() })
    // Outside the seven-day window.
    await recordCampaignAccepted(ORG, 999, { atMs: LONG_AGO, firestore: db() })

    const window = await readSenderReputationWindow({
      orgId: ORG,
      now: NOW,
      firestore: db(),
    })
    expect(window.accepted).toBe(300)
    expect(window.degraded).toBe(false)
  })

  it('reads today’s ramp claim without a second query', async () => {
    await claimOrgEmailSendDay({
      orgId: ORG,
      count: 60,
      ramp: emailRampVerdict({
        ageDays: 0,
        deliveredLifetime: 0,
        graduatedPerDay: 12_000,
      }),
      now: NOW,
      firestore: db(),
    })
    const window = await readSenderReputationWindow({
      orgId: ORG,
      now: NOW,
      firestore: db(),
    })
    expect(window.claimedToday).toBe(60)
  })

  it('grades OK when the store is unreachable', async () => {
    broken = true
    const verdict = await readSenderReputation({
      orgId: ORG,
      now: NOW,
      firestore: db(),
    })
    // Fails OPEN. A refusal produced by a Firestore blip is a refused
    // campaign for a paying customer, and the reputation risk it misses is
    // bounded by an hour of sending.
    expect(verdict.degraded).toBe(true)
    expect(verdict.blocked).toBe(false)
  })

  it('grades a real window through the real policy', async () => {
    await recordCampaignAccepted(ORG, 10_000, { atMs: NOW, firestore: db() })
    for (let index = 0; index < 30; index += 1) {
      await recordEmailReputationFailure(ORG, 'complaint', {
        atMs: NOW,
        firestore: db(),
      })
    }
    const verdict = await readSenderReputation({
      orgId: ORG,
      now: NOW,
      firestore: db(),
    })
    expect(verdict.blocked).toBe(true)
    expect(verdict.complaintRate).toBeCloseTo(0.003)
  })
})

describe('the day’s ramp claim', () => {
  const step0 = emailRampVerdict({
    ageDays: 0,
    deliveredLifetime: 0,
    graduatedPerDay: 12_000,
  })

  it('grants up to the step and refuses past it', async () => {
    const first = await claimOrgEmailSendDay({
      orgId: ORG,
      count: EMAIL_RAMP_STEPS[0].perDay,
      ramp: step0,
      now: NOW,
      firestore: db(),
    })
    expect(first.allowed).toBe(true)
    expect(first.reservation).toMatchObject({
      claimed: EMAIL_RAMP_STEPS[0].perDay,
    })
    // The claim lands on the SAME document the rates divide by, carries its
    // own expiry, and — like every other document in this collection — must
    // not carry `lastAtMs`, which the rate-limiter health probe queries on.
    const claimed = store.get(
      `rateLimits/${emailReputationDocId('2026-08-30', ORG)}`,
    )
    expect(claimed?.['expiresAt']).toBeInstanceOf(Date)
    expect(claimed).not.toHaveProperty('lastAtMs')

    const second = await claimOrgEmailSendDay({
      orgId: ORG,
      count: 1,
      ramp: step0,
      now: NOW,
      firestore: db(),
    })
    expect(second.allowed).toBe(false)
    // A refused claim writes NOTHING — a campaign that resumes tomorrow must
    // not have spent tomorrow's budget on being told no.
    expect(
      store.get(`rateLimits/${emailReputationDocId('2026-08-30', ORG)}`)?.[
        'claimed'
      ],
    ).toBe(EMAIL_RAMP_STEPS[0].perDay)
  })

  it('grants the last message of the day — the ceiling holds at its own edge', async () => {
    await claimOrgEmailSendDay({
      orgId: ORG,
      count: EMAIL_RAMP_STEPS[0].perDay - 1,
      ramp: step0,
      now: NOW,
      firestore: db(),
    })
    const last = await claimOrgEmailSendDay({
      orgId: ORG,
      count: 1,
      ramp: step0,
      now: NOW,
      firestore: db(),
    })
    expect(last.allowed).toBe(true)
  })

  it('claims nothing at all for a graduated workspace', async () => {
    const graduated = emailRampVerdict({
      ageDays: 400,
      deliveredLifetime: 0,
      graduatedPerDay: 12_000,
    })
    const claim = await claimOrgEmailSendDay({
      orgId: ORG,
      count: 500,
      ramp: graduated,
      now: NOW,
      firestore: db(),
    })
    expect(claim.allowed).toBe(true)
    expect(claim.reservation).toBeNull()
    expect([...store.keys()]).toEqual([])
  })

  it('gives back the part of a claim that did not go out', async () => {
    const claim = await claimOrgEmailSendDay({
      orgId: ORG,
      count: 100,
      ramp: step0,
      now: NOW,
      firestore: db(),
    })
    await reconcileOrgEmailSendDay(claim.reservation, 40, db())
    expect(
      store.get(`rateLimits/${emailReputationDocId('2026-08-30', ORG)}`)?.[
        'claimed'
      ],
    ).toBe(40)
  })

  it('never drives the counter below zero, and never throws', async () => {
    const claim = await claimOrgEmailSendDay({
      orgId: ORG,
      count: 10,
      ramp: step0,
      now: NOW,
      firestore: db(),
    })
    // A refund larger than the counter — a second reconcile of the same
    // reservation, which the `finally` can produce on a retry.
    await reconcileOrgEmailSendDay(claim.reservation, 0, db())
    await reconcileOrgEmailSendDay(claim.reservation, 0, db())
    expect(
      store.get(`rateLimits/${emailReputationDocId('2026-08-30', ORG)}`)?.[
        'claimed'
      ],
    ).toBe(0)
    broken = true
    await expect(
      reconcileOrgEmailSendDay(claim.reservation, 0, db()),
    ).resolves.toBeUndefined()
  })

  it('grants when the store is unreachable', async () => {
    broken = true
    const claim = await claimOrgEmailSendDay({
      orgId: ORG,
      count: 500,
      ramp: step0,
      now: NOW,
      firestore: db(),
    })
    expect(claim.allowed).toBe(true)
    expect(claim.degraded).toBe(true)
  })

  it('grants while the control is parked', async () => {
    const claim = await claimOrgEmailSendDay({
      orgId: ORG,
      count: 5_000,
      ramp: step0,
      enabled: false,
      now: NOW,
      firestore: db(),
    })
    expect(claim.allowed).toBe(true)
    // A parked control still reports a real ceiling, so a surface reading it
    // does not blank while the control is off.
    expect(claim.ceiling).toBe(EMAIL_RAMP_STEPS[0].perDay)
  })
})

describe('a workspace’s age', () => {
  it('reads a Firestore Timestamp, a number and an ISO string', () => {
    expect(orgAgeDays({ toMillis: () => LONG_AGO }, NOW)).toBe(30)
    expect(orgAgeDays(LONG_AGO, NOW)).toBe(30)
    expect(orgAgeDays(new Date(LONG_AGO).toISOString(), NOW)).toBe(30)
    expect(orgAgeDays({ seconds: Math.floor(LONG_AGO / 1000) }, NOW)).toBe(30)
  })

  it('answers null for a record that carries no date', () => {
    // Which `resolveOrgEmailRamp` reads as graduated. Reading it as "created
    // today" would ramp every existing paying customer down on the deploy.
    expect(orgAgeDays(undefined, NOW)).toBeNull()
    expect(orgAgeDays(null, NOW)).toBeNull()
    expect(orgAgeDays({}, NOW)).toBeNull()
    expect(orgAgeDays('not a date', NOW)).toBeNull()
    expect(
      resolveOrgEmailRamp({
        ageDays: orgAgeDays(undefined, NOW),
        deliveredLifetime: 0,
        platformPerHour: 2_000,
      }).graduated,
    ).toBe(true)
  })
})

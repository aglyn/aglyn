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
 * The lockdown verdict (AGL-1501), and above all THE UN-PANIC INVARIANT:
 * a platform-wide lockdown must never lock out the staff who can lift it.
 * The `staff: true` cases below are the proof this brief demanded — if one
 * of them goes red, do not ship the change that did it.
 */

type Doc = Record<string, unknown>

const store = new Map<string, Doc>()
let reads = 0
let failReads = false

const db = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      async get() {
        reads += 1
        if (failReads) throw new Error('firestore unavailable')
        const data = store.get(`${name}/${id}`)
        return {
          exists: data !== undefined,
          data: () => data,
        }
      },
    }),
  }),
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => db }),
  },
}))

import {
  getLockdownVerdict,
  getPlatformLockdown,
  getUserLockdown,
  invalidatePlatformLockdownCache,
  lockdownJsonResponse,
} from './lockdown'

const NOW = 1_755_000_000_000

beforeEach(() => {
  store.clear()
  reads = 0
  failReads = false
  invalidatePlatformLockdownCache()
})

const lockPlatform = (over: Doc = {}) =>
  store.set('lockdowns/platform', {
    scope: 'platform',
    reason: 'security',
    atMs: NOW,
    actorUid: 'staff-1',
    ...over,
  })

const lockUser = (uid: string, over: Doc = {}) =>
  store.set(`lockdowns/user--${uid}`, {
    scope: 'user',
    reason: 'manual',
    atMs: NOW,
    ...over,
  })

describe('THE UN-PANIC INVARIANT: staff bypass every scope, always', () => {
  it('a PLATFORM lockdown leaves a staff caller a null verdict', async () => {
    lockPlatform()
    await expect(
      getLockdownVerdict({ staff: true, uid: 'staff-1', nowMs: NOW }),
    ).resolves.toBeNull()
  })

  it('staff bypass org, host and user scopes too — even all at once', async () => {
    lockPlatform()
    lockUser('staff-1')
    await expect(
      getLockdownVerdict({
        staff: true,
        uid: 'staff-1',
        org: { suspendedAt: { seconds: 1 } },
        host: { suspendedAt: NOW },
        nowMs: NOW,
      }),
    ).resolves.toBeNull()
  })

  it('the staff verdict performs NO reads, so it cannot depend on one failing', async () => {
    lockPlatform()
    failReads = true
    await expect(
      getLockdownVerdict({ staff: true, uid: 'staff-1', nowMs: NOW }),
    ).resolves.toBeNull()
    expect(reads).toBe(0)
  })

  it('...while the same platform lockdown DOES lock a non-staff caller', async () => {
    lockPlatform()
    const verdict = await getLockdownVerdict({
      staff: false,
      uid: 'customer-1',
      nowMs: NOW,
    })
    expect(verdict?.scope).toBe('platform')
    expect(verdict?.reason).toBe('security')
  })
})

describe('scope targeting', () => {
  it('a user lockdown hits only that user', async () => {
    lockUser('bad-actor')
    const locked = await getLockdownVerdict({ uid: 'bad-actor', nowMs: NOW })
    expect(locked?.scope).toBe('user')
    await expect(
      getLockdownVerdict({ uid: 'innocent', nowMs: NOW }),
    ).resolves.toBeNull()
  })

  it('an org lockdown resolves from the passed org doc without a read', async () => {
    const verdict = await getLockdownVerdict({
      org: { suspendedAt: { seconds: 1 }, suspendedReasonCode: 'billing' },
      nowMs: NOW,
    })
    expect(verdict?.scope).toBe('org')
    expect(verdict?.reason).toBe('billing')
  })

  it('platform outranks a narrower scope in the reported verdict', async () => {
    lockPlatform({ reason: 'maintenance' })
    const verdict = await getLockdownVerdict({
      org: { suspendedAt: { seconds: 1 }, suspendedReasonCode: 'billing' },
      nowMs: NOW,
    })
    expect(verdict?.scope).toBe('platform')
    expect(verdict?.reason).toBe('maintenance')
  })

  it('an expired lockdown restores access with no staff action', async () => {
    lockPlatform({ reason: 'maintenance', untilMs: NOW - 1 })
    await expect(getLockdownVerdict({ nowMs: NOW })).resolves.toBeNull()
  })
})

describe('fail-open on infrastructure error', () => {
  it('an unreachable Firestore is an outage, not a lockdown', async () => {
    failReads = true
    await expect(
      getLockdownVerdict({ uid: 'customer-1', nowMs: NOW }),
    ).resolves.toBeNull()
    await expect(getPlatformLockdown()).resolves.toBeNull()
    await expect(getUserLockdown('customer-1')).resolves.toBeNull()
  })
})

describe('platform cache', () => {
  it('caches within the TTL and re-reads after invalidation', async () => {
    lockPlatform()
    await getPlatformLockdown()
    const after = reads
    await getPlatformLockdown()
    expect(reads).toBe(after)

    store.delete('lockdowns/platform')
    invalidatePlatformLockdownCache()
    await expect(getPlatformLockdown()).resolves.toBeNull()
    expect(reads).toBe(after + 1)
  })

  it('a malformed platform doc is refused, not guessed at', async () => {
    store.set('lockdowns/platform', { reason: 'not-a-reason' })
    await expect(getPlatformLockdown()).resolves.toBeNull()
  })
})

describe('lockdownJsonResponse — the distinct API refusal', () => {
  it('returns 423 with the sanitized machine-readable body', async () => {
    const response = lockdownJsonResponse({
      scope: 'org',
      reason: 'billing',
      atMs: NOW,
      actorUid: 'staff-1',
    })
    expect(response.status).toBe(423)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(body.error).toBe('locked')
    expect(body.scope).toBe('org')
    expect(body.reason).toBe('billing')
    expect(body.contact).toBe('support@aglyn.com')
    // Never the staff actor or internal rationale.
    expect(JSON.stringify(body)).not.toContain('staff-1')
  })

  it('a maintenance window carries Retry-After', () => {
    const response = lockdownJsonResponse({
      scope: 'platform',
      reason: 'maintenance',
      untilMs: Date.now() + 600_000,
    })
    const retryAfter = Number(response.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThanOrEqual(60)
    expect(retryAfter).toBeLessThanOrEqual(600)
  })
})

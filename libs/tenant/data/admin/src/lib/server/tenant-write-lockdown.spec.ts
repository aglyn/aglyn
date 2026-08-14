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
 * The visitor-write gate on a customer's live site (AGL-1511).
 *
 * The product decision under test is the one the issue is emphatic about:
 * a visitor-facing write on a read-serving site gets a POLITE INLINE PAUSE
 * with copy written for a stranger — never a 503, never our support address,
 * and never a sentence a shopper could read as a declined card.
 *
 * The mocks below answer for ANY collection and ANY host id rather than
 * throwing on an unrecognised one. That is deliberate: a mock that throws on
 * an unknown read turns every new read into a silent trip through the
 * fail-open catch, and the suite stays green while the gate stops gating
 * (the trap AGL-1512 found in the serve-media-cdn lockdown spec). Each case
 * below asserts the refusal or the pass-through explicitly.
 */

const orgs = new Map<string, Record<string, unknown>>()
const hosts = new Map<string, Record<string, unknown>>()
let platformDoc: Record<string, unknown> | undefined
let orgReadsThrow = false

jest.mock('./organizations', () => ({
  __esModule: true,
  getOrgForHost: async (hostId: string) => {
    if (orgReadsThrow) throw new Error('firestore unavailable')
    const org = orgs.get(hostId)
    return org ? { orgId: `org-${hostId}`, org } : null
  },
  getHostDocAdmin: async (hostId: string) => hosts.get(hostId) ?? null,
}))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            async get() {
              return {
                exists: platformDoc !== undefined,
                data: () => platformDoc,
              }
            },
          }),
        }),
      }),
    }),
  },
}))

import { invalidatePlatformLockdownCache } from './lockdown'
import { getSiteLockdown, visitorWriteRefusal } from './tenant-write-lockdown'

const NOW = 1_755_000_000_000
const HOST = 'host-1'

beforeEach(() => {
  orgs.clear()
  hosts.clear()
  platformDoc = undefined
  orgReadsThrow = false
  invalidatePlatformLockdownCache()
})

const readOnlyOrg = () =>
  orgs.set(HOST, {
    suspendedAt: { seconds: 1 },
    suspendedReasonCode: 'maintenance',
    suspendedMode: 'read-only',
  })

describe('AGL-1511 · visitor writes on a read-only site', () => {
  it('pauses a form submission with a 423 the block can render inline', async () => {
    readOnlyOrg()
    const response = await visitorWriteRefusal({
      hostId: HOST,
      request: { method: 'POST' },
      surface: 'form',
      nowMs: NOW,
    })
    expect(response?.status).toBe(423)
    const body = await (response as Response).json()
    expect(body.error).toBe('locked')
    expect(body.mode).toBe('read-only')
    expect(body.title).toBe('Temporarily paused')
    expect(body.message).toContain('Nothing you typed')
    // A visitor is not our customer: no support address travels to them.
    expect(body.contact).toBeUndefined()
    // And the refusal is never cached, so a lift takes effect at once.
    expect(response?.headers.get('Cache-Control')).toBe('no-store')
  })

  it('never lets checkout copy read as a payment failure', async () => {
    readOnlyOrg()
    const response = await visitorWriteRefusal({
      hostId: HOST,
      request: { method: 'POST' },
      surface: 'checkout',
      nowMs: NOW,
    })
    const body = await (response as Response).json()
    expect(body.title).toBe('Checkout is temporarily paused')
    expect(body.message).toContain('not a payment problem')
    expect(body.message).toContain('have not been charged')
  })

  it('leaves reads alone, without touching Firestore', async () => {
    readOnlyOrg()
    // A read on a locked host must not even resolve the site: this gate sits
    // on the hottest unauthenticated path in the product.
    orgReadsThrow = true
    expect(
      await visitorWriteRefusal({
        hostId: HOST,
        request: { method: 'GET' },
        surface: 'generic',
        nowMs: NOW,
      }),
    ).toBeNull()
  })

  it('refuses the write under a FULL lock too — /api is outside the middleware', async () => {
    // The pre-existing hole this closes: the tenant middleware does not match
    // `/api`, so before this gate a full org takedown 503'd the pages while a
    // form POST still wrote.
    orgs.set(HOST, { suspendedAt: { seconds: 1 }, suspendedReasonCode: 'security' })
    const response = await visitorWriteRefusal({
      hostId: HOST,
      request: { method: 'POST' },
      surface: 'form',
      nowMs: NOW,
    })
    expect(response?.status).toBe(423)
  })

  it('passes an unlocked site through untouched', async () => {
    orgs.set(HOST, {})
    hosts.set(HOST, {})
    expect(
      await visitorWriteRefusal({
        hostId: HOST,
        request: { method: 'POST' },
        surface: 'form',
        nowMs: NOW,
      }),
    ).toBeNull()
  })

  it('honours a read-only lock on the HOST doc, not only the org', async () => {
    hosts.set(HOST, {
      suspendedAt: NOW,
      suspendedReasonCode: 'manual',
      suspendedMode: 'read-only',
    })
    const response = await visitorWriteRefusal({
      hostId: HOST,
      request: { method: 'POST' },
      surface: 'cart',
      nowMs: NOW,
    })
    expect(response?.status).toBe(423)
    expect((await getSiteLockdown(HOST, NOW))?.scope).toBe('host')
  })

  it('and a platform-scope read-only lock, with no org or host lock at all', async () => {
    platformDoc = { scope: 'platform', reason: 'maintenance', mode: 'read-only' }
    const response = await visitorWriteRefusal({
      hostId: HOST,
      request: { method: 'POST' },
      surface: 'form',
      nowMs: NOW,
    })
    expect(response?.status).toBe(423)
  })

  it('expires without a write — the window closing reopens the shop', async () => {
    orgs.set(HOST, {
      suspendedAt: { seconds: 1 },
      suspendedReasonCode: 'maintenance',
      suspendedMode: 'read-only',
      suspendedUntilMs: NOW - 1,
    })
    expect(
      await visitorWriteRefusal({
        hostId: HOST,
        request: { method: 'POST' },
        surface: 'form',
        nowMs: NOW,
      }),
    ).toBeNull()
  })

  it('FAILS OPEN: a shop does not stop taking orders because a read threw', async () => {
    readOnlyOrg()
    orgReadsThrow = true
    expect(
      await visitorWriteRefusal({
        hostId: HOST,
        request: { method: 'POST' },
        surface: 'checkout',
        nowMs: NOW,
      }),
    ).toBeNull()
  })

  it('evaluates nothing when the site could not be identified', async () => {
    readOnlyOrg()
    expect(
      await visitorWriteRefusal({
        hostId: '',
        request: { method: 'POST' },
        surface: 'form',
        nowMs: NOW,
      }),
    ).toBeNull()
  })
})

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
let hostReadsThrow = false

jest.mock('./organizations', () => ({
  __esModule: true,
  getOrgForHost: async (hostId: string) => {
    if (orgReadsThrow) throw new Error('firestore unavailable')
    const org = orgs.get(hostId)
    return org ? { orgId: `org-${hostId}`, org } : null
  },
  getHostDocAdmin: async (hostId: string) => {
    if (hostReadsThrow) throw new Error('firestore unavailable')
    return hosts.get(hostId) ?? null
  },
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

import {
  invalidatePlatformLockdownCache,
  resetTakedownLedger,
} from './lockdown'
import { getSiteLockdown, visitorWriteRefusal } from './tenant-write-lockdown'

const NOW = 1_755_000_000_000
const HOST = 'host-1'

beforeEach(() => {
  orgs.clear()
  hosts.clear()
  platformDoc = undefined
  orgReadsThrow = false
  hostReadsThrow = false
  invalidatePlatformLockdownCache()
  resetTakedownLedger()
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

/**
 * AGL-1881 — `enforcement: 'takedown'` at ORG and HOST scope.
 *
 * AGL-1621 built the takedown ledger and wired it into the four readers
 * whose lock lives in `lockdowns/*`: platform, feature, user, domain. Org
 * and host locks live on the org/host document instead and never passed
 * through a ledgered reader, so `getSiteLockdown`'s catch returned null flat
 * — while /api/admin/lockdown happily persisted `suspendedEnforcement:
 * 'takedown'` for both scopes, from a control whose own label promises the
 * lock "keeps holding if Aglyn cannot reach the database".
 *
 * A court-ordered host takedown plus a partial Firestore outage therefore
 * answered `locked: false` and the infringing site kept serving — the exact
 * failure the mode exists to prevent, on the two scopes most likely to be
 * carrying a legal order.
 *
 * The crux, and why a ledger rather than a stricter catch: on a read failure
 * `suspendedEnforcement` is exactly as unreadable as everything else. Only
 * something remembered from a SUCCESSFUL read can classify the lock. And the
 * catch stays fail-open for every other class on purpose — a Firestore blip
 * must not stop the platform's shops taking orders.
 */
describe('AGL-1881 · a takedown at org/host scope survives a failed read', () => {
  const takedownOrg = () =>
    orgs.set(HOST, {
      suspendedAt: { seconds: 1 },
      suspendedReasonCode: 'legal',
      suspendedEnforcement: 'takedown',
    })
  const takedownHost = (extra: Record<string, unknown> = {}) =>
    hosts.set(HOST, {
      suspendedAt: NOW,
      suspendedReasonCode: 'legal',
      suspendedEnforcement: 'takedown',
      ...extra,
    })

  it('ORG: the takedown holds when the org read throws', async () => {
    takedownOrg()
    // One successful read — the observation that arms the ledger.
    expect((await getSiteLockdown(HOST, NOW))?.scope).toBe('org')
    orgReadsThrow = true
    const held = await getSiteLockdown(HOST, NOW)
    expect(held).toMatchObject({ scope: 'org', enforcement: 'takedown' })
    const response = await visitorWriteRefusal({
      hostId: HOST,
      request: { method: 'POST' },
      surface: 'checkout',
      nowMs: NOW,
    })
    expect(response?.status).toBe(423)
  })

  it('HOST: the takedown holds when the host read throws', async () => {
    takedownHost()
    expect((await getSiteLockdown(HOST, NOW))?.scope).toBe('host')
    hostReadsThrow = true
    expect(await getSiteLockdown(HOST, NOW)).toMatchObject({
      scope: 'host',
      enforcement: 'takedown',
    })
  })

  it('HOST: it holds when the OTHER read is the one that throws', async () => {
    // The outage does not get to pick which document it took out. A host
    // takedown remembered from a successful pass must survive the org read
    // failing just the same, or the guarantee is "unless the blip landed on
    // the neighbouring collection".
    takedownHost()
    await getSiteLockdown(HOST, NOW)
    orgReadsThrow = true
    expect(await getSiteLockdown(HOST, NOW)).toMatchObject({
      scope: 'host',
      enforcement: 'takedown',
    })
  })

  it('an ORDINARY org lock still fails open — the default is unchanged', async () => {
    readOnlyOrg()
    await getSiteLockdown(HOST, NOW)
    orgReadsThrow = true
    expect(await getSiteLockdown(HOST, NOW)).toBeNull()
  })

  it('a NEVER-OBSERVED takedown fails open — the stated limit', async () => {
    // Said out loud because the guarantee is easy to over-read: a COLD
    // process that has never once read this host has nothing to hold, and a
    // takedown placed DURING an outage is not enforced by this path at all.
    takedownHost()
    hostReadsThrow = true
    expect(await getSiteLockdown(HOST, NOW)).toBeNull()
  })

  it('a LIFTED takedown stops holding — a successful read retires it', async () => {
    takedownHost()
    await getSiteLockdown(HOST, NOW)
    hosts.set(HOST, {})
    expect(await getSiteLockdown(HOST, NOW)).toBeNull()
    hostReadsThrow = true
    expect(await getSiteLockdown(HOST, NOW)).toBeNull()
  })

  it('an EXPIRED takedown releases on schedule, even while reads fail', async () => {
    // A dead-man expiry must not become un-liftable by being classified.
    takedownHost({ suspendedUntilMs: NOW + 1000 })
    expect(await getSiteLockdown(HOST, NOW)).not.toBeNull()
    hostReadsThrow = true
    expect(await getSiteLockdown(HOST, NOW)).not.toBeNull()
    expect(await getSiteLockdown(HOST, NOW + 2000)).toBeNull()
  })

  it('a takedown DOWNGRADED to an ordinary lock stops holding', async () => {
    takedownHost()
    await getSiteLockdown(HOST, NOW)
    hosts.set(HOST, { suspendedAt: NOW, suspendedReasonCode: 'legal' })
    await getSiteLockdown(HOST, NOW)
    hostReadsThrow = true
    expect(await getSiteLockdown(HOST, NOW)).toBeNull()
  })

  it('the ledger is per host — one site’s takedown is not another’s', async () => {
    takedownHost()
    await getSiteLockdown(HOST, NOW)
    hostReadsThrow = true
    expect(await getSiteLockdown('host-2', NOW)).toBeNull()
  })
})

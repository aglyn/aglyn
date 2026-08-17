/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Response`.
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
 * The dispatcher's visitor-write limiter (AGL-1770).
 *
 * The point of this suite is that the limiter ACTUALLY ENGAGES. A limiter that
 * silently never refuses is indistinguishable from the gap it was meant to
 * close, so every claim here is made to fail on purpose: the refusal is proven
 * by driving a real counter past the cap rather than by asserting a stub, and
 * the fail-soft posture is proven by making the backing store throw.
 */

import { resetRateLimitDegradationForTests } from './rate-limit-store'
import { visitorWriteRateLimitRefusal } from './visitor-write-rate-limit'

/**
 * A Firestore stand-in with enough transaction semantics to count, matching
 * `rate-limit-store.spec.ts`. `failFrom()` is the fault injection: it makes
 * every transaction throw, which is the only way to reach the fail-soft path.
 */
function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()
  let failing = false
  return {
    docs,
    failFrom: () => {
      failing = true
    },
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<number>) => {
      if (failing) throw new Error('firestore unavailable')
      const tx = {
        get: async (ref: { path: string }) => ({
          exists: docs.has(ref.path),
          get: (field: string) => docs.get(ref.path)?.[field],
        }),
        set: (ref: { path: string }, value: Record<string, unknown>) => {
          docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...value })
        },
      }
      return fn(tx)
    },
  }
}

const NOW = 1_700_000_000_000

function post(ip: string, headers: Record<string, string> = {}) {
  return {
    method: 'POST',
    headers: {
      get: (name: string) =>
        name === 'x-forwarded-for' ? (headers[name] ?? ip) : null,
    },
  }
}

beforeEach(() => {
  resetRateLimitDegradationForTests()
})

describe('visitorWriteRateLimitRefusal (AGL-1770)', () => {
  const gate = (
    overrides: Partial<Parameters<typeof visitorWriteRateLimitRefusal>[0]>,
  ) =>
    visitorWriteRateLimitRefusal({
      path: 'commerce/cart',
      hostId: 'host-1',
      request: post('1.2.3.4'),
      limit: 3,
      windowMs: 60_000,
      nowMs: NOW,
      ...overrides,
    })

  it('lets a working site write, then REFUSES once the window is spent', async () => {
    const firestore = fakeFirestore()
    const verdicts: Array<number | null> = []
    for (let i = 0; i < 5; i += 1) {
      const response = await gate({ firestore })
      verdicts.push(response ? response.status : null)
    }

    // The gap this closes: before it, every one of these was `null`. Three
    // allowed (the cap), then refused — not "eventually", but at the boundary.
    expect(verdicts).toEqual([null, null, null, 429, 429])
  })

  it('sends Retry-After so a well-behaved client knows when to return', async () => {
    const firestore = fakeFirestore()
    for (let i = 0; i < 3; i += 1) await gate({ firestore })
    const refused = await gate({ firestore })

    expect(refused?.status).toBe(429)
    const retryAfter = Number(refused?.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  it('tells the caller nothing it could spend the window on', async () => {
    const firestore = fakeFirestore()
    for (let i = 0; i < 4; i += 1) await gate({ firestore })
    const refused = await gate({ firestore })

    // Public, unauthenticated surface: "you have N left" and "the global
    // limiter is currently per-instance" are both gifts to an abuser.
    expect(refused?.headers.get('X-RateLimit-Remaining')).toBeNull()
    expect(refused?.headers.get('X-RateLimit-Limit')).toBeNull()
    expect(await refused?.json()).toEqual({ error: 'Too many requests' })
  })

  it('does not let one attacker lock the merchant’s real shoppers out', async () => {
    const firestore = fakeFirestore()
    for (let i = 0; i < 6; i += 1) {
      await gate({ firestore, request: post('9.9.9.9') })
    }
    // The attacker is refused…
    expect((await gate({ firestore, request: post('9.9.9.9') }))?.status).toBe(
      429,
    )
    // …and a shopper arriving at the same site is not. This is the property a
    // site-wide ceiling would have destroyed.
    expect(await gate({ firestore, request: post('1.1.1.1') })).toBeNull()
  })

  it('does not let one caller spend another site’s budget', async () => {
    const firestore = fakeFirestore()
    for (let i = 0; i < 6; i += 1) {
      await gate({ firestore, hostId: 'host-a' })
    }
    expect((await gate({ firestore, hostId: 'host-a' }))?.status).toBe(429)
    expect(await gate({ firestore, hostId: 'host-b' })).toBeNull()
  })

  it('still counts a write that names no site at all', async () => {
    // AGL-1769's hole was `if (hostId)`. A caller must not be able to switch
    // the limiter off by omitting the field.
    const firestore = fakeFirestore()
    const verdicts: Array<number | null> = []
    for (let i = 0; i < 5; i += 1) {
      const response = await gate({ firestore, hostId: '' })
      verdicts.push(response ? response.status : null)
    }
    expect(verdicts).toEqual([null, null, null, 429, 429])
  })

  it('cannot be evaded by cycling endpoints', async () => {
    const firestore = fakeFirestore()
    await gate({ firestore, path: 'commerce/cart' })
    await gate({ firestore, path: 'commerce/reviews' })
    await gate({ firestore, path: 'commerce/newsletter' })

    // One budget per (site, IP) across all visitor paths — three different
    // endpoints spent the same three, so the fourth is refused.
    expect((await gate({ firestore, path: 'bookings/book' }))?.status).toBe(429)
  })

  it('does not limit reads', async () => {
    const firestore = fakeFirestore()
    for (let i = 0; i < 20; i += 1) {
      const response = await gate({
        firestore,
        request: { method: 'GET', headers: post('1.2.3.4').headers },
      })
      expect(response).toBeNull()
    }
    // And it spent nothing doing so: a durable transaction in front of a GET
    // would be the only Firestore work in the request.
    expect(firestore.docs.size).toBe(0)
  })

  it('does not limit a credentialed machine surface', async () => {
    const firestore = fakeFirestore()
    for (let i = 0; i < 20; i += 1) {
      expect(await gate({ firestore, path: 'email/events' })).toBeNull()
    }
    // Resend delivering webhooks for one large campaign arrives from a handful
    // of IPs for a single host; any shopper-sized cap would shred it.
    expect(firestore.docs.size).toBe(0)
  })

  it('FAILS SOFT: a dead backing store lets traffic through, it does not 429 it', async () => {
    const firestore = fakeFirestore()
    firestore.failFrom()

    // The decisive property. The counter and the cart document it guards live
    // in the SAME Firestore, so if this store is unreachable the write being
    // bounded is failing anyway — refusing here would add lost sales on every
    // storefront to an outage rather than prevent anything.
    const response = await gate({
      firestore,
      request: post('7.7.7.7'),
      limit: 3,
    })
    expect(response).toBeNull()
    expect(firestore.docs.size).toBe(0)
  })

  it('FAILS SOFT, NOT OPEN: the degraded fallback still enforces the cap', async () => {
    const firestore = fakeFirestore()
    firestore.failFrom()

    // Distinct IP per assertion run so the module-scoped in-process store the
    // fallback uses cannot be polluted by a sibling test.
    const request = post('8.8.8.8')
    const verdicts: Array<number | null> = []
    for (let i = 0; i < 5; i += 1) {
      const response = await gate({ firestore, request, limit: 3 })
      verdicts.push(response ? response.status : null)
    }

    // Degrading to the per-instance limiter is not the same as switching off:
    // an attacker who induces a storage error gets `limit × instances`, not
    // an unbounded budget.
    expect(verdicts).toEqual([null, null, null, 429, 429])
  })
})

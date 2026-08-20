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
 * AGL-1902 — the cross-domain console session handoff, §7 of the design.
 *
 * The design document enumerates the regressions worth catching and says to
 * use that list rather than inventing one. Items 2–7 and 10 are here; item 1
 * (two CONCURRENT redemptions) is in `auth-handoff-single-use.emulator.spec.ts`
 * because, as the design says, "a serial test does not exercise the property" —
 * the guarantee comes from Firestore's optimistic concurrency and a double
 * cannot demonstrate it.
 *
 * Every refusal below is a distinct `reason`. That is not decoration: a boolean
 * would let two different holes share one green, and the difference between
 * `bad-secret` and `bad-verifier` is the difference between the two channels
 * this design deliberately keeps independent.
 */

const mockResolve = jest.fn()

jest.mock('./console-domains', () => ({
  ...jest.requireActual('./console-domains'),
  resolveConsoleDomain: (host: string) => mockResolve(host),
}))

/**
 * An in-memory Firestore for one collection.
 *
 * Models exactly what `consumeOnce` depends on and models it FAITHFULLY:
 * `runTransaction` runs the body against a live view of the store, `tx.set`
 * with `{ merge: true }` MERGES rather than replaces, and `tx.delete` removes.
 * An unfaithful double here would fabricate a green for single use — the one
 * property this whole file exists to hold.
 */
const store: Record<string, Record<string, unknown>> = {}

jest.mock('./firebase-admin', () => {
  const docRef = (id: string) => ({
    __id: id,
    get: async () => ({
      exists: Object.prototype.hasOwnProperty.call(store, id),
      data: () => store[id],
      get: (field: string) => store[id]?.[field],
    }),
    set: async (value: Record<string, unknown>) => {
      store[id] = { ...value }
    },
  })
  const firestore = () => ({
    collection: () => ({ doc: (id: string) => docRef(id) }),
    runTransaction: async (
      fn: (tx: {
        get: (ref: { __id: string }) => Promise<{
          exists: boolean
          data: () => Record<string, unknown>
        }>
        set: (
          ref: { __id: string },
          value: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => void
        delete: (ref: { __id: string }) => void
      }) => Promise<unknown>,
    ) =>
      fn({
        get: async (ref) => ({
          exists: Object.prototype.hasOwnProperty.call(store, ref.__id),
          data: () => store[ref.__id],
        }),
        set: (ref, value, options) => {
          store[ref.__id] = options?.merge
            ? { ...(store[ref.__id] ?? {}), ...value }
            : { ...value }
        },
        delete: (ref) => {
          delete store[ref.__id]
        },
      }),
  })
  return { __esModule: true, default: { app: () => ({ firestore }) } }
})

import {
  authorizeConsoleHandoff,
  hashHandoffSecret,
  HANDOFF_AUTHORIZED_TTL_MS,
  HANDOFF_PENDING_TTL_MS,
  redeemConsoleHandoff,
  safeContinuePath,
  startConsoleHandoff,
} from './auth-handoff'

const HOST = 'console.acme-agency.com'
const OTHER_HOST = 'console.aglyn-support.com'
const NOW = 1_760_000_000_000
const member = async () => true
const stranger = async () => false

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  mockResolve.mockReset()
  mockResolve.mockResolvedValue({
    known: true,
    servable: true,
    orgSlug: 'acme',
    reason: 'active',
    degraded: false,
  })
})

/** Start → authorize, returning everything a redemption needs. */
async function authorized(overrides: { nowMs?: number } = {}) {
  const started = await startConsoleHandoff({
    targetHost: HOST,
    orgSlug: 'acme',
    continuePath: '/acme/sites',
    nowMs: NOW,
  })
  const result = await authorizeConsoleHandoff({
    requestId: started!.requestId,
    uid: 'u1',
    isMember: member,
    nowMs: overrides.nowMs ?? NOW,
  })
  if (!result.ok) throw new Error(`authorize refused: ${result.reason}`)
  return { started: started!, secret: result.secret }
}

describe('the happy path', () => {
  it('starts pending, authorizes, and redeems exactly once', async () => {
    const { started, secret } = await authorized()

    const first = await redeemConsoleHandoff({
      requestId: started.requestId,
      secret,
      verifiers: [started.verifier],
      requestHost: HOST,
      nowMs: NOW,
    })

    expect(first).toEqual({
      ok: true,
      uid: 'u1',
      tenantId: null,
      continuePath: '/acme/sites',
    })
  })

  it('stores only HASHES — the record never holds a usable credential', async () => {
    const { started, secret } = await authorized()
    const record = store[started.requestId]

    expect(record['verifierHash']).toBe(hashHandoffSecret(started.verifier))
    expect(record['secretHash']).toBe(hashHandoffSecret(secret))
    expect(JSON.stringify(record)).not.toContain(started.verifier)
    expect(JSON.stringify(record)).not.toContain(secret)
  })

  it('carries the SSO tenant through, for the GCIP sidecar', async () => {
    const started = await startConsoleHandoff({
      targetHost: HOST,
      orgSlug: 'acme',
      nowMs: NOW,
    })
    const result = await authorizeConsoleHandoff({
      requestId: started!.requestId,
      uid: 'u1',
      tenantId: 'sso-tenant-1',
      isMember: member,
      nowMs: NOW,
    })
    if (!result.ok) throw new Error('refused')

    const redeemed = await redeemConsoleHandoff({
      requestId: started!.requestId,
      secret: result.secret,
      verifiers: [started!.verifier],
      requestHost: HOST,
      nowMs: NOW,
    })

    expect(redeemed).toMatchObject({ ok: true, tenantId: 'sso-tenant-1' })
  })
})

describe('§7.1 — a redeemed rid cannot be redeemed twice (serial half)', () => {
  it('refuses the replay and hands back nothing', async () => {
    const { started, secret } = await authorized()
    const args = {
      requestId: started.requestId,
      secret,
      verifiers: [started.verifier],
      requestHost: HOST,
      nowMs: NOW,
    }

    expect((await redeemConsoleHandoff(args)).ok).toBe(true)
    expect(await redeemConsoleHandoff(args)).toEqual({
      ok: false,
      reason: 'already-redeemed',
    })
  })

  it('destroys both hashes on consume, so nothing can be re-derived', async () => {
    const { started, secret } = await authorized()
    await redeemConsoleHandoff({
      requestId: started.requestId,
      secret,
      verifiers: [started.verifier],
      requestHost: HOST,
      nowMs: NOW,
    })

    expect(store[started.requestId]).toMatchObject({
      status: 'redeemed',
      secretHash: null,
      verifierHash: null,
    })
  })
})

describe('§7.2 — a valid secret with NO verifier fails', () => {
  it('refuses, which is what makes a leaked secret useless', async () => {
    // The whole reason the return secret can ride in a URL fragment at all.
    // If possession were sufficient, an attacker who read it from a log could
    // POST it to our own redemption endpoint from their own machine.
    const { started, secret } = await authorized()

    expect(
      await redeemConsoleHandoff({
        requestId: started.requestId,
        secret,
        verifiers: [],
        requestHost: HOST,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: 'bad-verifier' })
    // And the record is still live for the real browser.
    expect(store[started.requestId]['status']).toBe('authorized')
  })

  it('refuses a WRONG verifier', async () => {
    const { started, secret } = await authorized()

    expect(
      await redeemConsoleHandoff({
        requestId: started.requestId,
        secret,
        verifiers: ['not-the-verifier'],
        requestHost: HOST,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: 'bad-verifier' })
  })
})

describe('§7.3 — a valid verifier with the WRONG secret fails', () => {
  it('refuses, which is what makes a phished flow useless', async () => {
    // The mirror attack: the ATTACKER starts the flow, so they hold `V`, and
    // phish the victim into completing sign-in. `S` reaches only the browser
    // that authenticated — the victim's.
    const { started } = await authorized()

    expect(
      await redeemConsoleHandoff({
        requestId: started.requestId,
        secret: 'attacker-guess',
        verifiers: [started.verifier],
        requestHost: HOST,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: 'bad-secret' })
  })
})

describe('§7.4 — a record targeting host A cannot be redeemed at host B', () => {
  it('refuses on the request’s own Host', async () => {
    const { started, secret } = await authorized()

    expect(
      await redeemConsoleHandoff({
        requestId: started.requestId,
        secret,
        verifiers: [started.verifier],
        requestHost: OTHER_HOST,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: 'host-mismatch' })
  })
})

describe('§7.5 — a shadowing duplicate verifier cookie does not break it', () => {
  it('accepts when ANY value of the cookie name hashes correctly', async () => {
    // A compromised sibling under the customer's own apex can set
    // `Domain=.acme-agency.com; __aglyn_handoff=...`, which shadows our
    // host-only cookie in the `Cookie` header with no way to tell them apart —
    // the AGL-1259 duplicate-`__session` failure. Hashing every value is safe
    // by construction and turns a hijack attempt into a no-op rather than a
    // denial of service.
    const { started, secret } = await authorized()

    expect(
      await redeemConsoleHandoff({
        requestId: started.requestId,
        secret,
        verifiers: ['planted-by-a-sibling-host', started.verifier],
        requestHost: HOST,
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: true })
  })

  it('still refuses when every value is wrong', async () => {
    const { started, secret } = await authorized()

    expect(
      await redeemConsoleHandoff({
        requestId: started.requestId,
        secret,
        verifiers: ['planted-a', 'planted-b'],
        requestHost: HOST,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: 'bad-verifier' })
  })
})

describe('§7.6 — authorize refuses a non-member', () => {
  it('is the check that makes the feature safe to sell', async () => {
    // An attacker CAN verify a domain they genuinely own. Verified status is
    // not sufficient; membership in the org that owns the target host is. The
    // victim signs in on the genuine auth host — their credential never
    // touches the attacker's origin — and is told they have no access.
    const started = await startConsoleHandoff({
      targetHost: HOST,
      orgSlug: 'acme',
      nowMs: NOW,
    })

    expect(
      await authorizeConsoleHandoff({
        requestId: started!.requestId,
        uid: 'attacker',
        isMember: stranger,
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: 'not-a-member' })
    // Nothing authorized, so nothing to redeem.
    expect(store[started!.requestId]['status']).toBe('pending')
    expect(store[started!.requestId]['secretHash']).toBeNull()
  })
})

describe('§7.7 — authorize refuses a domain that is not servable', () => {
  it('refuses a suspended or unentitled domain', async () => {
    mockResolve.mockResolvedValue({
      known: true,
      servable: false,
      orgSlug: 'acme',
      reason: 'not-entitled',
      degraded: false,
    })
    const started = await startConsoleHandoff({
      targetHost: HOST,
      orgSlug: 'acme',
      nowMs: NOW,
    })

    expect(
      await authorizeConsoleHandoff({
        requestId: started!.requestId,
        uid: 'u1',
        isMember: member,
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: 'domain-inactive' })
  })

  it('refuses a DEGRADED lookup — minting is the opposite trade from routing', async () => {
    // `resolveConsoleDomain` fails open for ROUTING, because a console going
    // dark on a timeout is worse than the residual exposure. Minting a session
    // on a domain we could not confirm is live is the other direction, and the
    // user still has a working workspace subdomain to fall back to.
    mockResolve.mockResolvedValue({
      known: false,
      servable: false,
      orgSlug: null,
      reason: 'degraded',
      degraded: true,
    })
    const started = await startConsoleHandoff({
      targetHost: HOST,
      orgSlug: 'acme',
      nowMs: NOW,
    })

    expect(
      await authorizeConsoleHandoff({
        requestId: started!.requestId,
        uid: 'u1',
        isMember: member,
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: 'domain-inactive' })
  })

  it('refuses a staff impersonation session outright', async () => {
    const started = await startConsoleHandoff({
      targetHost: HOST,
      orgSlug: 'acme',
      nowMs: NOW,
    })

    expect(
      await authorizeConsoleHandoff({
        requestId: started!.requestId,
        uid: 'owner',
        impersonated: true,
        isMember: member,
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: 'impersonation' })
  })
})

describe('the two windows', () => {
  it('refuses to authorize a pending record older than 15 minutes', async () => {
    const started = await startConsoleHandoff({
      targetHost: HOST,
      orgSlug: 'acme',
      nowMs: NOW,
    })

    expect(
      await authorizeConsoleHandoff({
        requestId: started!.requestId,
        uid: 'u1',
        isMember: member,
        nowMs: NOW + HANDOFF_PENDING_TTL_MS + 1,
      }),
    ).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('refuses to redeem an authorized record older than 120 seconds', async () => {
    const { started, secret } = await authorized()

    expect(
      await redeemConsoleHandoff({
        requestId: started.requestId,
        secret,
        verifiers: [started.verifier],
        requestHost: HOST,
        nowMs: NOW + HANDOFF_AUTHORIZED_TTL_MS + 1,
      }),
    ).toEqual({ ok: false, reason: 'expired' })
  })

  it('shortens the stored expiry at authorize, from 15 min to 120 s', async () => {
    const { started } = await authorized()
    const expiresAt = store[started.requestId]['expiresAt'] as Date

    expect(expiresAt.getTime()).toBe(NOW + HANDOFF_AUTHORIZED_TTL_MS)
  })
})

describe('a second authorize of the same request', () => {
  it('is refused, so a request id cannot mint secret after secret', async () => {
    const { started } = await authorized()

    expect(
      await authorizeConsoleHandoff({
        requestId: started.requestId,
        uid: 'u1',
        isMember: member,
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: 'not-pending' })
  })
})

describe('a pending record grants nothing', () => {
  it('cannot be redeemed before it is authorized', async () => {
    const started = await startConsoleHandoff({
      targetHost: HOST,
      orgSlug: 'acme',
      nowMs: NOW,
    })

    expect(
      await redeemConsoleHandoff({
        requestId: started!.requestId,
        secret: 'anything',
        verifiers: [started!.verifier],
        requestHost: HOST,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: 'not-authorized' })
  })
})

describe('an id that never existed', () => {
  it('is refused without saying whether it ever did', async () => {
    expect(
      await redeemConsoleHandoff({
        requestId: 'made-up',
        secret: 's',
        verifiers: ['v'],
        requestHost: HOST,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: 'unknown-request' })
  })

  it('refuses a path-shaped id rather than addressing another document', async () => {
    // `.doc()` resolves a slashed id as a nested PATH.
    expect(
      await redeemConsoleHandoff({
        requestId: 'a/b/c',
        secret: 's',
        verifiers: ['v'],
        requestHost: HOST,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: 'unknown-request' })
  })
})

describe('continuePath cannot leave the origin', () => {
  it('refuses the open-redirect shapes and keeps ordinary paths', () => {
    expect(safeContinuePath('/acme/sites')).toBe('/acme/sites')
    expect(safeContinuePath('//evil.example')).toBe('/')
    expect(safeContinuePath('/\\evil.example')).toBe('/')
    expect(safeContinuePath('https://evil.example')).toBe('/')
    expect(safeContinuePath('')).toBe('/')
    expect(safeContinuePath(null)).toBe('/')
  })

  it('sanitises on the way IN, so a stored record cannot carry one', async () => {
    const started = await startConsoleHandoff({
      targetHost: HOST,
      orgSlug: 'acme',
      continuePath: '//evil.example/steal',
      nowMs: NOW,
    })

    expect(store[started!.requestId]['continuePath']).toBe('/')
  })
})

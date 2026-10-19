/**
 * @jest-environment node
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

/**
 * A one-click DNS session's life (AGL-3963), through the engine both the
 * widget's poll and the sweep run:
 *
 *   started → applied → waiting → connected
 *   started → cancelled (the owner declined) / failed (the provider refused)
 *   any open status → expired, 48 hours after it started
 *
 * DNS decides, never the redirect: an applied session whose records do not
 * resolve waits, and a started one whose records DO resolve connects.
 */

import { advanceDomainConnectSession, sweepDomainConnectSessions, type DomainConnectEngineDeps, type DomainConnectStore } from './engine'
import {
  DOMAIN_CONNECT_SESSION_TTL_MS,
  DOMAIN_CONNECT_TWIN_GRACE_MS,
  domainConnectSessionId,
  newDomainConnectSession,
  newDomainConnectState,
  sessionAfterReturn,
  type DomainConnectSession,
  type SessionConnectOutcome,
} from './session'

const T0 = 1_700_000_000_000

function memoryStore(): DomainConnectStore & { rows: Map<string, DomainConnectSession> } {
  const rows = new Map<string, DomainConnectSession>()
  return {
    rows,
    get: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
    create: async (id, session) => void rows.set(id, { ...session }),
    update: async (id, patch) => void rows.set(id, { ...rows.get(id)!, ...patch }),
    lease: async (id, nowMs, untilMs) => {
      const row = rows.get(id)
      if (!row || (row.leaseUntilMs ?? 0) > nowMs) return null
      rows.set(id, { ...row, leaseUntilMs: untilMs })
      return { ...row, leaseUntilMs: untilMs }
    },
    listDue: async (nowMs, limit) =>
      [...rows.entries()]
        .filter(([, row]) => row.nextCheckAtMs !== null && row.nextCheckAtMs <= nowMs)
        .sort(([, a], [, b]) => (a.nextCheckAtMs ?? 0) - (b.nextCheckAtMs ?? 0))
        .slice(0, limit)
        .map(([id, session]) => ({ id, session })),
  }
}

function session(patch: Partial<DomainConnectSession> = {}): DomainConnectSession {
  return {
    ...newDomainConnectSession({
      orgId: 'org-1',
      hostId: 'host-1',
      domain: 'example.com',
      root: 'example.com',
      host: '',
      template: 'apex',
      twin: 'www.example.com',
      providerId: 'provider.example',
      providerName: 'Provider DNS',
      serviceId: 'website',
      createdBy: 'uid-owner',
      createdByEmail: 'owner@example.com',
      nowMs: T0,
    }),
    ...patch,
  }
}

interface Harness {
  store: ReturnType<typeof memoryStore>
  deps: DomainConnectEngineDeps
  pointed: Set<string>
  connects: Array<{ domain: string; twin: string | null; actor: { uid: string } }>
  clock: { now: number }
}

function harness(options: { outcome?: SessionConnectOutcome; permitted?: string | null } = {}): Harness {
  const store = memoryStore()
  const pointed = new Set<string>()
  const connects: Harness['connects'] = []
  const clock = { now: T0 + 60_000 }
  const deps: DomainConnectEngineDeps = {
    store,
    pointsHere: async (name) => pointed.has(name),
    connect: async (input) => {
      connects.push(input)
      return options.outcome ?? { ok: 'connected', servingPending: false }
    },
    ...(options.permitted !== undefined ? { permitted: async () => options.permitted ?? null } : {}),
    now: () => clock.now,
  }
  return { store, deps, pointed, connects, clock }
}

describe('the state token', () => {
  it('is 32 random bytes, and the session id is its SHA-256 — the token is never stored', () => {
    const state = newDomainConnectState()
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const id = domainConnectSessionId(state)
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(id).not.toContain(state)
    expect(domainConnectSessionId(state)).toBe(id)
    expect(newDomainConnectState()).not.toBe(state)
  })

  it('has no session for a value no token could be', () => {
    expect(domainConnectSessionId('')).toBeNull()
    expect(domainConnectSessionId('short')).toBeNull()
    expect(domainConnectSessionId({})).toBeNull()
    expect(domainConnectSessionId('x'.repeat(42) + '!')).toBeNull()
  })
})

describe('the provider sending the owner back', () => {
  it('moves a started session to applied with no error', () => {
    expect(sessionAfterReturn(session(), null, T0 + 1)).toEqual({ status: 'applied', appliedAtMs: T0 + 1, updatedAtMs: T0 + 1 })
  })

  it('reads access_denied as the owner declining, and closes the session', () => {
    expect(sessionAfterReturn(session(), 'access_denied', T0 + 1)).toMatchObject({
      status: 'cancelled',
      code: 'access_denied',
      nextCheckAtMs: null,
    })
  })

  it('records any other error as the provider’s, by the spec’s code only', () => {
    expect(sessionAfterReturn(session(), 'temporarily_unavailable', T0)).toMatchObject({
      status: 'failed',
      code: 'provider:temporarily_unavailable',
    })
    expect(sessionAfterReturn(session(), '<script>', T0)).toMatchObject({ code: 'provider:server_error' })
  })

  it('changes nothing for a session that already moved on', () => {
    expect(sessionAfterReturn(session({ status: 'connected' }), null, T0)).toBeNull()
    expect(sessionAfterReturn(session({ status: 'waiting' }), 'access_denied', T0)).toBeNull()
  })
})

describe('advancing a session', () => {
  it('started → applied → waiting → connected, with the twin, once both names resolve', async () => {
    const h = harness()
    h.store.rows.set('s', session())
    h.store.rows.set('s', { ...h.store.rows.get('s')!, ...sessionAfterReturn(h.store.rows.get('s')!, null, T0 + 1) })
    expect((await advanceDomainConnectSession('s', h.deps))?.status).toBe('waiting')
    h.pointed.add('example.com').add('www.example.com')
    const after = await advanceDomainConnectSession('s', h.deps)
    expect(after).toMatchObject({ status: 'connected', code: null, leaseUntilMs: null, nextCheckAtMs: null })
    expect(h.connects).toEqual([
      {
        hostId: 'host-1',
        domain: 'example.com',
        twin: 'www.example.com',
        actor: { uid: 'uid-owner', email: 'owner@example.com' },
      },
    ])
  })

  it('connects a STARTED session whose records resolve: the redirect never arrived, DNS did', async () => {
    const h = harness()
    h.store.rows.set('s', session({ template: 'subdomain', domain: 'shop.example.com', host: 'shop', twin: null }))
    h.pointed.add('shop.example.com')
    expect(await advanceDomainConnectSession('s', h.deps)).toMatchObject({ status: 'connected' })
    expect(h.connects[0]).toMatchObject({ domain: 'shop.example.com', twin: null })
  })

  it('leaves a started session started while nothing resolves: nothing says it was approved', async () => {
    const h = harness()
    h.store.rows.set('s', session())
    expect((await advanceDomainConnectSession('s', h.deps))?.status).toBe('started')
    expect(h.store.rows.get('s')?.nextCheckAtMs).toBe(h.clock.now)
  })

  it('waits for www once the root resolves, then connects the root alone after the grace', async () => {
    const h = harness()
    h.store.rows.set('s', session({ status: 'applied' }))
    h.pointed.add('example.com')
    expect(await advanceDomainConnectSession('s', h.deps)).toMatchObject({ status: 'waiting', resolvedAtMs: h.clock.now })
    expect(h.connects).toHaveLength(0)
    h.clock.now += DOMAIN_CONNECT_TWIN_GRACE_MS
    expect((await advanceDomainConnectSession('s', h.deps))?.status).toBe('connected')
    expect(h.connects[0]?.twin).toBeNull()
  })

  it('expires a session 48 hours after it started, without connecting it', async () => {
    const h = harness()
    h.store.rows.set('s', session({ status: 'waiting' }))
    h.pointed.add('example.com').add('www.example.com')
    h.clock.now = T0 + DOMAIN_CONNECT_SESSION_TTL_MS
    expect(await advanceDomainConnectSession('s', h.deps)).toMatchObject({
      status: 'expired',
      code: 'dns-not-pointed',
      nextCheckAtMs: null,
    })
    expect(h.connects).toHaveLength(0)
  })

  it('does nothing to a terminal session', async () => {
    const h = harness()
    h.store.rows.set('s', session({ status: 'cancelled', nextCheckAtMs: null }))
    h.pointed.add('example.com')
    expect((await advanceDomainConnectSession('s', h.deps))?.status).toBe('cancelled')
    expect(h.connects).toHaveLength(0)
  })

  it('answers a session another checker holds as read, and connects nothing', async () => {
    const h = harness()
    h.store.rows.set('s', session({ status: 'applied', leaseUntilMs: h.clock.now + 30_000 }))
    h.pointed.add('example.com').add('www.example.com')
    expect((await advanceDomainConnectSession('s', h.deps))?.status).toBe('applied')
    expect(h.connects).toHaveLength(0)
  })

  it('answers null for no such session', async () => {
    expect(await advanceDomainConnectSession('missing', harness().deps)).toBeNull()
  })

  it('fails with the refusal when the owner may no longer connect, and connects nothing', async () => {
    const h = harness({ permitted: 'not-admin' })
    h.store.rows.set('s', session({ status: 'waiting' }))
    h.pointed.add('example.com').add('www.example.com')
    expect(await advanceDomainConnectSession('s', h.deps)).toMatchObject({ status: 'failed', code: 'not-admin' })
    expect(h.connects).toHaveLength(0)
  })

  it.each<[string, SessionConnectOutcome, { status: string; code: string | null }]>([
    ['serving at once', { ok: 'connected', servingPending: false }, { status: 'connected', code: null }],
    ['awaiting its certificate', { ok: 'connected', servingPending: true }, { status: 'connected', code: 'serving-pending' }],
    ['claimed, attach retried later', { ok: 'refused', code: 'attach-failed' }, { status: 'connected', code: 'attach-pending' }],
    ['claimed, no provider here', { ok: 'refused', code: 'not-configured' }, { status: 'connected', code: 'attach-pending' }],
    ['another site holds it', { ok: 'refused', code: 'taken' }, { status: 'failed', code: 'taken' }],
    ['held by another account', { ok: 'refused', code: 'held-elsewhere' }, { status: 'failed', code: 'held-elsewhere' }],
  ])('records a connect %s', async (_label, outcome, expected) => {
    const h = harness({ outcome })
    h.store.rows.set('s', session({ status: 'applied', twin: null }))
    h.pointed.add('example.com')
    expect(await advanceDomainConnectSession('s', h.deps)).toMatchObject(expected)
  })
})

describe('the sweep', () => {
  it('advances every due session and counts what happened', async () => {
    const h = harness({ permitted: null })
    h.store.rows.set('a', session({ status: 'applied', twin: null }))
    h.store.rows.set('b', session({ status: 'waiting', domain: 'other.example', twin: null, createdAtMs: T0 - DOMAIN_CONNECT_SESSION_TTL_MS, expiresAtMs: T0 }))
    h.store.rows.set('c', session({ status: 'connected', nextCheckAtMs: null }))
    h.pointed.add('example.com')
    const report = await sweepDomainConnectSessions(h.deps, { deadlineMs: h.clock.now + 60_000 })
    expect(report).toEqual({ checked: 2, connected: 1, expired: 1, failed: 0 })
  })

  it('starts nothing past its deadline', async () => {
    const h = harness()
    h.store.rows.set('a', session({ status: 'applied' }))
    expect(await sweepDomainConnectSessions(h.deps, { deadlineMs: h.clock.now })).toMatchObject({ checked: 0 })
  })
})

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

import {
  isLockdownActive,
  LOCKDOWN_MESSAGE_MAX,
  lockdownNotice,
  lockdownRetryAfterSeconds,
  normalizeHostLockdown,
  normalizeLockdownDoc,
  normalizeOrgLockdown,
  resolveLockdown,
  toEpochMs,
  userLockdownDocId,
} from './lockdown'
import type { LockdownState } from './lockdown'

const NOW = 1_755_000_000_000

const state = (over: Partial<LockdownState> = {}): LockdownState => ({
  scope: 'org',
  reason: 'manual',
  ...over,
})

describe('toEpochMs', () => {
  it('reads numbers, {seconds}, {_seconds}, toMillis and ISO strings', () => {
    expect(toEpochMs(NOW)).toBe(NOW)
    expect(toEpochMs({ seconds: 10 })).toBe(10_000)
    expect(toEpochMs({ _seconds: 10 })).toBe(10_000)
    expect(toEpochMs({ toMillis: () => 42 })).toBe(42)
    expect(toEpochMs('2026-08-13T00:00:00.000Z')).toBe(
      Date.parse('2026-08-13T00:00:00.000Z'),
    )
  })

  it('refuses garbage rather than guessing', () => {
    expect(toEpochMs(undefined)).toBeUndefined()
    expect(toEpochMs(null)).toBeUndefined()
    expect(toEpochMs('not a date')).toBeUndefined()
    expect(toEpochMs(Number.NaN)).toBeUndefined()
    expect(toEpochMs({})).toBeUndefined()
  })
})

describe('isLockdownActive — expiry restores access without staff action', () => {
  it('no expiry = active indefinitely', () => {
    expect(isLockdownActive(state(), NOW)).toBe(true)
  })

  it('future expiry = active; passed expiry = inactive, no write needed', () => {
    const window = state({ reason: 'maintenance', untilMs: NOW + 60_000 })
    expect(isLockdownActive(window, NOW)).toBe(true)
    expect(isLockdownActive(window, NOW + 60_000)).toBe(false)
    expect(isLockdownActive(window, NOW + 120_000)).toBe(false)
  })

  it('null state is not active', () => {
    expect(isLockdownActive(null, NOW)).toBe(false)
    expect(isLockdownActive(undefined, NOW)).toBe(false)
  })
})

describe('resolveLockdown — precedence platform > org > host > user', () => {
  it('platform wins over every narrower scope', () => {
    const resolved = resolveLockdown(
      {
        platform: state({ scope: 'platform', reason: 'maintenance' }),
        org: state({ scope: 'org', reason: 'billing' }),
        host: state({ scope: 'host', reason: 'security' }),
        user: state({ scope: 'user', reason: 'manual' }),
      },
      NOW,
    )
    expect(resolved?.scope).toBe('platform')
    expect(resolved?.reason).toBe('maintenance')
  })

  it('an EXPIRED wider scope yields to an active narrower one', () => {
    const resolved = resolveLockdown(
      {
        platform: state({
          scope: 'platform',
          reason: 'maintenance',
          untilMs: NOW - 1,
        }),
        host: state({ scope: 'host', reason: 'security' }),
      },
      NOW,
    )
    expect(resolved?.scope).toBe('host')
  })

  it('nothing active = null', () => {
    expect(resolveLockdown({}, NOW)).toBeNull()
    expect(
      resolveLockdown(
        { user: state({ scope: 'user', untilMs: NOW - 1 }) },
        NOW,
      ),
    ).toBeNull()
  })
})

describe('normalizeOrgLockdown — the shipped AGL-202 carrier, extended', () => {
  it('legacy suspendedAt-only orgs normalize to manual with NO public message', () => {
    const normalized = normalizeOrgLockdown({
      suspendedAt: { seconds: 1_700_000_000 },
      // Legacy free-text reason was written for staff eyes (e.g. "spam
      // network") and must never surface in the visitor notice.
    } as never)
    expect(normalized).toEqual({
      scope: 'org',
      reason: 'manual',
      message: undefined,
      atMs: 1_700_000_000_000,
      untilMs: undefined,
    })
  })

  it('carries the new reason code, message and expiry', () => {
    const normalized = normalizeOrgLockdown({
      suspendedAt: { seconds: 1 },
      suspendedReasonCode: 'billing',
      suspendedMessage: 'Payment overdue since July.',
      suspendedUntilMs: NOW + 1,
    })
    expect(normalized?.reason).toBe('billing')
    expect(normalized?.message).toBe('Payment overdue since July.')
    expect(normalized?.untilMs).toBe(NOW + 1)
  })

  it('an unknown reason code degrades to manual, not a crash or a leak', () => {
    const normalized = normalizeOrgLockdown({
      suspendedAt: { seconds: 1 },
      suspendedReasonCode: 'weird-future-code',
    })
    expect(normalized?.reason).toBe('manual')
  })

  it('not suspended = null', () => {
    expect(normalizeOrgLockdown({})).toBeNull()
    expect(normalizeOrgLockdown(null)).toBeNull()
    expect(normalizeOrgLockdown({ suspendedAt: null })).toBeNull()
  })

  it('bounds the message at LOCKDOWN_MESSAGE_MAX', () => {
    const normalized = normalizeOrgLockdown({
      suspendedAt: { seconds: 1 },
      suspendedMessage: 'x'.repeat(LOCKDOWN_MESSAGE_MAX + 100),
    })
    expect(normalized?.message).toHaveLength(LOCKDOWN_MESSAGE_MAX)
  })
})

describe('normalizeHostLockdown — staff takedown, NOT host.maintenance', () => {
  it('reads the suspended* family from the host doc', () => {
    const normalized = normalizeHostLockdown({
      suspendedAt: NOW,
      suspendedReasonCode: 'security',
      suspendedMessage: 'Compromised deploy under review.',
    })
    expect(normalized?.scope).toBe('host')
    expect(normalized?.reason).toBe('security')
  })

  it('ignores the customer-writable maintenance flag entirely', () => {
    expect(
      normalizeHostLockdown({ maintenance: true } as never),
    ).toBeNull()
  })
})

describe('normalizeLockdownDoc — lockdowns/{platform|user--uid}', () => {
  it('normalizes a well-formed doc', () => {
    const normalized = normalizeLockdownDoc(
      {
        scope: 'platform',
        reason: 'maintenance',
        message: 'Back at 09:00 UTC.',
        atMs: NOW,
        untilMs: NOW + 3_600_000,
        actorUid: 'staff-1',
      },
      'platform',
    )
    expect(normalized).toEqual({
      scope: 'platform',
      reason: 'maintenance',
      message: 'Back at 09:00 UTC.',
      atMs: NOW,
      untilMs: NOW + 3_600_000,
      actorUid: 'staff-1',
    })
  })

  it('refuses a doc with a malformed reason (no guessing on the panic path)', () => {
    expect(normalizeLockdownDoc({ reason: 'nope' as never }, 'user')).toBeNull()
    expect(normalizeLockdownDoc({}, 'platform')).toBeNull()
    expect(normalizeLockdownDoc(null, 'platform')).toBeNull()
  })

  it('doc id helper encodes the user scope', () => {
    expect(userLockdownDocId('abc')).toBe('user--abc')
  })
})

describe('lockdownRetryAfterSeconds', () => {
  it('is undefined without an expiry and clamped to >= 60 with one', () => {
    expect(lockdownRetryAfterSeconds(state(), NOW)).toBeUndefined()
    expect(
      lockdownRetryAfterSeconds(state({ untilMs: NOW + 600_000 }), NOW),
    ).toBe(600)
    expect(lockdownRetryAfterSeconds(state({ untilMs: NOW + 1 }), NOW)).toBe(60)
  })
})

describe('lockdownNotice — per-reason visitor copy', () => {
  it('maintenance names the window when it has one and never a contact line', () => {
    const withEnd = lockdownNotice(
      state({ reason: 'maintenance', untilMs: Date.parse('2026-09-01') }),
    )
    expect(withEnd.title).toBe('Down for maintenance')
    expect(withEnd.body).toContain('Expected back by')
    expect(withEnd.contact).toBeUndefined()
  })

  it('billing explains how to resolve and offers support contact', () => {
    const notice = lockdownNotice(state({ reason: 'billing' }))
    expect(notice.title).toBe('Account on hold')
    expect(notice.body).toContain('billing')
    expect(notice.contact).toBe('support@aglyn.com')
  })

  it('security and manual stay plain and point at support', () => {
    for (const reason of ['security', 'manual'] as const) {
      const notice = lockdownNotice(state({ reason }))
      expect(notice.title).toBe('Temporarily unavailable')
      expect(notice.contact).toBe('support@aglyn.com')
    }
  })

  it('a staff message replaces the body but never the contact affordance', () => {
    const notice = lockdownNotice(
      state({ reason: 'security', message: 'Custom words.' }),
    )
    expect(notice.body).toBe('Custom words.')
    expect(notice.contact).toBe('support@aglyn.com')
  })
})

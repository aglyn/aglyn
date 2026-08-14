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
  featureLockdownDocId,
  isLockdownActive,
  isLockdownFeatureKey,
  LOCKDOWN_FEATURE_KEYS,
  LOCKDOWN_FEATURE_LABELS,
  LOCKDOWN_FEATURE_STAFF_BYPASS,
  LOCKDOWN_MESSAGE_MAX,
  lockdownFeatureForPluginApiPath,
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

describe('FEATURE scope (AGL-1510) — the pure half', () => {
  it('the launch set is exactly the five incident levers, extensible by enum', () => {
    expect(LOCKDOWN_FEATURE_KEYS).toEqual([
      'signups',
      'uploads',
      'checkout',
      'marketplace-installs',
      'ai-assist',
    ])
    for (const key of LOCKDOWN_FEATURE_KEYS) {
      expect(isLockdownFeatureKey(key)).toBe(true)
      // Every key the staff checklist renders has a label.
      expect(LOCKDOWN_FEATURE_LABELS[key]).toBeTruthy()
    }
    expect(isLockdownFeatureKey('everything')).toBe(false)
  })

  it('doc id helper encodes the feature scope in the shared collection', () => {
    expect(featureLockdownDocId('uploads')).toBe('feature--uploads')
  })

  it('PINS the per-feature staff bypass decisions — change these on purpose only', () => {
    // Bypass where a staff action aids incident response; withheld where it
    // would BE the incident. Justifications live on the map's declaration.
    expect(LOCKDOWN_FEATURE_STAFF_BYPASS).toEqual({
      signups: false,
      uploads: true,
      checkout: false,
      'marketplace-installs': true,
      'ai-assist': true,
    })
  })

  it('normalizes a feature doc, carrying the key; refuses unknown keys whole', () => {
    const normalized = normalizeLockdownDoc(
      { scope: 'feature', feature: 'uploads', reason: 'security', atMs: NOW },
      'feature',
    )
    expect(normalized?.scope).toBe('feature')
    expect(normalized?.feature).toBe('uploads')
    expect(
      normalizeLockdownDoc(
        { scope: 'feature', feature: 'warp-drive' as never, reason: 'manual' },
        'feature',
      ),
    ).toBeNull()
    expect(
      normalizeLockdownDoc({ scope: 'feature', reason: 'manual' }, 'feature'),
    ).toBeNull()
  })
})

describe('lockdownFeatureForPluginApiPath — the dispatcher map', () => {
  it('ai/assist is gated even while the handler 501s without a key', () => {
    expect(lockdownFeatureForPluginApiPath('ai/assist')).toBe('ai-assist')
  })

  it('installs-as-a-class: every install path plus update-artifact', () => {
    for (const path of [
      'marketplace/install',
      'marketplace/install-plugin',
      'marketplace/install-theme',
      'marketplace/install-template',
      'marketplace/install-layout',
      'marketplace/install-dataset-schema',
      'marketplace/install-email-template',
      'marketplace/update-artifact',
    ]) {
      expect(`${path} → ${lockdownFeatureForPluginApiPath(path)}`).toBe(
        `${path} → marketplace-installs`,
      )
    }
  })

  it('marketplace checkout is checkout — a NEW Stripe session either way', () => {
    expect(lockdownFeatureForPluginApiPath('marketplace/checkout')).toBe(
      'checkout',
    )
  })

  it('publish, report and review paths map to NOTHING — the incident response must not gag its own inputs', () => {
    for (const path of [
      'marketplace/publish',
      'marketplace/publish-plugin',
      'marketplace/report',
      'marketplace/reviews',
      'marketplace/listing-versions',
      'marketplace/connect',
      'anything/else',
    ]) {
      expect(`${path} → ${lockdownFeatureForPluginApiPath(path)}`).toBe(
        `${path} → null`,
      )
    }
  })
})

describe('feature notices — honest, feature-specific copy', () => {
  const featureState = (
    feature: LockdownState['feature'],
    over: Partial<LockdownState> = {},
  ): LockdownState => ({
    scope: 'feature',
    feature,
    reason: 'manual',
    ...over,
  })

  it('a paused signup explains itself and reassures existing accounts', () => {
    const notice = lockdownNotice(featureState('signups'))
    expect(notice.title).toBe('New signups are paused')
    expect(notice.body).toContain('Existing accounts')
  })

  it('a disabled checkout NEVER reads as a payment failure', () => {
    const notice = lockdownNotice(featureState('checkout'))
    expect(notice.title).toBe('Checkout is temporarily unavailable')
    expect(notice.body).toContain('not a payment failure')
    expect(notice.body).toContain('unaffected')
    // And never words that send someone to their bank.
    expect(notice.body.toLowerCase()).not.toContain('declined')
    expect(notice.body.toLowerCase()).not.toContain('card')
  })

  it('uploads and installs say what still works', () => {
    expect(lockdownNotice(featureState('uploads')).body).toContain('unaffected')
    expect(lockdownNotice(featureState('marketplace-installs')).body).toContain(
      'keeps working',
    )
  })

  it('a staff message replaces the body; title and contact stay per-feature', () => {
    const notice = lockdownNotice(
      featureState('uploads', { message: 'Custom incident words.' }),
    )
    expect(notice.body).toBe('Custom incident words.')
    expect(notice.title).toBe('Uploads are paused')
    expect(notice.contact).toBe('support@aglyn.com')
  })

  it('a window names its end', () => {
    const notice = lockdownNotice(
      featureState('ai-assist', { untilMs: Date.parse('2026-09-01') }),
    )
    expect(notice.body).toContain('Expected back by')
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

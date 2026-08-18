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
  isLockdownMode,
  isReadOnlyLockdown,
  LOCKDOWN_MODES,
  lockdownBlocks,
  lockdownFeaturesForPluginApiPath,
  lockdownIntentForMethod,
  lockdownMode,
  lockdownNotice,
  lockdownPausedNotice,
  lockdownPausedSurfaceForPluginApiPath,
  lockdownRefusalText,
  lockdownRetryAfterSeconds,
  parseLockdownRefusal,
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

// AGL-2016: the contact line these notices carry is the OPERATOR's, resolved
// from configuration. Every assertion below that names `support@aglyn.com` is
// therefore an assertion about AGLYN-OPERATED behaviour, and it only holds
// because this block configures it — which is the point. Without it they
// would read `undefined`, and before AGL-2016 they read a literal that could
// never have been anything else.
beforeEach(() => {
  process.env.NEXT_PUBLIC_OPERATOR_NAME = 'Aglyn LLC'
  process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL = 'support@aglyn.com'
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_OPERATOR_NAME
  delete process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL
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

describe('lockdownFeaturesForPluginApiPath — the dispatcher map', () => {
  it('ai/assist is gated even while the handler 501s without a key', () => {
    expect(lockdownFeaturesForPluginApiPath('ai/assist')).toEqual(['ai-assist'])
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
      expect(`${path} → ${lockdownFeaturesForPluginApiPath(path)}`).toBe(
        `${path} → marketplace-installs`,
      )
    }
  })

  it('marketplace checkout gates on BOTH checkout and marketplace-installs (AGL-1545)', () => {
    // A paid purchase is a new Stripe session AND the front door of an
    // install: a malicious-listing incident must stop buyers PAYING for
    // the artifact under investigation, not merely refuse the install
    // after the money moved.
    expect(lockdownFeaturesForPluginApiPath('marketplace/checkout')).toEqual([
      'checkout',
      'marketplace-installs',
    ])
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
      expect(lockdownFeaturesForPluginApiPath(path)).toEqual([])
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

/**
 * The client half of the feature lockdown (AGL-1532).
 *
 * The server has refused honestly since AGL-1510 — every chokepoint returns
 * `{error:'locked', scope, feature, title, message, untilMs?}`, and the
 * checkout copy says in so many words that it is NOT a payment failure. But
 * a body nobody reads is a body nobody reads: the billing, marketplace and
 * AI-assist call sites funnelled a 423 into "Could not start checkout" /
 * "Install failed" / "AI request failed". During beta week the lockdown IS
 * the incident response, and a lock that misreports itself as a broken
 * product spends the trust it exists to protect — a customer who believes
 * their card was declined retries, panics, then emails support.
 *
 * This parser is the one place that reading happens, so these are the
 * contracts every surface inherits.
 */
describe('parseLockdownRefusal — the client 423 reader (AGL-1532)', () => {
  const CHECKOUT_423 = {
    error: 'locked',
    scope: 'feature',
    feature: 'checkout',
    reason: 'manual',
    title: 'Checkout is temporarily unavailable',
    message:
      'Checkout is temporarily unavailable — this is not a payment ' +
      'failure, and your account, subscription, and sites are unaffected. ' +
      'Please try again shortly.',
    contact: 'support@aglyn.com',
  }

  it('a 423 with a body yields the honest title and message', () => {
    const notice = parseLockdownRefusal(423, CHECKOUT_423)
    expect(notice?.title).toBe('Checkout is temporarily unavailable')
    expect(notice?.message).toContain('not a payment failure')
    expect(notice?.message).toContain('unaffected')
    expect(notice?.feature).toBe('checkout')
    expect(notice?.contact).toBe('support@aglyn.com')
    // The words that would send a customer to their bank must not appear.
    const text = lockdownRefusalText(notice as never).toLowerCase()
    expect(text).not.toContain('declined')
    expect(text).not.toContain('card')
    expect(text).not.toContain('failed')
  })

  it('a real failure is NOT swallowed into a lockdown notice', () => {
    // The generic toast is the RIGHT answer for a 500 — dressing an
    // unexplained fault as a deliberate pause is a worse lie than the one
    // this affordance fixes.
    expect(parseLockdownRefusal(500, { error: 'boom' })).toBeNull()
    expect(parseLockdownRefusal(402, { error: 'payment_required' })).toBeNull()
    expect(parseLockdownRefusal(409, CHECKOUT_423)).toBeNull()
    expect(parseLockdownRefusal(200, { ok: true })).toBeNull()
  })

  it('a malformed 423 degrades without crashing and never says undefined', () => {
    const bodies: unknown[] = [
      undefined,
      null,
      {},
      'not json at all',
      42,
      { error: 'locked' },
      { title: '   ', message: '' },
      { feature: 'warp-drive', untilMs: 'soon' },
    ]
    for (const body of bodies) {
      const notice = parseLockdownRefusal(423, body)
      expect(notice).not.toBeNull()
      const text = lockdownRefusalText(notice as never)
      expect(text).not.toContain('undefined')
      expect(text).not.toContain('null')
      expect(text.trim().length).toBeGreaterThan(0)
      // Honest, not vague: a degraded notice still says "paused", never
      // "something went wrong".
      expect(text.toLowerCase()).toContain('paused')
    }
  })

  it('a body naming a known feature but no copy still gets the RIGHT words', () => {
    // The per-feature copy lives in this module, so a truncated body or an
    // older deploy still reads as "installs are paused" rather than the
    // generic fallback.
    const notice = parseLockdownRefusal(423, {
      error: 'locked',
      scope: 'feature',
      feature: 'marketplace-installs',
    })
    expect(notice?.title).toBe('Marketplace installs are paused')
    expect(notice?.message).toContain('already installed keeps working')
  })

  it('untilMs renders as a human local time, never a raw timestamp', () => {
    const untilMs = NOW + 3 * 60 * 60 * 1000
    const stamp = new Date(untilMs).toUTCString()
    const notice = parseLockdownRefusal(423, {
      ...CHECKOUT_423,
      untilMs,
      message: `${CHECKOUT_423.message} Expected back by ${stamp}.`,
    })
    expect(notice?.untilMs).toBe(untilMs)
    const text = lockdownRefusalText(notice as never)
    expect(text).toContain('Expected back around')
    expect(text).not.toContain(String(untilMs))
    // Stated ONCE: the server's UTC sentence is replaced, not doubled.
    expect(text).not.toContain('Expected back by')
    expect(text.match(/Expected back/g)).toHaveLength(1)
  })

  it('most locks have no expiry, and then none is invented', () => {
    const notice = parseLockdownRefusal(423, CHECKOUT_423)
    expect(notice?.untilMs).toBeUndefined()
    expect(notice?.until).toBeUndefined()
    expect(lockdownRefusalText(notice as never)).not.toContain('Expected back')
  })

  it('a staff-typed message survives untouched, and still gains the window', () => {
    const untilMs = NOW + 60_000
    const notice = parseLockdownRefusal(423, {
      ...CHECKOUT_423,
      untilMs,
      message: 'We are mid-Stripe-incident. Nothing was charged.',
    })
    expect(notice?.message).toBe(
      'We are mid-Stripe-incident. Nothing was charged.',
    )
    expect(notice?.until).toContain('Expected back around')
  })

  it('the one-line form never repeats a title the message opens with', () => {
    const checkout = parseLockdownRefusal(423, CHECKOUT_423)
    expect(lockdownRefusalText(checkout as never)).toBe(CHECKOUT_423.message)
    // …but a title that adds information is kept.
    const installs = parseLockdownRefusal(423, {
      error: 'locked',
      feature: 'marketplace-installs',
    })
    expect(lockdownRefusalText(installs as never)).toContain(
      'Marketplace installs are paused — ',
    )
  })
})

/**
 * READ-ONLY mode (AGL-1511). The pure half: what `mode` means when it is
 * absent, which lock wins when two are active with different strictness,
 * and which requests a read-only lock actually refuses.
 */
describe('AGL-1511 · read-only mode', () => {
  it('treats an absent, unknown or malformed mode as full', () => {
    // Every lock written before this field existed, and any value a future
    // deploy invents. A strictness this build cannot read must never relax.
    expect(lockdownMode(undefined)).toBe('full')
    expect(lockdownMode(null)).toBe('full')
    expect(lockdownMode(state())).toBe('full')
    expect(lockdownMode({ mode: 'READ-ONLY' } as never)).toBe('full')
    expect(lockdownMode({ mode: 'readonly' } as never)).toBe('full')
    expect(lockdownMode({ mode: 'read-only' })).toBe('read-only')
    expect(isReadOnlyLockdown(state({ mode: 'read-only' }))).toBe(true)
    expect(isReadOnlyLockdown(state())).toBe(false)
    expect(LOCKDOWN_MODES).toEqual(['full', 'read-only'])
    expect(isLockdownMode('read-only')).toBe(true)
    expect(isLockdownMode('nope')).toBe(false)
  })

  it('carries the mode off the org and host carriers, exact string only', () => {
    expect(
      normalizeOrgLockdown({ suspendedAt: NOW, suspendedMode: 'read-only' })
        ?.mode,
    ).toBe('read-only')
    expect(normalizeOrgLockdown({ suspendedAt: NOW })?.mode).toBeUndefined()
    // A carrier holding junk normalizes to full, not to "unknown".
    expect(
      lockdownMode(
        normalizeOrgLockdown({ suspendedAt: NOW, suspendedMode: 'partial' }),
      ),
    ).toBe('full')
    expect(
      normalizeHostLockdown({ suspendedAt: NOW, suspendedMode: 'read-only' })
        ?.mode,
    ).toBe('read-only')
    expect(
      normalizeLockdownDoc(
        { scope: 'platform', reason: 'maintenance', mode: 'read-only' },
        'platform',
      )?.mode,
    ).toBe('read-only')
    expect(
      lockdownMode(
        normalizeLockdownDoc(
          { scope: 'platform', reason: 'maintenance', mode: 'nonsense' as never },
          'platform',
        ),
      ),
    ).toBe('full')
  })

  it('refuses writes and passes reads — full refuses both', () => {
    const readOnly = state({ mode: 'read-only' })
    expect(lockdownBlocks(readOnly, 'write')).toBe(true)
    expect(lockdownBlocks(readOnly, 'read')).toBe(false)
    const full = state()
    expect(lockdownBlocks(full, 'write')).toBe(true)
    expect(lockdownBlocks(full, 'read')).toBe(true)
    // No lock refuses nothing.
    expect(lockdownBlocks(null, 'write')).toBe(false)
  })

  it('maps only the safe methods to a read intent', () => {
    for (const method of ['GET', 'get', 'HEAD', 'OPTIONS']) {
      expect(lockdownIntentForMethod(method)).toBe('read')
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', '', null]) {
      expect(lockdownIntentForMethod(method)).toBe('write')
    }
    // An absent method is a write: the fail-safe direction.
    expect(lockdownIntentForMethod(undefined)).toBe('write')
  })

  it('never lets a wider READ-ONLY lock soften a narrower FULL one', () => {
    // THE hole this precedence rule closes: a platform-wide read-only
    // maintenance window while one org is under a full security takedown.
    // Width-only precedence would return the platform state and readmit
    // every visitor to the site staff just took down.
    const resolved = resolveLockdown(
      {
        platform: state({ scope: 'platform', reason: 'maintenance', mode: 'read-only' }),
        org: state({ scope: 'org', reason: 'security' }),
      },
      NOW,
    )
    expect(resolved?.scope).toBe('org')
    expect(lockdownMode(resolved)).toBe('full')
  })

  it('still prefers the widest scope among equally strict locks', () => {
    const bothFull = resolveLockdown(
      {
        platform: state({ scope: 'platform', reason: 'maintenance' }),
        org: state({ scope: 'org', reason: 'security' }),
      },
      NOW,
    )
    expect(bothFull?.scope).toBe('platform')
    const bothReadOnly = resolveLockdown(
      {
        platform: state({ scope: 'platform', reason: 'maintenance', mode: 'read-only' }),
        org: state({ scope: 'org', reason: 'manual', mode: 'read-only' }),
      },
      NOW,
    )
    expect(bothReadOnly?.scope).toBe('platform')
  })

  it('ignores an EXPIRED full lock when choosing the strictest', () => {
    // Strictness is chosen among the ACTIVE locks only — an expired full
    // lock must not outrank a live read-only one and re-close the platform.
    const resolved = resolveLockdown(
      {
        platform: state({ scope: 'platform', reason: 'maintenance', mode: 'read-only' }),
        org: state({ scope: 'org', reason: 'security', untilMs: NOW - 1 }),
      },
      NOW,
    )
    expect(resolved?.scope).toBe('platform')
    expect(lockdownMode(resolved)).toBe('read-only')
  })

  it('tells the account holder that reads still work, not that they are down', () => {
    const notice = lockdownNotice(
      state({ scope: 'org', reason: 'maintenance', mode: 'read-only' }),
    )
    expect(notice.title).toBe('Changes are temporarily paused')
    // The two claims the full-lock copy cannot make, and the ones that stop
    // a fifteen-minute migration turning into a support ticket.
    expect(notice.body).toContain('keep serving')
    expect(notice.body).toContain('nothing you have created is affected')
    expect(notice.body).not.toContain('Access is temporarily disabled')
    // A staff-typed message still replaces the body only.
    expect(
      lockdownNotice(
        state({ reason: 'maintenance', mode: 'read-only', message: 'Counter repair.' }),
      ).body,
    ).toBe('Counter repair.')
  })

  it('round-trips the read-only expiry into the reader’s local time', () => {
    // The suffix the notice builder appends must be the exact one the
    // parser strips, or the visitor sees the UTC stamp AND the local one.
    const untilMs = NOW + 900_000
    const notice = lockdownNotice(
      state({ reason: 'maintenance', mode: 'read-only', untilMs }),
    )
    const parsed = parseLockdownRefusal(423, {
      error: 'locked',
      mode: 'read-only',
      title: notice.title,
      message: notice.body,
      untilMs,
    })
    expect(parsed?.mode).toBe('read-only')
    expect(parsed?.message).not.toContain('Expected back by')
    expect(parsed?.until).toContain('Expected back around')
  })

  it('says nothing to a visitor about workspaces, support or maintenance', () => {
    // Visitor copy is for a stranger on the customer's site. Anything that
    // reads as OUR outage or points at OUR support desk is a leak of the
    // wrong thing at the wrong person.
    for (const surface of ['form', 'checkout', 'cart', 'generic'] as const) {
      const notice = lockdownPausedNotice(surface)
      expect(notice.contact).toBeUndefined()
      expect(notice.body.toLowerCase()).not.toContain('workspace')
      expect(notice.body.toLowerCase()).not.toContain('maintenance')
      expect(notice.body.toLowerCase()).not.toContain('aglyn')
      expect(notice.body).toMatch(/shortly|try again/)
    }
    // The checkout sentence's non-negotiable promise.
    const checkout = lockdownPausedNotice('checkout')
    expect(checkout.body).toContain('not a payment')
    expect(checkout.body).toContain('have not been charged')
    // And the form's, which is what stops someone retyping everything.
    expect(lockdownPausedNotice('form').body).toContain('Nothing you typed')
  })

  it('routes the checkout paths to checkout copy and guesses nothing else', () => {
    expect(lockdownPausedSurfaceForPluginApiPath('commerce/cart-checkout')).toBe(
      'checkout',
    )
    expect(lockdownPausedSurfaceForPluginApiPath('commerce/checkout')).toBe(
      'checkout',
    )
    expect(lockdownPausedSurfaceForPluginApiPath('commerce/cart')).toBe('cart')
    expect(lockdownPausedSurfaceForPluginApiPath('commerce/cart/add')).toBe(
      'cart',
    )
    // Unrecognised paths get the neutral pause, never a money claim.
    expect(lockdownPausedSurfaceForPluginApiPath('bookings/create')).toBe(
      'generic',
    )
    expect(lockdownPausedSurfaceForPluginApiPath('')).toBe('generic')
  })
})


describe('AGL-2016 · the lockdown notice addresses the OPERATOR', () => {
  // The Aglyn-operated direction is covered by every `contact` assertion
  // above, which only passes because the top-level `beforeEach` configures
  // us. This is the other half: without both, the suite passes on a module
  // that ignores configuration entirely.
  afterEach(() => {
    process.env.NEXT_PUBLIC_OPERATOR_NAME = 'Aglyn LLC'
    process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL = 'support@aglyn.com'
  })

  it('points a self-hosted site at its own operator, never at us', () => {
    process.env.NEXT_PUBLIC_OPERATOR_NAME = 'Bramble Studio GmbH'
    process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL = 'hello@bramble.example'
    const notice = lockdownNotice(state({ scope: 'org', reason: 'billing' }))
    expect(notice.contact).toBe('hello@bramble.example')
    expect(notice.contact).not.toContain('aglyn')
  })

  it('offers no contact line at all rather than a blank one', () => {
    // `undefined` is the shape `maintenance` already uses for "no contact
    // affordance", so the renderers drop the line. An empty string would
    // render `mailto:` with nothing behind it — a link a locked-out customer
    // clicks and a mail client that opens addressed to nobody.
    delete process.env.NEXT_PUBLIC_OPERATOR_NAME
    delete process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL
    const notice = lockdownNotice(state({ scope: 'org', reason: 'billing' }))
    expect(notice.contact).toBeUndefined()
    expect(notice.title).toBe('Account on hold')
  })
})

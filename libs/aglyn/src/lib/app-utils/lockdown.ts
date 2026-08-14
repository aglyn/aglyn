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
 * Lockdown (AGL-1501): the panic button. ONE state shape and ONE resolver
 * across four scopes — platform, org, host, user — with precedence
 * platform > org > host > user.
 *
 * This module is deliberately pure: it normalizes the storage carriers into
 * `LockdownState` and answers "is access locked, and what does the visitor
 * see". Where the state LIVES differs per scope, because two of the four
 * scopes already shipped and re-implementing them beside themselves is the
 * bug class this repo keeps re-learning:
 *
 * - **org** — `orgs/{orgId}.suspendedAt` (AGL-202/210), extended here with
 *   `suspendedReasonCode` / `suspendedMessage` / `suspendedUntilMs`. Every
 *   existing reader of `suspendedAt` keeps working unchanged.
 * - **host** — NEW staff-only `suspendedAt` (+ same extensions) on the host
 *   doc. Deliberately NOT `host.maintenance`: that field is CLIENT-writable
 *   (the customer's own maintenance switch, AGL-131) and must never double
 *   as a staff security control the customer could simply switch off.
 * - **platform** — NEW `lockdowns/platform` doc (Admin-SDK read/write; the
 *   collection is staff-only in rules).
 * - **user** — NEW `lockdowns/user--{uid}` doc carrying reason/notice,
 *   alongside the existing Firebase Auth `disabled` flag + refresh-token
 *   revocation which do the actual keying-out.
 *
 * The un-panic invariant lives in the SERVER verdict helper
 * (libs/tenant/data/admin lockdown.ts): a verified `staff` claim bypasses
 * every scope, always — a platform lockdown must never lock out the staff
 * who can lift it. Nothing in this module may be given a way to override
 * that.
 */

export type LockdownScope = 'platform' | 'org' | 'host' | 'user' | 'feature'

/**
 * FEATURE scope (AGL-1510): kill one capability platform-wide while
 * everything else keeps serving. The launch set maps one-to-one onto the
 * incident shapes the issue names — bot wave → `signups`, malware report →
 * `uploads`, billing bug → `checkout`, malicious listing →
 * `marketplace-installs`, provider incident/cost runaway → `ai-assist`.
 *
 * Precedence COMPOSES rather than ranks: a platform lock implies every
 * feature (the feature verdict helpers check platform first), while a
 * feature lock implies nothing about the platform/org/host/user scopes —
 * feature states never enter `resolveLockdown`.
 */
export type LockdownFeatureKey =
  | 'signups'
  | 'uploads'
  | 'checkout'
  | 'marketplace-installs'
  | 'ai-assist'

const LOCKDOWN_FEATURE_KEY_SET: Record<LockdownFeatureKey, true> = {
  signups: true,
  uploads: true,
  checkout: true,
  'marketplace-installs': true,
  'ai-assist': true,
}
/** Extensible launch set — the staff surface renders its checklist from it. */
export const LOCKDOWN_FEATURE_KEYS = Object.keys(
  LOCKDOWN_FEATURE_KEY_SET,
) as LockdownFeatureKey[]

export function isLockdownFeatureKey(
  value: unknown,
): value is LockdownFeatureKey {
  return typeof value === 'string' && value in LOCKDOWN_FEATURE_KEY_SET
}

/** Staff-surface labels; the key stays the wire/API identity. */
export const LOCKDOWN_FEATURE_LABELS: Record<LockdownFeatureKey, string> = {
  signups: 'New signups',
  uploads: 'Media uploads',
  checkout: 'Checkout (new subscriptions)',
  'marketplace-installs': 'Marketplace installs',
  'ai-assist': 'AI assist',
}

/**
 * The un-panic invariant, per feature (AGL-1510). At the PLATFORM scope a
 * verified staff claim bypasses unconditionally — that is unchanged and not
 * negotiable. A FEATURE lock is narrower, so the bypass is granted only
 * where it aids incident response, and withheld where a staff action would
 * be the very thing the lock exists to stop:
 *
 * - `uploads: true` — the uploads lock answers a malware report, and the
 *   staff member responding needs to upload a test asset to verify the fix
 *   before lifting the lock for everyone.
 * - `marketplace-installs: true` — same shape: a malicious listing slipped
 *   review, and reproducing the install is part of investigating it.
 * - `ai-assist: true` — a provider incident is verified recovered by staff
 *   making one real call, not by lifting the lock and watching customers
 *   find out.
 * - `checkout: false` — a checkout lock answers a billing/Stripe bug, and a
 *   staff-created checkout session is still a real charge against a real
 *   card. There is no incident-response step that needs money to move;
 *   verification belongs in Stripe test mode.
 * - `signups: false` — an account being created has no staff claim yet, so
 *   a bypass here could never fire honestly; declaring `false` states that
 *   rather than leaving a bypass that only a misattributed claim could use.
 */
export const LOCKDOWN_FEATURE_STAFF_BYPASS: Record<LockdownFeatureKey, boolean> =
  {
    signups: false,
    uploads: true,
    checkout: false,
    'marketplace-installs': true,
    'ai-assist': true,
  }

export type LockdownReasonCode =
  | 'security'
  | 'billing'
  | 'maintenance'
  | 'manual'

const LOCKDOWN_REASON_CODE_KEYS: Record<LockdownReasonCode, true> = {
  security: true,
  billing: true,
  maintenance: true,
  manual: true,
}
export const LOCKDOWN_REASON_CODES = Object.keys(
  LOCKDOWN_REASON_CODE_KEYS,
) as LockdownReasonCode[]

export function isLockdownReasonCode(
  value: unknown,
): value is LockdownReasonCode {
  return (
    typeof value === 'string' && value in LOCKDOWN_REASON_CODE_KEYS
  )
}

/** The one shape every enforcement point consumes. */
export interface LockdownState {
  scope: LockdownScope
  /** Set only when `scope === 'feature'` — which capability is locked. */
  feature?: LockdownFeatureKey
  reason: LockdownReasonCode
  /**
   * Visitor/user-facing notice text (bounded at write time). Anything staff
   * types here is SHOWN to locked-out users — internal rationale belongs in
   * the audit row, not this field.
   */
  message?: string
  atMs?: number
  /**
   * Optional expiry (maintenance windows end). Once `untilMs` passes the
   * lockdown is simply inactive — access restores with NO staff action and
   * no write.
   */
  untilMs?: number
  actorUid?: string
}

/**
 * `lockdowns/{id}` — the carrier for the two scopes that had none.
 * Doc ids are scope-encoded so a lookup is a single `get`:
 * `platform` and `user--{uid}`. Plain-number timestamps on purpose: the
 * collection is Admin-SDK-only and converter-free, so a partial write can
 * never run a converter that "defaults" a sibling field away (the
 * withConverter-on-partial-writes bug class).
 */
export const LOCKDOWNS_COLLECTION = 'lockdowns'
export const PLATFORM_LOCKDOWN_DOC_ID = 'platform'
export const userLockdownDocId = (uid: string): string => `user--${uid}`
/** `feature--{key}` — same collection, same rules, same audited writer. */
export const featureLockdownDocId = (feature: LockdownFeatureKey): string =>
  `feature--${feature}`

export interface LockdownDoc {
  scope: LockdownScope
  /** Present on `feature--{key}` docs only. */
  feature?: LockdownFeatureKey
  reason: LockdownReasonCode
  message?: string
  atMs?: number
  untilMs?: number
  actorUid?: string
}

/** Staff-typed notice text is user-facing; keep it bounded and plain. */
export const LOCKDOWN_MESSAGE_MAX = 500

/**
 * Tolerant epoch-ms reader: Firestore `Timestamp`, `{ seconds }` JSON, a
 * number of ms, or an ISO string — the org carrier's `suspendedAt` arrives
 * in all of these shapes depending on which cache serialized it.
 */
export function toEpochMs(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  if (typeof value === 'object') {
    const record = value as {
      toMillis?: () => number
      seconds?: number
      _seconds?: number
    }
    if (typeof record.toMillis === 'function') {
      try {
        return record.toMillis()
      } catch {
        return undefined
      }
    }
    const seconds = record.seconds ?? record._seconds
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      return seconds * 1000
    }
  }
  return undefined
}

/** Active now? Expiry passing deactivates without any write. */
export function isLockdownActive(
  state: LockdownState | null | undefined,
  nowMs: number,
): boolean {
  if (!state) return false
  if (typeof state.untilMs === 'number' && state.untilMs <= nowMs) return false
  return true
}

/**
 * Precedence: platform > org > host > user. The widest active scope wins so
 * the notice a visitor sees names the real cause (a platform maintenance
 * window should not read as "this account is suspended").
 */
export function resolveLockdown(
  states: {
    platform?: LockdownState | null
    org?: LockdownState | null
    host?: LockdownState | null
    user?: LockdownState | null
  },
  nowMs: number,
): LockdownState | null {
  for (const state of [states.platform, states.org, states.host, states.user]) {
    if (state && isLockdownActive(state, nowMs)) return state
  }
  return null
}

/**
 * Org carrier → state. `suspendedAt` alone (every pre-lockdown suspension)
 * normalizes to `manual` with no public message — the legacy free-text
 * `suspendedReason` was written for staff eyes and must not leak into the
 * visitor notice.
 */
export function normalizeOrgLockdown(
  org:
    | {
        suspendedAt?: unknown
        suspendedReasonCode?: unknown
        suspendedMessage?: unknown
        suspendedUntilMs?: unknown
      }
    | null
    | undefined,
): LockdownState | null {
  if (!org || org.suspendedAt == null) return null
  return {
    scope: 'org',
    reason: isLockdownReasonCode(org.suspendedReasonCode)
      ? org.suspendedReasonCode
      : 'manual',
    message:
      typeof org.suspendedMessage === 'string' && org.suspendedMessage
        ? org.suspendedMessage.slice(0, LOCKDOWN_MESSAGE_MAX)
        : undefined,
    atMs: toEpochMs(org.suspendedAt),
    untilMs:
      typeof org.suspendedUntilMs === 'number' &&
      Number.isFinite(org.suspendedUntilMs)
        ? org.suspendedUntilMs
        : undefined,
  }
}

/**
 * Host carrier → state. Same field family as the org, on the host doc.
 * `host.maintenance` is NOT consulted here — that is the customer's own
 * switch and keeps its shipped AGL-131 path.
 */
export function normalizeHostLockdown(
  host:
    | {
        suspendedAt?: unknown
        suspendedReasonCode?: unknown
        suspendedMessage?: unknown
        suspendedUntilMs?: unknown
      }
    | null
    | undefined,
): LockdownState | null {
  if (!host || host.suspendedAt == null) return null
  return {
    scope: 'host',
    reason: isLockdownReasonCode(host.suspendedReasonCode)
      ? host.suspendedReasonCode
      : 'manual',
    message:
      typeof host.suspendedMessage === 'string' && host.suspendedMessage
        ? host.suspendedMessage.slice(0, LOCKDOWN_MESSAGE_MAX)
        : undefined,
    atMs: toEpochMs(host.suspendedAt),
    untilMs:
      typeof host.suspendedUntilMs === 'number' &&
      Number.isFinite(host.suspendedUntilMs)
        ? host.suspendedUntilMs
        : undefined,
  }
}

/** `lockdowns/{id}` doc → state; refuses malformed docs rather than guess. */
export function normalizeLockdownDoc(
  doc: Partial<LockdownDoc> | null | undefined,
  scope: LockdownScope,
): LockdownState | null {
  if (!doc) return null
  if (!isLockdownReasonCode(doc.reason)) return null
  // A feature doc whose key is not (or no longer) in the enum is refused
  // whole, matching the malformed-reason posture: the panic path does not
  // guess, and an unknown key has no chokepoint to enforce it anyway.
  if (scope === 'feature' && !isLockdownFeatureKey(doc.feature)) return null
  return {
    scope,
    ...(scope === 'feature' && isLockdownFeatureKey(doc.feature)
      ? { feature: doc.feature }
      : {}),
    reason: doc.reason,
    message:
      typeof doc.message === 'string' && doc.message
        ? doc.message.slice(0, LOCKDOWN_MESSAGE_MAX)
        : undefined,
    atMs: typeof doc.atMs === 'number' ? doc.atMs : undefined,
    untilMs:
      typeof doc.untilMs === 'number' && Number.isFinite(doc.untilMs)
        ? doc.untilMs
        : undefined,
    actorUid: typeof doc.actorUid === 'string' ? doc.actorUid : undefined,
  }
}

/**
 * `Retry-After` seconds for a 503, when the lockdown has a known end.
 * Clamped to at least 60 so a window expiring mid-request cannot emit 0.
 */
export function lockdownRetryAfterSeconds(
  state: LockdownState,
  nowMs: number,
): number | undefined {
  if (typeof state.untilMs !== 'number') return undefined
  return Math.max(60, Math.ceil((state.untilMs - nowMs) / 1000))
}

export interface LockdownNotice {
  title: string
  body: string
  /** Shown as the action line; undefined = no contact line (maintenance). */
  contact?: string
}

export const LOCKDOWN_SUPPORT_EMAIL = 'support@aglyn.com'

/**
 * Per-reason visitor copy — plain and non-alarming. A staff-typed `message`
 * replaces the body; the title and contact line stay per-reason so staff
 * cannot accidentally strip the "how do I get out of this" affordance.
 */
export function lockdownNotice(state: LockdownState): LockdownNotice {
  const custom =
    typeof state.message === 'string' && state.message.trim()
      ? state.message.trim()
      : undefined
  // Feature locks carry feature-specific, honest copy (AGL-1510): what is
  // off, and — just as important — what is NOT affected. Same convention as
  // the per-reason copy below: a staff message replaces the body only.
  if (state.scope === 'feature' && state.feature) {
    return featureLockdownNotice(state.feature, custom, state.untilMs)
  }
  switch (state.reason) {
    case 'maintenance': {
      const until =
        typeof state.untilMs === 'number'
          ? new Date(state.untilMs).toUTCString()
          : undefined
      return {
        title: 'Down for maintenance',
        body:
          custom ??
          (until
            ? `Scheduled maintenance is in progress. Expected back by ${until}.`
            : 'Scheduled maintenance is in progress. Please check back shortly.'),
      }
    }
    case 'billing':
      return {
        title: 'Account on hold',
        body:
          custom ??
          'This account is on hold over an unresolved billing issue. ' +
            'Updating the payment method in workspace billing settings ' +
            'restores access.',
        contact: LOCKDOWN_SUPPORT_EMAIL,
      }
    case 'security':
      return {
        title: 'Temporarily unavailable',
        body:
          custom ??
          'Access is temporarily disabled while we investigate a security ' +
            'concern.',
        contact: LOCKDOWN_SUPPORT_EMAIL,
      }
    case 'manual':
    default:
      return {
        title: 'Temporarily unavailable',
        body: custom ?? 'Access to this account is currently disabled.',
        contact: LOCKDOWN_SUPPORT_EMAIL,
      }
  }
}

/**
 * Per-feature visitor copy (AGL-1510). Each notice says what is paused AND
 * what still works — a feature lock's whole point is that everything else
 * keeps serving, and the copy must not let a narrow pause read as a wider
 * outage. The checkout notice in particular must NEVER read as a payment
 * failure: "your card was declined" and "we turned checkout off" are
 * different sentences, and only one of them sends a customer to their bank.
 */
function featureLockdownNotice(
  feature: LockdownFeatureKey,
  custom: string | undefined,
  untilMs?: number,
): LockdownNotice {
  const window =
    typeof untilMs === 'number'
      ? ` Expected back by ${new Date(untilMs).toUTCString()}.`
      : ''
  switch (feature) {
    case 'signups':
      return {
        title: 'New signups are paused',
        body:
          custom ??
          `New signups are temporarily paused. Existing accounts can sign in and work as usual.${window}`,
        contact: LOCKDOWN_SUPPORT_EMAIL,
      }
    case 'uploads':
      return {
        title: 'Uploads are paused',
        body:
          custom ??
          `Media uploads are temporarily disabled while we address an issue. Your existing media and published sites are unaffected.${window}`,
        contact: LOCKDOWN_SUPPORT_EMAIL,
      }
    case 'checkout':
      return {
        title: 'Checkout is temporarily unavailable',
        body:
          custom ??
          `Checkout is temporarily unavailable — this is not a payment failure, and your account, subscription, and sites are unaffected. Please try again shortly.${window}`,
        contact: LOCKDOWN_SUPPORT_EMAIL,
      }
    case 'marketplace-installs':
      return {
        title: 'Marketplace installs are paused',
        body:
          custom ??
          `Installing from the marketplace is temporarily disabled. Everything already installed keeps working.${window}`,
        contact: LOCKDOWN_SUPPORT_EMAIL,
      }
    case 'ai-assist':
    default:
      return {
        title: 'AI assist is temporarily unavailable',
        body:
          custom ??
          `AI assist is temporarily unavailable. Your content is unaffected — please try again shortly.${window}`,
        contact: LOCKDOWN_SUPPORT_EMAIL,
      }
  }
}

/**
 * Which feature key, if any, gates a plugin-API dispatcher path (AGL-1510).
 * Lives here (pure, beside the enum) so the dispatcher's wiring is one call
 * and the mapping is unit-testable without a route harness.
 *
 * - `ai/assist` → `ai-assist` (gated even while the route 501s without an
 *   API key — the switch predates the key on purpose).
 * - `marketplace/install*` → `marketplace-installs`: installs-as-a-class,
 *   every artifact kind. `marketplace/update-artifact` is included — it
 *   re-copies a publisher's version into the org, which is an install by
 *   another name and the same vector a malicious listing would ride.
 * - `marketplace/checkout` → `checkout`: it creates NEW Stripe checkout
 *   sessions exactly like the billing route, and a mid-charge Stripe bug
 *   does not care which surface started the session.
 *
 * Publish/review/report paths map to nothing: a marketplace incident must
 * not stop publishers reporting or staff reviewing.
 */
export function lockdownFeatureForPluginApiPath(
  path: string,
): LockdownFeatureKey | null {
  if (path === 'ai/assist') return 'ai-assist'
  if (path === 'marketplace/checkout') return 'checkout'
  if (
    path === 'marketplace/install' ||
    path.startsWith('marketplace/install-') ||
    path === 'marketplace/update-artifact'
  ) {
    return 'marketplace-installs'
  }
  return null
}

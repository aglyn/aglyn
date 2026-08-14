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
 * The wire shape of the 423 refusal body (`lockdownJsonResponse`). Declared
 * here, beside the copy that fills it, so the client parser below and the
 * server writer agree by construction rather than by comment.
 */
export interface LockdownRefusalBody {
  error?: unknown
  scope?: unknown
  feature?: unknown
  reason?: unknown
  title?: unknown
  message?: unknown
  contact?: unknown
  untilMs?: unknown
}

/** A 423 body, parsed into something a client surface can render. */
export interface LockdownRefusalNotice {
  title: string
  message: string
  contact?: string
  scope?: LockdownScope
  feature?: LockdownFeatureKey
  untilMs?: number
  /**
   * The expiry as a human, LOCAL-time line — `undefined` when the lock has
   * no expiry, which is most of them. Never a raw epoch number.
   */
  until?: string
}

/**
 * The generic-but-honest fallback: what a client says when the server said
 * Locked but the body told it nothing else. It must still be TRUE — "this is
 * paused", never "something went wrong" (the failure this whole affordance
 * exists to stop), and never the word `undefined`.
 */
export const LOCKDOWN_REFUSAL_FALLBACK_TITLE = 'Temporarily unavailable'
export const LOCKDOWN_REFUSAL_FALLBACK_MESSAGE =
  'This is temporarily paused while we work on something. Nothing you have ' +
  'created is affected — please try again shortly.'

/**
 * The exact sentence the notice builders append to a DEFAULT body when a
 * lock has an expiry. Built here so the client parser can strip it by exact
 * match (same `untilMs`, same string) instead of sniffing a regex.
 */
function lockdownUntilSuffix(untilMs: number): string {
  return `Expected back by ${new Date(untilMs).toUTCString()}.`
}

/**
 * The expiry as a client-side, LOCAL-time line (AGL-1532). A UTC string is
 * correct and unreadable; a customer wants to know when to come back on
 * their own clock.
 */
export function formatLockdownUntil(untilMs: number): string | undefined {
  if (!Number.isFinite(untilMs)) return undefined
  const when = new Date(untilMs)
  if (Number.isNaN(when.getTime())) return undefined
  const stamp = when.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return `Expected back around ${stamp}.`
}

/**
 * Parse a fetch response's status + parsed JSON body into a renderable
 * lockdown notice, or `null` when this was not a lockdown refusal
 * (AGL-1532).
 *
 * ONE parser, used by every client call site a feature lock can refuse —
 * billing checkout, marketplace installs and purchases, the AI-assist
 * drawer. Three copies of this parsing is the second-implementation shape
 * that lets one surface drift back to "checkout failed" while the others
 * stay honest.
 *
 * Three rules, each of which a spec pins:
 *
 *  1. **Only 423.** A 500 — a real, unexplained failure — returns `null` so
 *     the caller keeps its generic error toast. Dressing a genuine fault as
 *     a deliberate pause is a worse lie than the one being fixed.
 *  2. **A 423 always yields a notice.** The server said Locked; that is the
 *     honest thing to render even if the body is malformed, truncated by a
 *     proxy, or from an older deploy. Missing fields degrade to the shared
 *     per-feature copy when the body names a known feature, and to the
 *     generic-but-honest fallback otherwise.
 *  3. **No duplicated expiry.** The default server copy already ends with a
 *     UTC "Expected back by …" sentence; that exact suffix is stripped and
 *     restated as `until` in the reader's local time. A staff-typed custom
 *     message never carries the suffix, so nothing is stripped from it.
 */
export function parseLockdownRefusal(
  status: number,
  body: unknown,
): LockdownRefusalNotice | null {
  if (status !== 423) return null
  const payload: LockdownRefusalBody =
    body && typeof body === 'object' ? (body as LockdownRefusalBody) : {}
  const feature = isLockdownFeatureKey(payload.feature)
    ? payload.feature
    : undefined
  const untilMs =
    typeof payload.untilMs === 'number' && Number.isFinite(payload.untilMs)
      ? payload.untilMs
      : undefined
  // A body that named a feature but lost its copy still gets the RIGHT
  // words — the same ones the server would have sent — because that copy
  // lives here too. Only a body naming nothing falls all the way back.
  const derived = feature
    ? featureLockdownNotice(feature, undefined, untilMs)
    : undefined
  const title =
    typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : (derived?.title ?? LOCKDOWN_REFUSAL_FALLBACK_TITLE)
  let message =
    typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : (derived?.body ?? LOCKDOWN_REFUSAL_FALLBACK_MESSAGE)
  if (typeof untilMs === 'number') {
    const suffix = lockdownUntilSuffix(untilMs)
    if (message.endsWith(suffix)) {
      message = message.slice(0, -suffix.length).trim()
    }
  }
  const contact =
    typeof payload.contact === 'string' && payload.contact.trim()
      ? payload.contact.trim()
      : undefined
  const until =
    typeof untilMs === 'number' ? formatLockdownUntil(untilMs) : undefined
  return {
    title,
    message,
    ...(contact ? { contact } : {}),
    ...(typeof payload.scope === 'string'
      ? { scope: payload.scope as LockdownScope }
      : {}),
    ...(feature ? { feature } : {}),
    ...(typeof untilMs === 'number' ? { untilMs } : {}),
    ...(until ? { until } : {}),
  }
}

/**
 * The notice as ONE line, for surfaces whose only affordance is a snackbar
 * (AGL-1532). The title is prefixed only when the message does not already
 * open with it — the checkout copy leads with its own title, and "Checkout
 * is temporarily unavailable — Checkout is temporarily unavailable — this is
 * not a payment failure" helps nobody.
 */
export function lockdownRefusalText(notice: LockdownRefusalNotice): string {
  const lower = notice.message.toLowerCase()
  const led = lower.startsWith(notice.title.toLowerCase())
  const head = led ? notice.message : `${notice.title} — ${notice.message}`
  return notice.until ? `${head} ${notice.until}` : head
}

/**
 * Which feature keys gate a plugin-API dispatcher path (AGL-1510, plural
 * since AGL-1545). Lives here (pure, beside the enum) so the dispatcher's
 * wiring is one call and the mapping is unit-testable without a route
 * harness.
 *
 * - `ai/assist` → `ai-assist` (gated even while the route 501s without an
 *   API key — the switch predates the key on purpose).
 * - `marketplace/install*` → `marketplace-installs`: installs-as-a-class,
 *   every artifact kind. `marketplace/update-artifact` is included — it
 *   re-copies a publisher's version into the org, which is an install by
 *   another name and the same vector a malicious listing would ride.
 * - `marketplace/checkout` → BOTH `checkout` and `marketplace-installs`
 *   (AGL-1545): it creates NEW Stripe checkout sessions exactly like the
 *   billing route, and it is also the front door of a paid install — a
 *   malicious-listing incident must stop buyers PAYING for the artifact
 *   under investigation, not merely refuse the install after the money
 *   moved. Each key keeps its own staff-bypass rule when composed.
 *
 * Publish/review/report paths map to nothing: a marketplace incident must
 * not stop publishers reporting or staff reviewing.
 */
export function lockdownFeaturesForPluginApiPath(
  path: string,
): LockdownFeatureKey[] {
  if (path === 'ai/assist') return ['ai-assist']
  if (path === 'marketplace/checkout') {
    return ['checkout', 'marketplace-installs']
  }
  if (
    path === 'marketplace/install' ||
    path.startsWith('marketplace/install-') ||
    path === 'marketplace/update-artifact'
  ) {
    return ['marketplace-installs']
  }
  return []
}

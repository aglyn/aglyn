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

export type LockdownScope = 'platform' | 'org' | 'host' | 'user'

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

export interface LockdownDoc {
  scope: LockdownScope
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
  return {
    scope,
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

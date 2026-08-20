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
 * THE PLATFORM SEND-RATE GOVERNOR — policy half (AGL-2409).
 *
 * Everything Aglyn sends leaves on ONE Resend key, from ONE verified sending
 * domain, under `p=reject`. A throttle or a reputation hit there is not a spam
 * folder: it is a rejection, and it lands on every customer's password resets
 * and receipts at the same time. Before this there was no per-hour or per-day
 * throttle, no batching and no concurrency limiter anywhere in the email path
 * — so the two bursts the product can already produce (the monthly usage
 * summary fanning out to 1,000 orgs in one invocation, and scheduled campaigns
 * at a ceiling of 10 × 500 × 4 = 20,000 messages an hour) had nothing to ramp
 * against, and the day a ramp was needed there would have been nothing to
 * turn.
 *
 * ## Why the policy is pure and dependency-free
 *
 * Same split as `plugin-api-rate-limit.ts` and `api-http.ts`: the decision is
 * a pure function of (priority, ceiling, used, count) and is unit-testable
 * without a Firestore harness or a route. The durable counter lives in
 * `@aglyn/tenant-data-admin` (`email-send-rate.ts`), which is the only layer
 * that may hold the Admin SDK — `@aglyn/shared-util-email` is `scope:shared`
 * and may not import it, and the existing edge already runs the other way
 * (`tenant-data-admin` imports THIS library). So the governor reaches
 * `sendEmail` by injection, {@link setEmailSendGovernor}, rather than by an
 * import that would be a dependency cycle.
 *
 * ## THE BOUNDARY THAT MATTERS MOST
 *
 * **A rate control may only ever refuse a CAMPAIGN or a BULK sweep. It may
 * never refuse a transactional message.** A password reset or an order
 * receipt refused by a throttle is a strictly worse outcome than the burst
 * being throttled: it converts a reputation risk into an outage on somebody
 * else's business, and the mail explaining why is itself mail that will not
 * send. That is the same rule `email-metering.ts` states for the monthly
 * quota, applied to time distribution instead of monthly totals.
 *
 * The rule is enforced in two independent places on purpose — here, in
 * {@link emailSendRateVerdict}, which cannot return `allowed: false` for a
 * transactional send at all; and again in `sendEmail`, which ignores a
 * refusal for a transactional priority whatever the installed governor says.
 * A governor is injectable, so a wrong one is reachable; the send path must
 * still be unable to drop a password reset.
 */

/** The three send priorities, ordered by what a control may do to them. */
export type EmailSendPriority =
  /**
   * Answers something a human just did, or a machine event a customer's
   * business depends on: password reset, invite, order confirmation, booking
   * reminder, workflow notification, membership recovery. **Never refused,
   * never delayed.** Counted, because the ceiling is about total domain
   * volume and this volume is real.
   */
  | 'transactional'
  /**
   * A scheduled fan-out that answers no immediate human action: the monthly
   * usage summary, abandoned-cart and restock sweeps, booking reminder
   * batches. Refusable, because the caller is a resumable cron — a refusal
   * means "not this hour", and the next run picks the subject up. A caller
   * that is NOT resumable must not use this priority.
   */
  | 'bulk'
  /**
   * Merchant marketing. Refusable outright, with a message the merchant
   * sees. The one discretionary class, exactly as in `email-metering.ts`.
   */
  | 'campaign'

/** Fixed one-hour window, matching the unit the issue and the ramp speak in. */
export const EMAIL_SEND_RATE_WINDOW_MS = 3_600_000

/**
 * The default ceiling, in messages per hour, when nothing has been
 * configured.
 *
 * **This number is a default, not the policy.** The whole point of AGL-2409
 * is that a ramp must be a value change and not a deploy, so the live ceiling
 * is read from `rateLimits/sendRateConfig` and set from the staff console.
 * This is only what an unconfigured deployment (a fork, a self-host, a
 * preview) gets.
 *
 * 2,000/hour is chosen against measured shape rather than taste. Steady-state
 * volume on the domain is a few hundred a day, so this is roughly two orders
 * of magnitude of headroom over normal traffic — it cannot trip on real use,
 * which is the property that keeps a limit from being raised until it means
 * nothing. What it does remove is the two bursts named in the issue: 20,000
 * campaign messages an hour becomes 2,000, and a 1,000-org usage fan-out in
 * one invocation becomes a fan-out that has to ask.
 */
export const EMAIL_SEND_RATE_DEFAULT_PER_HOUR = 2_000

/**
 * Hard bound on a configured ceiling. Not a business rule — a typo guard, so
 * a slipped digit in the console cannot set a ceiling that is effectively no
 * ceiling. Raising it past this is a deploy, which is the correct friction
 * for a change of that size.
 */
export const EMAIL_SEND_RATE_MAX_PER_HOUR = 100_000

/** A configured ceiling of 0 would refuse every campaign; 1 is the floor. */
export const EMAIL_SEND_RATE_MIN_PER_HOUR = 1

/** The live ceiling, as stored and as the console edits it. */
export interface EmailSendRateConfig {
  /** Messages per hour across the whole platform. */
  perHour: number
  /**
   * False parks the governor: every priority is granted and still counted,
   * so the console keeps showing real volume. The off switch exists because
   * an operator who suspects the governor is refusing legitimate mail must be
   * able to stop it in one click rather than by raising a number they then
   * have to remember to lower.
   */
  enabled: boolean
  /** When staff last changed it, ms. Null when never configured. */
  updatedAtMs: number | null
  /** Who changed it; shown beside the value so a ramp has an author. */
  updatedByEmail: string | null
  /** Why — the ramp step, the incident. Free text, bounded. */
  note: string
}

/** Bound on the stored note, so a config read stays a small document. */
export const EMAIL_SEND_RATE_NOTE_MAX = 500

/**
 * Reads a stored config document into a usable shape.
 *
 * Every field is clamped rather than trusted. This document decides whether a
 * campaign goes out, and a `perHour` of `NaN` (or `-1`, or a string) reaching
 * the comparison would silently refuse everything refusable on the platform —
 * an outage produced by a bad write. An unreadable value falls back to the
 * default ceiling, never to zero and never to unlimited.
 */
export function normalizeEmailSendRateConfig(
  raw: Partial<EmailSendRateConfig> | null | undefined,
): EmailSendRateConfig {
  const rawPerHour = Number(raw?.perHour)
  const perHour = Number.isFinite(rawPerHour)
    ? Math.min(
        EMAIL_SEND_RATE_MAX_PER_HOUR,
        Math.max(EMAIL_SEND_RATE_MIN_PER_HOUR, Math.floor(rawPerHour)),
      )
    : EMAIL_SEND_RATE_DEFAULT_PER_HOUR
  const updatedAtMs = Number(raw?.updatedAtMs)
  return {
    perHour,
    // Absent means ON. A governor that a missing field turns off is not a
    // governor; the operator must have written `false` for it to be off.
    enabled: raw?.enabled !== false,
    updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : null,
    updatedByEmail: raw?.updatedByEmail ? String(raw.updatedByEmail) : null,
    note: String(raw?.note ?? '').slice(0, EMAIL_SEND_RATE_NOTE_MAX),
  }
}

/**
 * Contexts that are campaign sends, derived rather than threaded.
 *
 * The same move `contextTag` makes one file over, and for the same reason: a
 * `priority` argument added to 37 call sites is 37 places to remember and one
 * place that does not. `campaign-send.ts` already passes `context:
 * 'campaign'`, and that is already the value `email-metering.ts` keys its
 * enforceable meter on, so nothing new has to be remembered for the one class
 * that must be refusable.
 *
 * ### Polarity
 *
 * Note which way an omission fails. This set enumerates what is REFUSABLE, so
 * a sender that is not listed and does not pass `priority` explicitly is
 * treated as transactional and is never refused — the status quo before this
 * change, not a regression. The opposite polarity (enumerate what is
 * protected) would make a forgotten entry a dropped password reset, which is
 * the failure you find from a support ticket.
 */
const CAMPAIGN_CONTEXTS: ReadonlySet<string> = new Set(['campaign'])

/**
 * The priority for a send. An explicit `priority` always wins; otherwise a
 * campaign context is recognised, and everything else is transactional.
 */
export function resolveSendPriority(
  context: string | undefined,
  explicit?: EmailSendPriority,
): EmailSendPriority {
  if (explicit === 'campaign' || explicit === 'bulk') return explicit
  if (explicit === 'transactional') return 'transactional'
  return CAMPAIGN_CONTEXTS.has(String(context ?? '').trim())
    ? 'campaign'
    : 'transactional'
}

/** True when a control is permitted to refuse this priority at all. */
export function isRefusablePriority(priority: EmailSendPriority): boolean {
  return priority === 'campaign' || priority === 'bulk'
}

/** Start of the fixed window containing `nowMs`. */
export function emailSendRateWindowStartMs(
  nowMs: number,
  windowMs: number = EMAIL_SEND_RATE_WINDOW_MS,
): number {
  return Math.floor(nowMs / windowMs) * windowMs
}

export interface EmailSendRateInput {
  priority: EmailSendPriority
  /** Messages already counted in this window. */
  used: number
  /** Messages this send would add. */
  count: number
  /** The live ceiling for the window. */
  ceiling: number
  /** False parks the governor — grant everything, still count it. */
  enabled?: boolean
  /** Start of the window, for `retryAtMs`. */
  windowStartMs: number
  windowMs?: number
}

export interface EmailSendRateVerdict {
  allowed: boolean
  priority: EmailSendPriority
  ceiling: number
  /** Count in the window BEFORE this send. */
  used: number
  /** Headroom left after this send, floored at 0. */
  remaining: number
  /** When the window rolls and a refused caller may try again. */
  retryAtMs: number
  /**
   * True when the send was granted despite there being no headroom, because
   * refusing it was not permitted. This is how the console shows that a
   * window went over its ceiling on transactional volume — which is not an
   * error, it is the ceiling declining to enforce, exactly like the monthly
   * overage `emailSendsOverage` records.
   */
  overCeiling: boolean
}

/**
 * The decision. Pure.
 *
 * A transactional send is ALWAYS `allowed`, whatever the numbers say — there
 * is no branch in this function that can refuse one. That is deliberate and
 * is the first of the two enforcement points described at the top of this
 * file.
 */
export function emailSendRateVerdict(
  input: EmailSendRateInput,
): EmailSendRateVerdict {
  const windowMs = input.windowMs ?? EMAIL_SEND_RATE_WINDOW_MS
  const retryAtMs = input.windowStartMs + windowMs
  // A corrupt or negative counter must not read as headroom a cap honours,
  // the same clamp `campaignEmailSendsForMonth` applies.
  const usedRaw = Number(input.used)
  const used = Number.isFinite(usedRaw) && usedRaw > 0 ? Math.floor(usedRaw) : 0
  const countRaw = Number(input.count)
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 0
  const ceilingRaw = Number(input.ceiling)
  const ceiling = Number.isFinite(ceilingRaw) && ceilingRaw > 0
    ? Math.floor(ceilingRaw)
    : EMAIL_SEND_RATE_DEFAULT_PER_HOUR
  const enabled = input.enabled !== false

  const wouldExceed = used + count > ceiling
  // Transactional mail is never refused, and neither is anything at all while
  // the governor is parked. Both still count.
  const allowed = !wouldExceed || !enabled || !isRefusablePriority(input.priority)
  return {
    allowed,
    priority: input.priority,
    ceiling,
    used,
    remaining: Math.max(0, ceiling - (used + (allowed ? count : 0))),
    retryAtMs,
    overCeiling: allowed && wouldExceed,
  }
}

/** What `sendEmail` asks the installed governor. */
export interface EmailSendGovernorRequest {
  priority: EmailSendPriority
  /** Recipient addresses on this one send. */
  count: number
  context?: string
}

/** What the governor answers. A subset of the verdict `sendEmail` needs. */
export interface EmailSendGovernorVerdict {
  allowed: boolean
  ceiling?: number
  used?: number
  remaining?: number
  retryAtMs?: number
  /** True when the durable counter was unreachable and this failed open. */
  degraded?: boolean
}

export type EmailSendGovernor = (
  request: EmailSendGovernorRequest,
) => Promise<EmailSendGovernorVerdict>

/**
 * The installed governor, or null.
 *
 * Module-scoped and null by default, so `sendEmail` in a unit test, a preview
 * build or a self-host deployment that never installs one behaves exactly as
 * it did before this change. Null is UNGOVERNED, not refused: a send path
 * that cannot reach the counter must still send.
 */
let installedGovernor: EmailSendGovernor | null = null

/** Installs the durable governor. Called once, from `@aglyn/tenant-data-admin`. */
export function setEmailSendGovernor(governor: EmailSendGovernor | null): void {
  installedGovernor = governor
}

/** The installed governor, or null when nothing has been installed. */
export function getEmailSendGovernor(): EmailSendGovernor | null {
  return installedGovernor
}

/** Test seam: forget any installed governor. */
export function resetEmailSendGovernorForTests(): void {
  installedGovernor = null
}

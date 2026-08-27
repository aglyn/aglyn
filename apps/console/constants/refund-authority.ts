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
 * HOW MUCH a staff member may refund, and on whose authority (AGL-2486).
 *
 * The refund card shipped `super`-only to issue. the call is that support
 * may refund up to a cap and escalate above it, and his reasoning is
 * operational rather than theoretical: nine days from launch the person a
 * customer actually reaches is support, and making them escalate a $12 refund
 * means the customer waits on one person's availability. A control that turns
 * every routine refund into a queue is a control people route around.
 *
 * He also declined a second-approver requirement. THE CAP IS THEREFORE THE
 * WHOLE CONTROL, which is why there are two of them.
 *
 * ## Why a per-refund cap alone is not enough
 *
 * A per-refund cap bounds a MISTAKE well: $1,200 typed where $12 was meant is
 * refused, which is the failure that actually happens. It does not bound
 * REPETITION. A $600 annual charge refunded as four $150 partials passes a
 * per-refund cap four times and lands exactly where the cap existed to stop
 * it — the escalation is evaded by splitting, on precisely the case it was
 * written for. That is the shape of AGL-1544's create-time quota, whose
 * lesson was that the fix is WHEN a limit is evaluated, not how one refund is
 * counted.
 *
 * So the per-refund cap is joined by a rolling 24-hour per-ACTOR ceiling.
 * Together they say: routine refunds need nobody, an unusually large one
 * needs `super`, and an unusual VOLUME of ordinary ones needs `super` too.
 *
 * ## Why these numbers
 *
 * `PLAN_PRICING` bases are $0 / $25 / $56 / $139 / $249 / $399 / $799 a
 * month. A $150 per-refund cap covers a full month on every self-serve tier a
 * customer can sign up to today — including $139 with headroom for tax and
 * proration — and stops at the two things worth a second pair of eyes: an
 * ANNUAL term (billed ×12, so $300 at the cheapest paid tier) and the large
 * accounts. That seam is the point. "One month of a mainstream plan" is the
 * refund support should just issue; "a year up front" and "a $799 account"
 * are decisions, not transactions.
 *
 * $500 a day is roughly three of those and change. It is far above any
 * plausible day of support volume for a platform nine days old, and it bounds
 * what a mistaken script or a compromised support session can give away to a
 * number Aglyn can absorb rather than an unbounded one. It is meant to be
 * raised as volume grows; it is not meant to be the thing anyone hits.
 *
 * ## Roles
 *
 * `super` is uncapped. EVERY other staff role — `support`, `billing`, and
 * anything a future migration adds — is capped, because this file fails
 * closed to the least privilege the way every staff route has since AGL-495.
 * `billing` is capped alongside `support` deliberately: it is the more
 * money-trusted of the two and already holds plan and quota overrides, but
 * the decision named one ceiling, and quietly giving a second role a
 * different one is not a decision anybody made.
 */

/** The most one refund may return without the `super` role. */
export const STAFF_REFUND_CAP_CENTS = 15_000

/** The most one capped actor may return across {@link STAFF_REFUND_WINDOW_MS}. */
export const STAFF_REFUND_DAILY_CAP_CENTS = 50_000

/**
 * The daily ceiling's window. ROLLING, not a calendar day: a fixed UTC
 * boundary lets an actor spend the whole ceiling at 23:59 and the whole
 * ceiling again at 00:01, which is the standard fixed-window doubling and is
 * a strange thing to accept in the one place the cap IS the control.
 */
export const STAFF_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * How many refunds one capped actor may issue inside the window, whatever
 * they sum to.
 *
 * It exists because the rolling window is implemented as a pruned list of
 * entries and an unbounded list is a document that grows without limit — a
 * $0.01 refund is legal, so the amount ceiling alone does not bound the
 * count. Denying at the limit is also the right answer on its own terms:
 * sixty refunds from one support account inside a day is not a support day,
 * and stopping is better than recording it.
 */
export const STAFF_REFUND_WINDOW_MAX_ENTRIES = 60

/** Which authority a settled refund was issued under. Recorded on the audit row. */
export type RefundAuthority = 'super' | 'capped'

/** Roles that may refund any amount. Everything else is capped. */
const UNCAPPED_ROLES: ReadonlySet<string> = new Set(['super'])

/**
 * The authority a role carries.
 *
 * Deliberately total over `string` rather than over a role union: a token
 * carrying a role this build has never heard of must resolve to the capped
 * side, not fall through a `switch` with no default.
 */
export function refundAuthorityForRole(role: unknown): RefundAuthority {
  return UNCAPPED_ROLES.has(String(role ?? '')) ? 'super' : 'capped'
}

/** The per-refund ceiling for a role, or `null` when the role has none. */
export function refundCapCentsForRole(role: unknown): number | null {
  return refundAuthorityForRole(role) === 'super' ? null : STAFF_REFUND_CAP_CENTS
}

/** The rolling-window ceiling for a role, or `null` when the role has none. */
export function refundWindowCapCentsForRole(role: unknown): number | null {
  return refundAuthorityForRole(role) === 'super'
    ? null
    : STAFF_REFUND_DAILY_CAP_CENTS
}

/** `$1,234.56` — the one money formatter both the cap copy and its errors use. */
export function formatRefundCap(cents: number): string {
  return `$${(Math.round(Number(cents) || 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export interface RefundAuthorityVerdict {
  allowed: boolean
  authority: RefundAuthority
  /** True when this amount is one only `super` could have issued. */
  overCap: boolean
  /** Machine-readable refusal, or null when allowed. */
  code: 'over-per-refund' | 'over-window' | 'too-many' | null
  /** Operator-facing refusal, or null when allowed. */
  error: string | null
}

export interface RefundAuthorityInput {
  role: unknown
  /** Integer cents this attempt would refund. `0` is not an absence here. */
  amountCents: number
  /** What this actor has already refunded inside the rolling window. */
  windowCents?: number
  /** How many refunds this actor has already issued inside the window. */
  windowCount?: number
}

/**
 * The ONE predicate behind the server's refusal, the button's disabled state
 * and the sentence the card shows before an amount is typed.
 *
 * Shared for `normalizeRefundReason`'s reason: the money moves on the server,
 * so the server's copy is the control — but a console whose disabled state
 * disagrees with it teaches operators that the button is unreliable rather
 * than that the amount is. One function, one threshold, and a disagreement
 * between the two surfaces becomes impossible rather than unlikely.
 *
 * `amountCents` is compared explicitly rather than by falsiness. `0` is a
 * real number in money code and `strictNullChecks` is off repo-wide, so
 * `if (!amountCents)` would read a zero refund as an absent one.
 */
export function checkRefundAuthority({
  role,
  amountCents,
  windowCents = 0,
  windowCount = 0,
}: RefundAuthorityInput): RefundAuthorityVerdict {
  const authority = refundAuthorityForRole(role)
  const asked = Math.round(Number(amountCents))
  const overCap = Number.isFinite(asked) && asked > STAFF_REFUND_CAP_CENTS

  if (authority === 'super') {
    // Uncapped, but the verdict still reports `overCap` — the audit row uses
    // it to tell a refund only `super` could have issued from the routine one
    // a `super` happened to issue, and those are different facts about a row.
    return { allowed: true, authority, overCap, code: null, error: null }
  }

  if (!Number.isFinite(asked)) {
    return {
      allowed: false,
      authority,
      overCap: false,
      code: 'over-per-refund',
      error: 'Refund amount must be a number.',
    }
  }

  if (overCap) {
    return {
      allowed: false,
      authority,
      overCap,
      code: 'over-per-refund',
      error:
        `Your staff role can refund up to ${formatRefundCap(
          STAFF_REFUND_CAP_CENTS,
        )} per refund. ` +
        `${formatRefundCap(asked)} needs the super staff role — ask someone ` +
        'who holds it rather than splitting it into smaller refunds, which ' +
        'the daily ceiling refuses anyway.',
    }
  }

  const priorCount = Math.max(0, Math.round(Number(windowCount) || 0))
  if (priorCount >= STAFF_REFUND_WINDOW_MAX_ENTRIES) {
    return {
      allowed: false,
      authority,
      overCap,
      code: 'too-many',
      error:
        `You have issued ${STAFF_REFUND_WINDOW_MAX_ENTRIES} refunds in the ` +
        'last 24 hours, which is the ceiling for your role whatever they ' +
        'sum to. Anything further needs the super staff role.',
    }
  }

  const prior = Math.max(0, Math.round(Number(windowCents) || 0))
  const remaining = Math.max(0, STAFF_REFUND_DAILY_CAP_CENTS - prior)
  if (asked > remaining) {
    return {
      allowed: false,
      authority,
      overCap,
      code: 'over-window',
      error:
        `Your staff role can refund ${formatRefundCap(
          STAFF_REFUND_DAILY_CAP_CENTS,
        )} in a rolling 24 hours, and ${formatRefundCap(prior)} of that is ` +
        `already used — ${formatRefundCap(remaining)} is left. ` +
        `${formatRefundCap(asked)} needs the super staff role.`,
    }
  }

  return { allowed: true, authority, overCap, code: null, error: null }
}

/**
 * The sentence the card shows BEFORE an operator picks a charge.
 *
 * The point of the card stating this up front is that a support engineer
 * should never fill in a form and then be refused. `windowCents` is the
 * actor's live usage when the route has reported it, so the number shrinks as
 * the day is spent rather than restating a constant.
 */
export function describeRefundAllowance(
  role: unknown,
  windowCents?: number,
): string {
  if (refundAuthorityForRole(role) === 'super') {
    return (
      'Your super staff role can refund any amount. Refunds above ' +
      `${formatRefundCap(STAFF_REFUND_CAP_CENTS)} are recorded as having ` +
      'used that authority.'
    )
  }
  const prior = Math.max(0, Math.round(Number(windowCents) || 0))
  const remaining = Math.max(0, STAFF_REFUND_DAILY_CAP_CENTS - prior)
  return (
    `Your staff role can refund up to ${formatRefundCap(
      STAFF_REFUND_CAP_CENTS,
    )} per refund, and ${formatRefundCap(
      STAFF_REFUND_DAILY_CAP_CENTS,
    )} in a rolling 24 hours — ${formatRefundCap(remaining)} of that is left. ` +
    'Anything larger needs the super staff role.'
  )
}

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

import { consumeRateLimit } from './rate-limit-store'

/**
 * Throttle for admin-initiated password reset mail (AGL-920).
 *
 * Every caller of this is already authenticated as staff, an org admin, or a
 * site admin, so this is **not** the enumeration defense that guards the
 * public `membership/recover` endpoint — nobody reaches here without already
 * knowing the account exists. It guards two narrower things:
 *
 * 1. **The recipient's mailbox.** An admin can click "send reset" as often as
 *    they like, and every click is a real email to someone who may not have
 *    asked for any of them. This is the limit that matters, and it is keyed on
 *    the recipient so several admins cannot converge on one person.
 * 2. **The send budget.** Each click also spends a Resend send.
 *
 * Shared across all three surfaces (staff users, org team, site members)
 * because it lives one layer below all of them — the commerce plugin cannot
 * import the console's API helpers, and duplicating the numbers would let them
 * drift.
 *
 * Backed by the durable limiter rather than a per-instance `Map`: the in-memory
 * kind resets on every cold start and each instance keeps its own, which on
 * Vercel is close to no limit at all (AGL-794).
 */

/**
 * Per recipient, per hour. Deliberately small — a reset link is valid for an
 * hour anyway, so a second and third are only useful if the first was lost.
 */
export const RESET_SENDS_PER_RECIPIENT = 3

/**
 * Per admin, per hour, across every recipient. Sized so genuine support work
 * (a morning of onboarding calls) never touches it, while a script driving the
 * endpoint does.
 */
export const RESET_SENDS_PER_ACTOR = 20

const WINDOW_MS = 60 * 60 * 1000

export interface PasswordResetThrottleResult {
  allowed: boolean
  /** Seconds until the exhausted window rolls over; 0 when allowed. */
  retryAfterSeconds: number
  /** Which cap was hit, for the message shown to the admin. */
  limited: 'recipient' | 'actor' | null
  /** True when the durable store was unreachable and only a local cap applied. */
  degraded: boolean
}

export interface PasswordResetThrottleOptions {
  /** Stable id of the admin performing the send — a uid. */
  actorKey: string
  /**
   * Stable id of the account receiving the mail. Use the email address where
   * one identity can span records, so the cap follows the mailbox rather than
   * the row.
   */
  recipientKey: string
  now?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: unknown
}

/**
 * Counts one reset send against both caps.
 *
 * The recipient cap is checked first and short-circuits, so a send that was
 * going to be refused anyway does not also spend the admin's budget — one
 * over-eager admin hammering one member must not lock them out of helping
 * everybody else.
 */
export async function consumePasswordResetSend(
  options: PasswordResetThrottleOptions,
): Promise<PasswordResetThrottleResult> {
  const { actorKey, recipientKey, now, firestore } = options
  const shared = {
    windowMs: WINDOW_MS,
    ...(now === undefined ? {} : { now }),
    ...(firestore === undefined ? {} : { firestore }),
  }
  const at = now ?? Date.now()

  const recipient = await consumeRateLimit(`pwreset:to:${recipientKey}`, {
    ...shared,
    limit: RESET_SENDS_PER_RECIPIENT,
  })
  if (!recipient.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((recipient.resetMs - at) / 1000),
      ),
      limited: 'recipient',
      degraded: recipient.degraded,
    }
  }

  const actor = await consumeRateLimit(`pwreset:by:${actorKey}`, {
    ...shared,
    limit: RESET_SENDS_PER_ACTOR,
  })
  if (!actor.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((actor.resetMs - at) / 1000)),
      limited: 'actor',
      degraded: actor.degraded,
    }
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    limited: null,
    degraded: recipient.degraded || actor.degraded,
  }
}

/** Message for the admin who hit a cap — says which one and for how long. */
export function passwordResetThrottleMessage(
  result: PasswordResetThrottleResult,
): string {
  const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60))
  return result.limited === 'actor'
    ? `You have sent too many password resets — try again in ${minutes} minute(s).`
    : 'That account has already been sent several reset emails — try again ' +
        `in ${minutes} minute(s), or set a password directly.`
}

export default consumePasswordResetSend

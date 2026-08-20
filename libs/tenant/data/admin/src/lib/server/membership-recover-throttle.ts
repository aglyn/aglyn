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
 * Throttle for the UNAUTHENTICATED site-member password-recovery endpoint
 * (AGL-1966).
 *
 * ## The shape being closed
 *
 * Two unauthenticated tenant plugin endpoints compose into a mail relay on
 * `aglyn.com`'s sending domain: `membership/register` puts an arbitrary
 * address into `hosts/{hostId}/siteMembers` (member accounts are unlimited on
 * every plan, AGL-889, so nothing there refuses), and `membership/recover`
 * mails a reset link to any address that has such a row. Register N addresses,
 * call recover N times, and every one is a real message we sent, carrying an
 * attacker-chosen site name in the subject.
 *
 * The only thing in the way was the dispatcher's `visitorWriteRateLimitRefusal`
 * — 120 writes/60s per (site, IP), a bucket register and recover SHARE. That
 * ceiling is sized for a shopper editing cart quantities; measured as mail it
 * is ~86k messages a day from one address.
 *
 * The damage is not the Resend bill. It is the sending reputation of
 * `aglyn.com`, which is shared by every customer's transactional mail, and
 * which cannot be bought back after the fact.
 *
 * ## Why this is a separate module from `password-reset-throttle.ts`
 *
 * That one guards ADMIN-initiated resets, and says so at length: every caller
 * is already authenticated as staff, an org admin or a site admin, "so this is
 * **not** the enumeration defense that guards the public `membership/recover`
 * endpoint — nobody reaches here without already knowing the account exists."
 * This is that defense. The caps differ (there is no actor to key on here, and
 * an IP is not an actor), and the refusal contract differs — see below, it is
 * the part that is easy to get wrong.
 *
 * It lives at this layer, beside its sibling, for the reason that one gives:
 * the commerce plugin cannot import the console's API helpers, and a number
 * duplicated in two places drifts.
 *
 * ## Two kinds of cap, because they have two different refusals
 *
 * This is the load-bearing distinction in the module, and it exists entirely
 * to keep the endpoint from becoming an existence oracle.
 *
 * **Attempt caps** ({@link consumeMembershipRecoverAttempt}) — per recipient
 * and per IP. Consumed BEFORE the member lookup, so a request for an address
 * that is a member and a request for one that is not spend exactly the same
 * budget and get exactly the same answer. Their refusal may therefore be a
 * visible `429`: it says nothing about whether the address exists, because the
 * counter that produced it counts both alike. Consuming these *after* the
 * lookup, or only on the send path, would be the bug — the 429 would then
 * appear only for real members and the endpoint's whole silent-success
 * contract would be undone by its own rate limiter.
 *
 * **The send cap** ({@link consumeMembershipRecoverSend}) — per host, per day.
 * Consumed only when a message is actually about to go out, because it is a
 * ceiling on OUTBOUND MAIL rather than on requests. That means it is only ever
 * reached on the member-exists branch, so its refusal must NOT be visible: the
 * caller takes the same silent `200 {ok:true}` exit as an unknown address. The
 * cost of that is a real member who gets no mail and no error during an
 * attack on their site — collateral that is accepted deliberately, and sized
 * for below.
 *
 * ## Backed by the durable limiter, not a `Map`
 *
 * `membership-recover.ts` previously carried a per-instance `Map` keyed on
 * IP+email. On Vercel that is close to no limit at all — it resets on every
 * cold start and each concurrent instance keeps its own, so the effective cap
 * is `limit × instances` and an attacker widens it by going wider (AGL-794).
 * A mail send is exactly the "consequence, not volume" case that
 * `RATE_LIMITING.md` says to spend a Firestore transaction on.
 *
 * ### Contention fails CLOSED here, and that is correct (AGL-2404)
 *
 * `consumeRateLimit` refuses with `contended: true` when one key is hot, and
 * only degrades when the store itself is unreachable. Both postures land well
 * on this surface. The attempt keys are per recipient and per IP, so a
 * legitimate visitor essentially never races themselves — concurrency on one
 * of these keys is the attack. And the send key is per host per day, which is
 * one document: a busy site's genuine recover traffic is a handful of requests
 * an hour, so contention there is likewise a flood rather than a Tuesday.
 */

/**
 * Reset mails per recipient address, per hour, across every site.
 *
 * Matches `RESET_SENDS_PER_RECIPIENT` deliberately: a reset link is valid for
 * an hour anyway, so a second and third are only useful if the first was lost,
 * and one number for "how many resets may one mailbox receive in an hour" is
 * easier to defend than two.
 *
 * NOT keyed by host. A per-(host, address) cap would let an attacker who
 * controls several sites — which a free org can create — multiply one
 * mailbox's mail by the number of sites, and the person being carpet-bombed
 * does not care which of our customers' sites the mail claims to come from.
 */
export const RECOVER_SENDS_PER_RECIPIENT = 3

/**
 * Recovery attempts per client IP, per hour, across every site and address.
 *
 * Sized against the human behaviour, not the attack: a person who has
 * forgotten a password tries it on one or two sites, mistypes the address
 * once, and stops. Ten is already several times that. A household or office
 * NAT sharing one address would need ten genuine forgotten passwords in one
 * hour to notice this.
 *
 * This is the cap that actually prices enumeration. The per-recipient cap
 * alone does nothing against the register-then-recover composition, because
 * every address in that attack is fresh and none of them has a count.
 */
export const RECOVER_ATTEMPTS_PER_IP = 10

/** Both attempt caps use a one-hour fixed window, like their sibling. */
export const RECOVER_ATTEMPT_WINDOW_MS = 60 * 60 * 1000

/**
 * Recovery mails one SITE may emit per day.
 *
 * An abuse ceiling, not a usage limit, and it is set where it is because of
 * the collateral described above: it must sit far enough above any real site's
 * genuine volume that reaching it is evidence of an attack. A storefront with
 * ten thousand members sees single-digit resets a day; two hundred is more
 * than an order of magnitude of headroom.
 *
 * What it buys, given the dispatcher's 120/min already upstream: it converts
 * "~86k messages a day per site from one IP" into 200, and — because it is
 * keyed on the site rather than on the caller — it holds no matter how many
 * IPs the caller brings. That is the property the compound visitor-write key
 * explicitly cannot have, and the reason this cap is per host alone.
 */
export const RECOVER_SENDS_PER_HOST_PER_DAY = 200

/** Fixed 24h window for the send cap. */
export const RECOVER_SEND_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * How new a member row may be and still be worth a reset mail.
 *
 * The register-then-recover composition is the whole attack, and no real
 * person needs a password reset in the first ten minutes of having chosen the
 * password. This is the cheapest control on the list and the only one that
 * refuses the composition itself rather than rationing it.
 *
 * Enforced by the handler (it needs the member document); the constant lives
 * here so the policy is in one place.
 */
export const RECOVER_MIN_MEMBER_AGE_MS = 10 * 60 * 1000

export interface MembershipRecoverThrottleResult {
  allowed: boolean
  /** Seconds until the exhausted window rolls over; 0 when allowed. */
  retryAfterSeconds: number
  /** Which cap refused, for logs. Never told to the caller. */
  limited: 'recipient' | 'ip' | 'host' | null
  /** True when the durable store was unreachable and only a local cap applied. */
  degraded: boolean
  /** True when the key was contended and the request was refused on that basis. */
  contended: boolean
}

export interface MembershipRecoverAttemptOptions {
  /** The address the recovery was requested for, normalized by the caller. */
  email: string
  /** Client IP, first `x-forwarded-for` hop. `'unknown'` when absent. */
  ip: string
  now?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: unknown
}

function refusal(
  limited: 'recipient' | 'ip' | 'host',
  resetMs: number,
  at: number,
  rate: { degraded: boolean; contended: boolean },
): MembershipRecoverThrottleResult {
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((resetMs - at) / 1000)),
    limited,
    degraded: rate.degraded,
    contended: rate.contended,
  }
}

/**
 * Counts one recovery ATTEMPT against the per-recipient and per-IP caps.
 *
 * Call before deciding whether the address is a member — see the module note
 * on why the ordering is the control and not an implementation detail.
 *
 * The recipient cap is checked first and short-circuits, matching
 * `consumePasswordResetSend`: one address being hammered must not also spend
 * the IP budget that a person sharing that NAT is relying on.
 *
 * The email is passed through to the key in the clear on purpose —
 * `consumeRateLimit` hashes every key into the document id precisely so that
 * caller-held identifiers do not sit in plaintext ids or index exports.
 */
export async function consumeMembershipRecoverAttempt(
  options: MembershipRecoverAttemptOptions,
): Promise<MembershipRecoverThrottleResult> {
  const { email, ip, now, firestore } = options
  const shared = {
    windowMs: RECOVER_ATTEMPT_WINDOW_MS,
    ...(now === undefined ? {} : { now }),
    ...(firestore === undefined ? {} : { firestore }),
  }
  const at = now ?? Date.now()

  const recipient = await consumeRateLimit(`recover:to:${email}`, {
    ...shared,
    limit: RECOVER_SENDS_PER_RECIPIENT,
  })
  if (!recipient.allowed) {
    return refusal('recipient', recipient.resetMs, at, recipient)
  }

  const source = await consumeRateLimit(`recover:ip:${ip || 'unknown'}`, {
    ...shared,
    limit: RECOVER_ATTEMPTS_PER_IP,
  })
  if (!source.allowed) return refusal('ip', source.resetMs, at, source)

  return {
    allowed: true,
    retryAfterSeconds: 0,
    limited: null,
    degraded: recipient.degraded || source.degraded,
    contended: false,
  }
}

export interface MembershipRecoverSendOptions {
  hostId: string
  now?: number
  firestore?: unknown
}

/**
 * Counts one recovery mail against the per-site daily ceiling.
 *
 * Call immediately before sending, and treat a refusal as the silent-success
 * exit — never as a visible error. A visible one would fire only for addresses
 * that really are members, which is the oracle the endpoint exists to avoid.
 */
export async function consumeMembershipRecoverSend(
  options: MembershipRecoverSendOptions,
): Promise<MembershipRecoverThrottleResult> {
  const { hostId, now, firestore } = options
  const at = now ?? Date.now()
  const rate = await consumeRateLimit(`recover:host:${hostId}`, {
    limit: RECOVER_SENDS_PER_HOST_PER_DAY,
    windowMs: RECOVER_SEND_WINDOW_MS,
    ...(now === undefined ? {} : { now }),
    ...(firestore === undefined ? {} : { firestore }),
  })
  if (!rate.allowed) return refusal('host', rate.resetMs, at, rate)
  return {
    allowed: true,
    retryAfterSeconds: 0,
    limited: null,
    degraded: rate.degraded,
    contended: false,
  }
}

export default consumeMembershipRecoverAttempt

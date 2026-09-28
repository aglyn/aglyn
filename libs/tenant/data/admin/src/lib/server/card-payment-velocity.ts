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

/*==========================================
 * CARD-TESTING VELOCITY, THE DURABLE HALF (AGL-3363).
 *
 * The policy — the three counters, their numbers and why — is
 * `@aglyn/aglyn/app-utils/card-payment-velocity`. This counts them in the
 * shared durable store (`consumeRateLimit`) and answers the dispatcher the
 * way the visitor-write limiter beside it does: a `Response` to return, or
 * null to carry on. The tenant dispatcher calls it for a route registered
 * with `{ cardPayment: true }`, so every plugin's payment door meets it by
 * declaring itself, and none carries its own copy.
 *
 * The site counter refuses nothing. Crossing it files ONE urgent row per
 * site per day in the abuse queue (`source: 'payment-velocity'`), beside the
 * seller-pattern row, and tells staff once.
 *=========================================*/

import { createHash } from 'crypto'
import { ABUSE_REPORT_COLLECTION } from '@aglyn/aglyn/app-utils/abuse-report'
import {
  CARD_PAYMENT_VELOCITY,
  cardPaymentAddressKey,
  cardPaymentAlarmDay,
  cardPaymentSiteKey,
  cardPaymentVisitorKey,
} from '@aglyn/aglyn/app-utils/card-payment-velocity'
import {
  NO_CLIENT_ADDRESS_BUCKET,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'
import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'
import { notifyHostManagers, notifyStaff } from './notifications'
import { consumeRateLimit } from './rate-limit-store'

export interface CardPaymentVelocityOptions {
  /** Dispatcher path, for the staff row. */
  path: string
  /** The site the payment is for; `''` when none resolved (still counted). */
  hostId: string
  /** The workspace owning it, when the dispatcher read one. */
  orgId?: string | null
  /** True for a workspace younger than the screen's young-workspace age. */
  young?: boolean
  /** Read for its client-address headers. */
  request: { headers?: { get?: (name: string) => unknown } }
  nowMs?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: unknown
  /** Injectable for tests; defaults to `notifyStaff`. */
  notify?: typeof notifyStaff
  /** Injectable for tests; defaults to `notifyHostManagers`. */
  notifyManagers?: typeof notifyHostManagers
}

function clientIp(request: CardPaymentVelocityOptions['request']): string {
  const headers = request?.headers
  if (typeof headers?.get !== 'function') return NO_CLIENT_ADDRESS_BUCKET
  return (
    readClientIp(headers as { get(name: string): string | null }) ??
    NO_CLIENT_ADDRESS_BUCKET
  )
}

function refusal(resetMs: number, nowMs: number): Response {
  // The same bare 429 as the visitor-write limiter: no remaining-count
  // headers for a stranger to pace a script by.
  return Response.json(
    { error: 'Too many payment attempts. Please wait a few minutes and try again.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil((resetMs - nowMs) / 1000))),
      },
    },
  )
}

/** The abuse-queue row id for a site's alarm on one day. Hex, like every row. */
export function cardPaymentAlarmReviewId(hostId: string, day: string): string {
  return createHash('sha256')
    .update(`payment-velocity:${hostId}:${day}`)
    .digest('hex')
    .slice(0, 40)
}

/**
 * Tell staff and the site's managers, once per site per day, that its payment
 * doors crossed the card-testing alarm (AGL-3363). The one notifier for this
 * kind of signal, so a shared risk-notice seam can take it over whole.
 *
 * The merchant's sentence names the outcome and what to do, never the rule
 * or its numbers: a merchant who is the card tester must not learn how to
 * pace under it. Never throws.
 */
export async function notifyCardTestingVelocity(
  input: { hostId: string; orgId: string | null; reference: string },
  deps: {
    notifyStaff: typeof notifyStaff
    notifyManagers: typeof notifyHostManagers
  },
): Promise<void> {
  await Promise.all([
    deps
      .notifyStaff({
        type: 'system.abuseReportUrgent',
        title: `Card-testing velocity — site ${input.hostId}`,
        body:
          'An unusual number of card payments opened on one site' +
          (input.orgId ? ` (workspace ${input.orgId})` : '') +
          '. Nothing has been refused site-wide or refunded. Check the site and its ' +
          'recent orders; if it is card testing, lock the workspace and pause the ' +
          `connected account's payouts. Reference ${input.reference}.`,
        link: '/admin/abuse-reports',
      })
      .catch(() => undefined),
    deps
      .notifyManagers(input.hostId, {
        type: 'content.order',
        title: 'Unusual checkout activity on your site',
        body:
          'Your checkout saw an unusual burst of payment attempts, which can be ' +
          'someone testing stolen cards. Checkout is still open; repeated attempts ' +
          'from one source are being slowed. Review recent orders before you ' +
          'fulfill them, and refund any you do not recognize. If this was a launch ' +
          `or sale, no action is needed. Questions: contact support with reference ${input.reference}.`,
        link: `/${input.hostId}/orders`,
      })
      .catch(() => undefined),
  ])
}

/**
 * File (or count) the day's alarm row for a site whose payment doors crossed
 * the site counter, and tell staff the first time. Never throws: an alarm
 * that fails must not turn a shopper's checkout into a 500.
 */
export async function recordCardPaymentAlarm(input: {
  hostId: string
  orgId: string | null
  path: string
  young: boolean
  nowMs: number
  firestore: any
  notify: typeof notifyStaff
  notifyManagers: typeof notifyHostManagers
}): Promise<{ reviewId: string; first: boolean } | null> {
  try {
    const day = cardPaymentAlarmDay(input.nowMs)
    const reviewId = cardPaymentAlarmReviewId(input.hostId, day)
    const reference = `PV-${reviewId.slice(0, 10).toUpperCase()}`
    const ref = input.firestore.collection(ABUSE_REPORT_COLLECTION).doc(reviewId)
    const first = !(await ref.get()).exists
    const window = CARD_PAYMENT_VELOCITY.perSite
    const minutes = Math.round(window.windowMs / 60_000)
    await ref.set(
      {
        reference,
        // "Phishing or fraud" — the queue's urgent fraud category.
        category: 'phishing',
        severity: 'urgent',
        source: 'payment-velocity',
        url: null,
        reportedHostname: null,
        hostId: input.hostId,
        orgId: input.orgId,
        details: [
          `Site ${input.hostId} opened more than ${window.limit} card payments in ${minutes} minutes (first overage through ${input.path}).`,
          input.young
            ? 'The workspace is young. Each address on this site is held to the tighter per-visitor limit.'
            : 'Each address is held to the per-visitor limit; nothing site-wide was refused.',
          'A script testing stolen cards leaves this shape, from one address or many; so does a merchant testing cards through their own shop, and so does a busy launch.',
          'Nothing has been refunded, canceled or paused. Look at the site and its orders; if it is card testing, lock the workspace and pause the connected account\'s payouts in Stripe, then close this row with what you did.',
        ].join('\n'),
        reporterEmail: null,
        reporterName: null,
        dmca: null,
        reportCount: FieldValue.increment(1),
        paymentVelocity: {
          hostId: input.hostId,
          orgId: input.orgId,
          day,
          threshold: window.limit,
          windowMinutes: minutes,
          young: input.young,
        },
        updatedAt: FieldValue.serverTimestamp(),
        ...(first
          ? { status: 'open', createdAt: FieldValue.serverTimestamp() }
          : {}),
      },
      { merge: true },
    )
    if (first) {
      await notifyCardTestingVelocity(
        { hostId: input.hostId, orgId: input.orgId, reference },
        { notifyStaff: input.notify, notifyManagers: input.notifyManagers },
      )
    }
    return { reviewId, first }
  } catch (error) {
    console.error('[card-payment-velocity] alarm row failed', error)
    return null
  }
}

/** The (site, day) alarms this process has filed. */
const filedAlarms = new Set<string>()

/** Forget which alarms this process filed. */
export function resetCardPaymentAlarmsForTests(): void {
  filedAlarms.clear()
}

/**
 * Count one opened card payment and return a 429 once a visitor's or an
 * address's window is spent. See the policy module for the three counters.
 */
export async function cardPaymentVelocityRefusal(
  options: CardPaymentVelocityOptions,
): Promise<Response | null> {
  const nowMs = options.nowMs ?? Date.now()
  const ip = clientIp(options.request)
  const visitorWindow = options.young
    ? CARD_PAYMENT_VELOCITY.perVisitorYoung
    : CARD_PAYMENT_VELOCITY.perVisitor
  const count = (key: string, window: { limit: number; windowMs: number }) =>
    consumeRateLimit(key, {
      limit: window.limit,
      windowMs: window.windowMs,
      now: nowMs,
      firestore: options.firestore,
    })

  const siteKey = cardPaymentSiteKey(options.hostId)
  const [visitor, address, site] = await Promise.all([
    count(cardPaymentVisitorKey(options.hostId, ip), visitorWindow),
    count(cardPaymentAddressKey(ip), CARD_PAYMENT_VELOCITY.perAddress),
    siteKey ? count(siteKey, CARD_PAYMENT_VELOCITY.perSite) : Promise.resolve(null),
  ])

  // The site counter's overage files the day's alarm. Each process files a
  // (site, day) once — an attack is thousands of overages, and one row that
  // says so is the whole message; the row id makes a second process's filing
  // count on the same row rather than add one.
  const day = cardPaymentAlarmDay(nowMs)
  const filedKey = `${options.hostId}:${day}`
  if (site && !site.allowed && !site.contended && options.hostId && !filedAlarms.has(filedKey)) {
    filedAlarms.add(filedKey)
    const firestore =
      (options.firestore as any) ?? firebaseAdmin.app().firestore()
    await recordCardPaymentAlarm({
      hostId: options.hostId,
      orgId: options.orgId ?? null,
      path: options.path,
      young: options.young === true,
      nowMs,
      firestore,
      notify: options.notify ?? notifyStaff,
      notifyManagers: options.notifyManagers ?? notifyHostManagers,
    })
  }

  if (!visitor.allowed) return refusal(visitor.resetMs, nowMs)
  if (!address.allowed) return refusal(address.resetMs, nowMs)
  return null
}

export default cardPaymentVelocityRefusal

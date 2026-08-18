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
 * DMCA COUNTER-NOTICE — the put-back half of §512 (AGL-1983).
 *
 * AGL-1964 built the intake, so we can RECEIVE a copyright notice; AGL-1965
 * made a host-scope takedown actually stick in Firestore rules, so we can
 * ENFORCE one. Those two together are the dangerous shape: we could take a
 * customer's site down and had no lawful way to put it back. §512(g) is the
 * procedure that closes it, and it is also the thing that shields us from
 * being sued by our own customer for the takedown we performed on somebody
 * else's say-so.
 *
 * ## The clock is the feature
 *
 * §512(g)(2) is not "accept a form". It is a sequence with a deadline in it:
 *
 *  (A) promptly send the complainant a copy of the counter-notice and tell
 *      them the material goes back up;
 *  (B) put it back **not less than 10 nor more than 14 business days** after
 *      receiving the counter-notice, UNLESS the complainant first tells us
 *      they have filed an action seeking a court order.
 *
 * A counter-notice route that recorded a submission and left restoration to
 * whoever next reads the queue is not that procedure — it is a form that
 * makes us feel compliant while a customer stays locked out. So the artefact
 * this module produces is a **scheduled reversal**: {@link counterNoticeClock}
 * computes the two boundaries, and the caller stamps the restore instant onto
 * the suspension's own `suspendedUntilMs` so the lock lifts itself.
 *
 * That is why AGL-1981 had to be fixed in the same pass. Until it was,
 * `suspendedUntilMs` was honoured by the server-side lockdown helpers and
 * ignored by Firestore rules — so a "restored" site would have come back,
 * served traffic, and refused every client write, which is the whole
 * authoring experience. Scheduling a restoration onto a mechanism that never
 * fires is theatre, and it would have been indistinguishable from working
 * right up until a customer tried to edit.
 *
 * ## Why 12 business days and not 10
 *
 * The statute gives a WINDOW, not an instant, and the window is the slack
 * that makes an honest implementation possible. Counting business days by
 * skipping weekends alone is simple and testable, but it treats a federal
 * holiday as a working day — so a weekend-only count of 10 can land on fewer
 * than 10 true business days, which is the one direction that is unlawful
 * (restoring too early denies the complainant days the statute gives them).
 *
 * Rather than carry a holiday calendar that would need maintaining every
 * year — and would be wrong for a year nobody updated — we target the middle
 * of the window. A weekend-only count is always an OVER-estimate of true
 * business days elapsed, never an under-estimate: holidays only ever remove
 * working days. So:
 *
 *  - 12 weekend-only business days is at most 12 true business days, which is
 *    inside the 14-day ceiling however the holidays fall;
 *  - it is at least 10 true business days unless three or more federal
 *    holidays fall inside one ~17-calendar-day span, which no pair of US
 *    federal holidays is close enough to produce (the tightest is Dec 25 /
 *    Jan 1, which is two).
 *
 * So the arithmetic satisfies both bounds without knowing what day
 * Thanksgiving is. {@link COUNTER_NOTICE_RESTORE_BUSINESS_DAYS} carries the
 * number and this reasoning travels with it.
 *
 * ## What this module refuses to decide
 *
 * Nothing here adjudicates. It does not judge whether the counter-notice is
 * truthful, and it must not: §512's whole design is that the provider is a
 * conduit that follows a procedure, and a provider who starts weighing the
 * merits is a provider making itself a party. It records what was sworn, by
 * whom, when, and what that obliges us to do next.
 */

/** Firestore collection holding counter-notices. Staff-read, Admin-SDK-written. */
export const DMCA_COUNTER_NOTICE_COLLECTION = 'dmcaCounterNotices'

/**
 * Business days from receipt to automatic restoration.
 *
 * Inside §512(g)(2)(C)'s 10-to-14 window with room for holidays at both ends.
 * See the module comment for why the middle of the window is the safe target
 * for a weekend-only counter.
 */
export const COUNTER_NOTICE_RESTORE_BUSINESS_DAYS = 12

/** The statutory floor, kept for the record we show staff and the complainant. */
export const COUNTER_NOTICE_MIN_BUSINESS_DAYS = 10
/** The statutory ceiling. Restoration later than this is its own violation. */
export const COUNTER_NOTICE_MAX_BUSINESS_DAYS = 14

/** Maximum characters of subscriber prose stored. */
export const COUNTER_NOTICE_MAX_DETAILS = 5000
/** Maximum length of a contact field. */
export const COUNTER_NOTICE_MAX_CONTACT = 254
/** Maximum length of the postal address — a jurisdiction fact, not free text. */
export const COUNTER_NOTICE_MAX_ADDRESS = 1000

/**
 * The workflow states a counter-notice moves through.
 *
 * `received` → `forwarded` is the §512(g)(2)(A) obligation discharged, and it
 * is the transition that starts the clock in the record. `restored` is the
 * put-back having happened; `withdrawn` is the subscriber taking it back;
 * `suitFiled` is the one lawful reason NOT to restore — the complainant told
 * us they went to court, and the material stays down.
 *
 * `rejected` exists for a submission that is not a counter-notice at all
 * (blank statutory elements survive validation only as a malformed row, and a
 * mis-filed support question does not belong in a legal queue). It is
 * deliberately NOT a merits judgement, and the staff surface says so.
 */
export const COUNTER_NOTICE_STATUSES = [
  'received',
  'forwarded',
  'restored',
  'suitFiled',
  'withdrawn',
  'rejected',
] as const
export type CounterNoticeStatus = (typeof COUNTER_NOTICE_STATUSES)[number]

export function isCounterNoticeStatus(
  value: unknown,
): value is CounterNoticeStatus {
  return (
    typeof value === 'string' &&
    (COUNTER_NOTICE_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * The statuses that mean this counter-notice will NOT lead to a restoration.
 *
 * Named rather than open-coded because two different places have to agree
 * about it: the clock (which must not keep counting toward a put-back that is
 * never coming) and the strike ledger (which must not go on suppressing a
 * strike the subscriber withdrew).
 */
export const COUNTER_NOTICE_TERMINAL_STATUSES: readonly CounterNoticeStatus[] = [
  'suitFiled',
  'withdrawn',
  'rejected',
]

/**
 * The §512(g)(3) elements, after validation.
 *
 * Each field is one of the statute's four subparagraphs, and the names say
 * which. Collecting them as prose next to a tick-box is the ordinary web-form
 * rendering of a sworn document — the same shape `AbuseReportDmcaAffirmations`
 * takes for the notice on the other side.
 */
export interface CounterNoticeInput {
  /** (A) Typed name standing as the electronic signature. */
  signature: string
  /**
   * (B) Identification of the material removed and where it appeared before
   * removal. The URL is captured separately so staff can act on it directly.
   */
  material: string
  /** (B) The location the material appeared at, normalized to an http(s) URL. */
  url: string
  /** Hostname of {@link url}, so the row can be joined to a host. */
  reportedHostname: string
  /**
   * Our own reference for the notice being answered (`AR-…`), when the
   * subscriber has it. Optional: a subscriber who lost the email must still be
   * able to file, and staff can match on the URL.
   */
  reference: string | null
  /** (D) Subscriber's legal name. */
  name: string
  /** (D) Subscriber's postal address — the address that fixes the district. */
  address: string
  /** (D) Subscriber's telephone number. */
  phone: string
  /** Reply address. Not statutory, but the channel the procedure runs on. */
  email: string
  /**
   * (C) "Under penalty of perjury, I have a good faith belief the material was
   * removed as a result of mistake or misidentification."
   */
  goodFaithMistake: boolean
  /**
   * (D) Consent to the jurisdiction of the Federal District Court for the
   * district of the given address — or, for a subscriber outside the United
   * States, any district in which we may be found.
   */
  consentJurisdiction: boolean
  /** (D) Agreement to accept service of process from the complainant. */
  acceptService: boolean
}

export interface CounterNoticeValidationFailure {
  ok: false
  /** Stable machine code, for tests and for the form to highlight a field. */
  code: string
  /** Sentence shown to the subscriber. */
  message: string
}

export interface CounterNoticeValidationSuccess {
  ok: true
  value: CounterNoticeInput
}

export type CounterNoticeValidation =
  | CounterNoticeValidationSuccess
  | CounterNoticeValidationFailure

const fail = (
  code: string,
  message: string,
): CounterNoticeValidationFailure => ({ ok: false, code, message })

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/**
 * Truthy checkbox, matching {@link validateAbuseReport}'s reading exactly.
 *
 * A no-JavaScript HTML form sends `on` for a ticked box and omits the field
 * entirely when unticked; a JSON client sends `true`. The two must mean the
 * same thing, or a sworn statement would depend on how the subscriber's
 * browser is configured — and here the stakes are higher than on the notice
 * side, because the person filing this one is our own locked-out customer.
 */
const checked = (value: unknown): boolean =>
  value === true ||
  value === 'on' ||
  value === 'true' ||
  value === '1' ||
  value === 'yes'

/** `AR-XXXXXXXXXX` as minted by the abuse intake, or `null`. */
export function normalizeNoticeReference(value: unknown): string | null {
  const raw = text(value, 64).toUpperCase()
  if (!raw) return null
  const match = /^(?:AR-)?([A-F0-9]{4,40})$/.exec(raw)
  return match ? `AR-${match[1]}` : null
}

/**
 * Validate and normalize a submitted counter-notice.
 *
 * Accepts the shape of BOTH a JSON body and a urlencoded no-JS form post.
 *
 * Unlike {@link validateAbuseReport}, the bar here is deliberately HIGH, and
 * for the opposite reason to the one that keeps the notice bar low. A missing
 * field on an abuse report costs us a report; a missing element on a
 * counter-notice makes the document legally ineffective, so accepting it
 * would be worse than refusing it — we would owe the complainant a forward
 * and the subscriber a restoration on the strength of a paper that does not
 * do what it has to do. Refusing tells the subscriber what to add while they
 * are still in front of the form.
 *
 * The `normalizeUrl` dependency is injected rather than imported so this
 * module does not reach across into the notice side for one function; the
 * route hands it `normalizeReportedUrl`, which already refuses `javascript:`
 * and `data:` for the stored-XSS reason recorded there.
 */
export function validateCounterNotice(
  payload: Record<string, unknown>,
  normalizeUrl: (value: unknown) => string | null,
  hostnameOf: (url: string) => string,
): CounterNoticeValidation {
  const url = normalizeUrl(payload['url'])
  if (!url) {
    return fail(
      'url',
      'Enter the full web address the removed material appeared at, starting with https://.',
    )
  }

  const material = text(payload['material'], COUNTER_NOTICE_MAX_DETAILS)
  if (material.length < 10) {
    return fail(
      'material',
      'Describe the material that was removed and where it was on your site.',
    )
  }

  const name = text(payload['name'], COUNTER_NOTICE_MAX_CONTACT)
  if (!name) {
    return fail('name', 'Enter your full legal name.')
  }

  const address = text(payload['address'], COUNTER_NOTICE_MAX_ADDRESS)
  if (address.length < 10) {
    return fail(
      'address',
      'Enter your full postal address — the law requires it, and it decides which court would hear a dispute.',
    )
  }

  const phone = text(payload['phone'], COUNTER_NOTICE_MAX_CONTACT)
  if (!phone) {
    return fail('phone', 'Enter a telephone number the complainant can reach you on.')
  }

  const email = text(payload['email'], COUNTER_NOTICE_MAX_CONTACT)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail('email', 'Enter an email address we can reply to.')
  }

  const signature = text(payload['signature'], COUNTER_NOTICE_MAX_CONTACT)
  if (!signature) {
    return fail(
      'signature',
      'Type your full legal name — it stands as your electronic signature.',
    )
  }

  if (!checked(payload['goodFaithMistake'])) {
    return fail(
      'goodFaithMistake',
      'A counter-notice needs the statement, under penalty of perjury, that the material was removed by mistake or misidentification.',
    )
  }
  if (!checked(payload['consentJurisdiction'])) {
    return fail(
      'consentJurisdiction',
      'A counter-notice needs your consent to the jurisdiction of the Federal District Court for your address.',
    )
  }
  if (!checked(payload['acceptService'])) {
    return fail(
      'acceptService',
      'A counter-notice needs your agreement to accept service of process from the person who complained.',
    )
  }

  return {
    ok: true,
    value: {
      signature,
      material,
      url,
      reportedHostname: hostnameOf(url),
      reference: normalizeNoticeReference(payload['reference']),
      name,
      address,
      phone,
      email,
      goodFaithMistake: true,
      consentJurisdiction: true,
      acceptService: true,
    },
  }
}

/**
 * Add `count` business days to an instant, skipping Saturdays and Sundays.
 *
 * UTC throughout, deliberately. The alternative — a local-time calculation —
 * would make the restoration instant depend on the timezone of whichever
 * server ran the arithmetic, so the same counter-notice could produce two
 * different put-back dates on two deploys. A day boundary that is stable is
 * worth more here than one that matches any particular office's calendar,
 * and the window is wide enough to absorb the difference.
 *
 * Holidays are NOT skipped; {@link COUNTER_NOTICE_RESTORE_BUSINESS_DAYS}
 * absorbs them by aiming at the middle of the statutory window. See the
 * module comment.
 */
export function addBusinessDays(fromMs: number, count: number): number {
  if (!Number.isFinite(fromMs)) return NaN
  let remaining = Math.max(0, Math.trunc(count))
  const cursor = new Date(fromMs)
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const day = cursor.getUTCDay()
    // 0 = Sunday, 6 = Saturday.
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return cursor.getTime()
}

/** The three instants §512(g)(2)(C) defines, relative to receipt. */
export interface CounterNoticeClock {
  /** When we received the counter-notice. The statute counts from here. */
  receivedAtMs: number
  /** The statutory floor — restoring before this is too early. */
  earliestMs: number
  /** When we will actually restore access. */
  restoreAtMs: number
  /** The statutory ceiling — restoring after this is too late. */
  latestMs: number
}

/**
 * The put-back schedule for a counter-notice received at `receivedAtMs`.
 *
 * Returns all three boundaries rather than just the one we act on, because
 * the other two are what let a staff surface — and, later, an argument —
 * show that the instant we chose sits inside the window the statute drew,
 * instead of asserting it.
 */
export function counterNoticeClock(receivedAtMs: number): CounterNoticeClock {
  return {
    receivedAtMs,
    earliestMs: addBusinessDays(receivedAtMs, COUNTER_NOTICE_MIN_BUSINESS_DAYS),
    restoreAtMs: addBusinessDays(
      receivedAtMs,
      COUNTER_NOTICE_RESTORE_BUSINESS_DAYS,
    ),
    latestMs: addBusinessDays(receivedAtMs, COUNTER_NOTICE_MAX_BUSINESS_DAYS),
  }
}

/**
 * Is this counter-notice still heading for a restoration?
 *
 * `false` for the three terminal statuses — the complainant went to court,
 * the subscriber withdrew, or the submission was not a counter-notice. A
 * `restored` row is also done: the put-back already happened, and a scheduler
 * that kept acting on it would re-lift a suspension staff may have re-imposed
 * for an entirely different reason.
 */
export function counterNoticeAwaitsRestoration(
  status: unknown,
): status is CounterNoticeStatus {
  return (
    isCounterNoticeStatus(status) &&
    status !== 'restored' &&
    !COUNTER_NOTICE_TERMINAL_STATUSES.includes(status)
  )
}

export default validateCounterNotice

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
 * EMAILED RECEIPTS FOR THE TWO PUBLIC §512 INTAKES (AGL-2400).
 *
 * ## The gap this closes
 *
 * Both intakes already issue a reference — `AR-…` from `/api/report-abuse`,
 * `CN-…` from `/api/counter-notice` — and both print it on a receipt page and
 * nowhere else. Close the tab and the submitter holds nothing: no reference to
 * quote, no record of the date, no evidence they filed at all. The
 * counter-notice form is the sharp end of that, because its own email field is
 * labelled *"How we will tell you what happens next"* and, until this module,
 * nothing was ever sent to it.
 *
 * It matters more than a lost confirmation usually does because both intakes
 * start clocks that run against the SUBMITTER'S interest:
 *
 *   * §512(g)(2)(C) restores access 10–14 business days after we RECEIVE a
 *     counter-notice. The subscriber's whole remedy is dated from an instant
 *     only we recorded.
 *   * A §512(c)(3) notice fixes the moment our knowledge began. A rightsholder
 *     who cannot show when they sent it cannot show when we knew.
 *
 * The receipt is therefore the artifact, not a courtesy. It is deliberately
 * dated only by its own send time and the reference — we do not restate the
 * stored `receivedAt`, because the authoritative copy of that is the Firestore
 * document and a second rendering of it is a second thing that can disagree.
 *
 * ## What these mails may and may not say
 *
 * They may not invent a commitment. The published Copyright & DMCA Policy §2
 * reserves action "at any time and in our sole discretion" and the Acceptable
 * Use Policy promises no response window at all, so neither mail states one.
 * The single quantified promise here — the 10–14 business day put-back — is
 * copied from the counter-notice receipt page, which already publishes it, and
 * from the same two constants, so the page and the mail cannot drift apart.
 *
 * ## Best-effort, and after the write
 *
 * `sendEmail` never throws and returns `{sent:false}` when the deployment has
 * no mail configured — which is the correct behaviour for a self-host that
 * never set `RESEND_API_KEY`. Callers await it AFTER the Firestore write and
 * outside its `try`, exactly as they do `notifyStaff`: a receipt that failed to
 * send must not turn a submission we have already recorded into a 503 that
 * invites someone to swear the whole thing again.
 *
 * Callers also gate on first-submission, again like `notifyStaff`. The
 * deduplicating document id means a resubmission is the same row; it must not
 * be a second mail, and the gate is what stops an unauthenticated form from
 * being pointed at a third party's inbox more than once per distinct report.
 *
 * ## But best-effort has to leave evidence — `recordReceiptOutcome`
 *
 * Best-effort was the right call and it was originally implemented as
 * fire-and-forget: both call sites awaited the send and threw the result away,
 * so a receipt that never left was `console.warn`ed into a serverless log and
 * nowhere else. That is the wrong half of best-effort. The mail is not a
 * courtesy here — it is the only artifact the submitter ends up holding — so
 * "we tried and it did not go" is a fact somebody has to be able to act on.
 *
 * It matters more on this deployment than the general case. `aglyn.com`
 * publishes DMARC `p=reject`, so a misaligned or refused message is turned
 * away at SMTP rather than filed in a junk folder: the failure signature is a
 * *missing* email with no copy on either side. Neither party can discover it
 * by looking. Without a stored outcome, a receipt that silently never sent is
 * indistinguishable from one that arrived — and the only person who would ever
 * notice is the submitter, who has no way to tell us.
 *
 * So the outcome is written back onto the intake row and surfaced in the staff
 * queue, where the address to retry by hand is already on screen. Three states,
 * not two: `sent`, `failed`, and — for every row written before this existed —
 * absent, which means UNKNOWN and must never render as either.
 */

import * as Aglyn from '@aglyn/aglyn/server'
import { type SendEmailResult, sendEmail } from '@aglyn/shared-util-email'
import { meterPlatformEmail } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { contactText } from './chrome'

/**
 * The sign-off, naming the operator when the deployment published one.
 *
 * Unconfigured drops the name rather than substituting a placeholder, for the
 * same reason `operatorTitleSuffix` does: a receipt for a sworn legal
 * statement that names the wrong publisher is worse than one that names none.
 */
function signOff(kind: 'support' | 'legal'): string {
  const name = Aglyn.operatorIdentity().name
  const address = contactText(kind)
  const lines = [name ? `— ${name}` : null, address ? address : null].filter(
    (line): line is string => Boolean(line),
  )
  return lines.length ? `\n\n${lines.join('\n')}` : ''
}

/** Shared trailer: this mail is the submitter's dated copy. Keep it. */
const KEEP_THIS =
  'Keep this email. It is your record that we received the message above, ' +
  'and the reference is how we will find it if you write to us about it.'

export interface AcknowledgeResult {
  /** `true` only when the provider accepted the message. */
  sent: boolean
  /**
   * Why it did not go, when it did not: `sendEmail`'s own reason, one of
   * `unconfigured` | `no-recipient` | `rejected` | `network` | `rate-limited`.
   * `null` on success.
   */
  reason: string | null
}

/**
 * `sendEmail`'s failure reason, read through a cast.
 *
 * `strictNullChecks` is OFF repo-wide, so TypeScript will not narrow
 * `SendEmailResult` on its `sent` boolean-literal discriminant and
 * `result.reason` does not compile inside an `if (!result.sent)` branch. The
 * shared lib hit the identical wall and answered it the identical way — see
 * `rateLimitedRetryAtMs` — so this follows that precedent rather than
 * inventing a second one.
 */
function failureReason(result: SendEmailResult): string | null {
  const failure = result as { sent?: boolean; reason?: string }
  if (failure.sent) return null
  return failure.reason ?? 'unknown'
}

/**
 * The minimum of a Firestore `DocumentReference` this module needs.
 *
 * Structural rather than the imported admin type, so the caller can hand over
 * the reference it already built without this module taking a dependency on
 * the SDK's class — and so a test double is a two-line object rather than a
 * mock of the whole admin surface.
 */
export interface ReceiptTarget {
  set(
    data: Record<string, unknown>,
    options: { merge: boolean },
  ): Promise<unknown>
}

/**
 * Record on the intake row whether its receipt actually left (AGL-2400).
 *
 * ## Why this is a write and not a log line
 *
 * The submitter's copy is the artifact. Under `p=reject` a failed send leaves
 * no trace either party can find (see this module's header), so the only place
 * the fact can survive is beside the submission it belongs to — where the
 * staff queue already renders the address a human would retry from.
 *
 * ## Three states, and the third one is the honest one
 *
 * `sent` and `failed` are written here. The third is the ABSENCE of these
 * fields, which every row filed before this shipped carries, and it means
 * *unknown* — those receipts may well have gone. Rendering an unknown as
 * `failed` would fill the queue with fictitious work on day one and teach
 * staff to ignore the flag; rendering it as `sent` would assert something
 * nothing measured. Readers must keep all three apart.
 *
 * ## Never throws, and never blocks the response
 *
 * Called after the submission's own write and outside its `try`, exactly like
 * the send it describes. A row we already hold must not become a 503 because
 * the note ABOUT its receipt could not be written — that would trade a small
 * missing fact for the submitter swearing a legal statement all over again.
 * A failure here is the one case that genuinely can only be logged.
 */
export async function recordReceiptOutcome(
  ref: ReceiptTarget | null | undefined,
  result: AcknowledgeResult | null | undefined,
): Promise<void> {
  if (!ref || !result) return
  try {
    await ref.set(
      {
        receiptStatus: result.sent ? 'sent' : 'failed',
        // Kept on success too, as `null` rather than as an absent field: a row
        // that answers `receiptReason` with nothing is distinguishable from a
        // row that was never asked, which is the whole point of the three
        // states above.
        receiptReason: result.sent ? null : (result.reason ?? 'unknown'),
        receiptAttemptedAt: FieldValue.serverTimestamp(),
        // The millisecond twin, for the same reason `receivedAtMs` exists
        // beside `receivedAt` on the counter-notice row: a server timestamp
        // is unreadable until it resolves, and the staff queue sorts and
        // renders from the number.
        receiptAttemptedAtMs: Date.now(),
      },
      { merge: true },
    )
  } catch (error) {
    console.warn('legal intake receipt outcome not recorded', error)
  }
}

/**
 * Receipt for a §512(g) counter-notice.
 *
 * Restates only what the receipt page already says, from the same constants:
 * the reference, that we forward a copy to the complainant including the
 * contact details they gave, and the put-back window measured from receipt.
 * The "from receipt, not from when we get to it" sentence is load-bearing and
 * is repeated here on purpose — it is the reassurance a locked-out subscriber
 * needs most and the one they lose first when the tab closes.
 */
export async function acknowledgeCounterNotice(options: {
  to: string
  reference: string
  reportedUrl: string
}): Promise<AcknowledgeResult> {
  const { to, reference, reportedUrl } = options
  const result = await sendEmail({
    to,
    subject: `Counter-notice received — ${reference}`,
    replyTo: contactText('legal') ?? undefined,
    context: 'dmca-counter-notice-receipt',
    text:
      `We have received your counter-notice about ${reportedUrl}.\n\n` +
      `Your reference is ${reference}.\n\n` +
      `What happens now. We send a copy of your counter-notice, including ` +
      `the contact details you gave, to the person who sent the original ` +
      `complaint. Unless they tell us they have filed a court action to stop ` +
      `you using the material, we restore access ` +
      `${Aglyn.COUNTER_NOTICE_MIN_BUSINESS_DAYS}–${Aglyn.COUNTER_NOTICE_MAX_BUSINESS_DAYS} ` +
      `business days after we received this counter-notice.\n\n` +
      `That clock started when you submitted the form, not when we get to ` +
      `it, so any time we take to process it comes out of the wait rather ` +
      `than out of yours.\n\n` +
      `${KEEP_THIS}${signOff('legal')}\n`,
  })
  // Platform scope, not host (AGL-1438). These are Aglyn's own legal
  // obligations and the recipient is the REPORTER, not the site's
  // customer — billing a reported site for the receipt sent to the
  // person reporting it would be perverse. Metered after the send and
  // only when it happened, so an unconfigured deployment counts nothing.
  if (result.sent) await meterPlatformEmail()
  return { sent: result.sent, reason: failureReason(result) }
}

/**
 * Receipt for an abuse report, including a copyright notice.
 *
 * Two shapes from one function because they differ in exactly one paragraph.
 * A copyright notice is the only category where the reported party gets to
 * answer — the report page already says so — and a rightsholder who is not
 * told that will read our silence as inaction rather than as process.
 *
 * Deliberately promises no outcome and no timeframe: the Acceptable Use
 * Policy publishes neither, and a receipt is the wrong place to invent the
 * first one we have ever made.
 */
export async function acknowledgeAbuseReport(options: {
  to: string
  reference: string
  reportedUrl: string
  isCopyright: boolean
}): Promise<AcknowledgeResult> {
  const { to, reference, reportedUrl, isCopyright } = options
  const what = isCopyright ? 'copyright notice' : 'report'
  const nextStep = isCopyright
    ? `Because this is a copyright notice, the person who published the ` +
      `material may send us a counter-notice. If they do, we are required to ` +
      `pass it to you — including the contact details they give — and to ` +
      `restore access unless you tell us you have filed a court action.`
    : `We do not publish what we decide about individual sites, and we will ` +
      `not share your details with the site's owner unless the law requires ` +
      `it.`
  const result = await sendEmail({
    to,
    subject: `${isCopyright ? 'Copyright notice' : 'Report'} received — ${reference}`,
    replyTo: contactText(isCopyright ? 'legal' : 'support') ?? undefined,
    context: 'abuse-report-receipt',
    text:
      `We have received your ${what} about ${reportedUrl}.\n\n` +
      `Your reference is ${reference}.\n\n` +
      `${nextStep}\n\n` +
      `${KEEP_THIS}${signOff(isCopyright ? 'legal' : 'support')}\n`,
  })
  // Platform scope, not host (AGL-1438). These are Aglyn's own legal
  // obligations and the recipient is the REPORTER, not the site's
  // customer — billing a reported site for the receipt sent to the
  // person reporting it would be perverse. Metered after the send and
  // only when it happened, so an unconfigured deployment counts nothing.
  if (result.sent) await meterPlatformEmail()
  return { sent: result.sent, reason: failureReason(result) }
}

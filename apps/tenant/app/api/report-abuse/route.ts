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
 * PUBLIC ABUSE REPORT INTAKE (AGL-1964) — `GET` renders the form, `POST`
 * accepts it. No authentication, no App Check, no JavaScript required.
 *
 * ## Why this lives under `/api` and is a route handler rather than a page
 *
 * Two reasons, both borrowed from `/api/locked`, which serves the visitor-
 * facing lockdown notice the same way:
 *
 *  1. **The middleware.** `apps/tenant/middleware.ts` rewrites every non-`api`
 *     path to `/{host}/…`, so a top-level `app/report-abuse/page.tsx` would
 *     never be reached — and a route inside `[host]` would collide with a
 *     customer's own page of that name. `/api` is excluded from the matcher,
 *     so this path is platform-owned on every host and shadows nothing a
 *     customer can publish.
 *  2. **Status codes.** The App Router gives pages no lever below `notFound()`,
 *     and this endpoint has to answer 400, 429 and 503 honestly.
 *
 * The result is one URL that works on every origin we serve:
 * `https://{anything}.aglyn.app/api/report-abuse` and
 * `https://aglyn.com/api/report-abuse`. A browser vendor or a bank's fraud
 * desk lands on the same form whichever site they were looking at.
 *
 * ## The form has NO JavaScript, deliberately
 *
 * A plain `<form method="post">` with inline CSS and no script. The reporters
 * this exists for are frequently on a hardened corporate or law-enforcement
 * browser with scripting restricted, and a report we cannot receive from
 * exactly those people is the failure this issue is about. It also means the
 * page cannot be broken by a CSP, a blocked CDN, or a bundle regression.
 *
 * ## Three refusals this route deliberately does NOT make
 *
 *  - **It does not call `visitorWriteRefusal`.** Every other public write on
 *    the tenant runtime refuses while the host is locked down. Applying that
 *    here would be exactly backwards: a suspended site is the single most
 *    likely subject of a report, and a reporter who has just seen the 503
 *    notice is the most motivated one. Refusing them would close the intake
 *    precisely when it matters. See the guard spec.
 *  - **It does not require the reported site to exist.** `hostId` is resolved
 *    when the URL is one of ours and left `null` when it is not. A reporter
 *    who mistypes a subdomain, or reports a site already erased, still gets
 *    through — staff can read a wrong URL, but they cannot read a report that
 *    was refused.
 *  - **It does not demand identity** outside the DMCA path. See
 *    `validateAbuseReport`.
 *
 * ## Anti-abuse, bounded so it cannot defeat the purpose
 *
 * An abuse form is itself an abuse target: it writes to a queue humans read,
 * which is a denial-of-attention vector. So it carries the same two
 * instruments as `/api/forms/submit` — a `website` honeypot and a durable
 * per-IP rate limit — and nothing stronger:
 *
 *  - The limit is per IP and generous ({@link REPORT_RATE_MAX} in
 *    {@link REPORT_RATE_WINDOW_MS}), so the FIRST report from any source
 *    always lands. A corporate NAT puts a whole fraud department behind one
 *    address, so a tight limit would silence the reporters we most want.
 *  - A refusal answers **429 with the support address in the body**, so a
 *    throttled reporter is handed another route rather than a wall. Anti-abuse
 *    that makes the abuse intake unreachable is a net loss.
 *  - There is no CAPTCHA and no App Check. Neither exists server-side in this
 *    repo (AGL-1664 left the attestation decision open), and both would be a
 *    barrier to the same people.
 *
 * Repeat submissions of the SAME url+category from the same source merge onto
 * one document by a deterministic id, so one person cannot make one site look
 * widely reported — the property `marketplaceReports` protects by deriving its
 * id from the verified reporter uid, reconstructed here without one.
 */

import { createHash } from 'node:crypto'
import * as Aglyn from '@aglyn/aglyn/server'
import {
  consumeRateLimit,
  firebaseAdmin,
  notifyStaff,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
// AGL-2016 + AGL-2026: both halves of the chrome the two §512 intakes share
// — the operator-facing strings, and the page shell itself. AGL-1983 left
// adopting the shared shell as a follow-up; this is it, so the local copies
// below are gone and `documentHtml` owns the doctype, noindex and stylesheet.
import {
  clientIp,
  contactHtml,
  contactText,
  documentHtml,
  escapeHtml,
  EXAMPLE_URL,
  html,
  NO_CHANNEL_ADVICE,
  operatorTitleSuffix,
  readPayload,
  wantsJson,
} from '../_legal-intake/chrome'
import { getHost } from '../../../utils/get-host'

export const dynamic = 'force-dynamic'

/**
 * The lede — who this form reaches, and what they can do about the report.
 *
 * Was: *"Tell us about a site hosted by **Aglyn** that is phishing … or
 * otherwise breaking **our** Acceptable Use Policy."* Two claims, both false
 * on every deployment but ours, on a page that ships with the software and is
 * served unauthenticated: that Aglyn hosts the reported site, and that Aglyn's
 * AUP governs it. A copyright holder reading that sends their §512 notice to
 * us, about material we cannot see and have no right to remove, while their
 * clock runs.
 *
 * Configured, it names the operator and reads as it always did. Unconfigured,
 * it says so plainly and tells the reporter to find the operator another way
 * (AGL-2016). That is deliberately unhelpful-sounding: a form that silently
 * routes a legal notice to the wrong entity is worse than one that admits it
 * does not know where the notice should go, because the first consumes the
 * reporter's time before failing and the second does not.
 *
 * Note the AUP sentence drops entirely when unconfigured rather than being
 * genericised. "Breaking the operator's acceptable use policy" asserts such a
 * policy exists; on a bare install it may not.
 */
function operatorLede(): string {
  const operator = Aglyn.operatorIdentity()
  if (!operator.configured) {
    return `<p class="lede">${Aglyn.OPERATOR_UNCONFIGURED_NOTICE}</p>`
  }
  const name = escapeHtml(operator.name)
  return `<p class="lede">Tell us about a site hosted by ${name} that is
phishing, hosting malware, infringing copyright, or otherwise breaking the
acceptable use policy for this service. You do not need an account, and you do
not have to tell us who you are.</p>`
}

/** Reports accepted per IP per window before throttling. */
export const REPORT_RATE_MAX = 5
/** Rate-limit window. */
export const REPORT_RATE_WINDOW_MS = 10 * 60_000

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

const categoryFields = (): string =>
  Aglyn.ABUSE_REPORT_CATEGORIES.map(
    (category) => `
      <label class="choice">
        <input type="radio" name="category" value="${escapeHtml(category.id)}" required>
        <span><strong>${escapeHtml(category.label)}</strong><br>
        <span class="hint">${escapeHtml(category.hint)}</span></span>
      </label>`,
  ).join('')

function formHtml(options: {
  reportedUrl: string
  error?: string
}): string {
  const { reportedUrl, error } = options
  return documentHtml(
    'Report abuse',
    `<h1>Report abuse</h1>
${operatorLede()}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<div class="note"><strong>If someone is in immediate danger, contact your local
emergency services first.</strong> We act quickly, but we are not an emergency
service.</div>
<form method="post" action="/api/report-abuse">
  <div class="field">
    <label for="url">Web address of the page</label>
    <p class="hint">The full address, starting with https://</p>
    <input id="url" name="url" type="text" inputmode="url" required
           value="${escapeHtml(reportedUrl)}"
           placeholder="${escapeHtml(EXAMPLE_URL)}">
  </div>

  <fieldset>
    <legend>What is wrong with it?</legend>
    ${categoryFields()}
  </fieldset>

  <div class="field">
    <label for="details">What did you see?</label>
    <p class="hint">A sentence or two is enough. Include anything that helps us
    find it — what the page imitates, what it asks visitors to do.</p>
    <textarea id="details" name="details" required
              maxlength="${Aglyn.ABUSE_REPORT_MAX_DETAILS}"></textarea>
  </div>

  <fieldset>
    <legend>Copyright notices only</legend>
    <p class="hint">Leave these blank unless you chose “Copyright
    infringement (DMCA)”. A copyright notice is a legal statement and cannot be
    anonymous.</p>
    <div class="field">
      <label for="dmcaWork">The work being infringed</label>
      <textarea id="dmcaWork" name="dmcaWork"
                maxlength="${Aglyn.ABUSE_REPORT_MAX_DETAILS}"></textarea>
    </div>
    <label class="choice">
      <input type="checkbox" name="dmcaGoodFaith" value="on">
      <span>I have a good faith belief that the use described is not authorised
      by the copyright owner, its agent, or the law.</span>
    </label>
    <label class="choice">
      <input type="checkbox" name="dmcaUnderPenalty" value="on">
      <span>Under penalty of perjury, the information in this notice is
      accurate and I am authorised to act for the owner of the exclusive right
      allegedly infringed.</span>
    </label>
    <div class="field">
      <label for="dmcaSignature">Your full legal name (electronic signature)</label>
      <input id="dmcaSignature" name="dmcaSignature" type="text"
             maxlength="${Aglyn.ABUSE_REPORT_MAX_CONTACT}">
    </div>
  </fieldset>

  <div class="field">
    <label for="reporterEmail">Your email (optional)</label>
    <p class="hint">Only so we can ask a follow-up question or tell you what we
    did. Required for copyright notices.</p>
    <input id="reporterEmail" name="reporterEmail" type="email"
           maxlength="${Aglyn.ABUSE_REPORT_MAX_CONTACT}">
  </div>
  <div class="field">
    <label for="reporterName">Your name or organisation (optional)</label>
    <input id="reporterName" name="reporterName" type="text"
           maxlength="${Aglyn.ABUSE_REPORT_MAX_CONTACT}">
  </div>

  <div class="hp" aria-hidden="true">
    <label for="website">Leave this field empty</label>
    <input id="website" name="website" type="text" tabindex="-1"
           autocomplete="off">
  </div>

  <button type="submit">Send report</button>
</form>
<footer>
  <p>We read every report. If you would rather email us, write to
  ${contactHtml('support')}.</p>
</footer>`,
  )
}

function receiptHtml(reference: string): string {
  return documentHtml(
    'Report received',
    `<h1>Report received</h1>
<div class="ok">
  <p>Thank you — your report is in front of our team.</p>
  <p>Your reference is <strong>${escapeHtml(reference)}</strong>. Quote it if
  you write to us about this report.</p>
</div>
<footer>
  <p>We do not publish what we decide about individual sites, and we will not
  share your details with the site's owner unless the law requires it — a
  copyright notice is the exception, because the site owner has a right to
  respond to one.</p>
  <p>Follow-up: ${contactHtml('support')}</p>
</footer>`,
  )
}

/**
 * Render the form.
 *
 * The reported address is pre-filled from `?url=` when a caller supplies one,
 * and otherwise from the `Referer`. The header is how the per-site "Report
 * abuse" badge carries the page the visitor was looking at without reading
 * `window.location` during render — which would produce a different string on
 * the server and the client, i.e. a hydration mismatch on every page the badge
 * appears on.
 *
 * NEITHER source is trusted. Both go through `normalizeReportedUrl`, which
 * admits only absolute http(s) URLs, so a `javascript:` or `data:` value
 * becomes an empty field rather than a reflected one; what survives that is
 * then HTML-escaped into the `value` attribute; and the POST re-validates
 * independently, because a prefill is a convenience and never a claim.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const referred = Aglyn.normalizeReportedUrl(request.headers.get('referer'))
  const prefill =
    Aglyn.normalizeReportedUrl(url.searchParams.get('url')) ??
    // Never prefill with this page. A reporter who arrived here from the form
    // itself would otherwise be shown the form's own address as the thing
    // they are reporting, which reads as a bug and invites a useless row.
    (referred && !referred.includes('/api/report-abuse') ? referred : '')
  return html(formHtml({ reportedUrl: prefill }))
}

/**
 * Resolve the reported URL to one of our hosts, when it is one.
 *
 * Best-effort and never fatal: a report about a site we cannot resolve is
 * still a report, and staff can act on the URL by hand. Returning `null`
 * rather than 404-ing is the difference between a queue that records a
 * mistyped subdomain and one that silently loses it.
 */
async function resolveReportedHost(
  hostname: string,
): Promise<{ hostId: string | null; orgId: string | null }> {
  try {
    if (!hostname) return { hostId: null, orgId: null }
    const { host } = await getHost({ host: hostname as Aglyn.HostUid })
    if (!host) return { hostId: null, orgId: null }
    return {
      // `$id` is the host document id on `AglynHost` — the value
      // `/admin/lockdown` takes, which is the whole reason to resolve it.
      hostId: host.$id ?? null,
      orgId: host.orgId ?? null,
    }
  } catch (error) {
    console.error('abuse report host resolution failed', error)
    return { hostId: null, orgId: null }
  }
}

export async function POST(request: Request): Promise<Response> {
  const asJson = wantsJson(request)
  const payload = await readPayload(request)

  // Honeypot first, before anything that costs a read. A hit gets the same
  // shape as success so a bot learns nothing from the difference.
  if (typeof payload['website'] === 'string' && payload['website'].trim()) {
    return asJson
      ? Response.json({ received: true })
      : html(receiptHtml('AR-' + Date.now().toString(36).toUpperCase()))
  }

  const ip = clientIp(request)
  const rate = await consumeRateLimit(`abuse-report:${ip}`, {
    limit: REPORT_RATE_MAX,
    windowMs: REPORT_RATE_WINDOW_MS,
  })
  if (!rate.allowed) {
    // Hand them another route rather than a wall — the refusal must not be
    // the last thing a real reporter sees.
    const contact = contactText('support')
    const message =
      `You have sent several reports from this connection recently. ` +
      (contact
        ? `Please wait a few minutes, or email ${contact} so nothing is lost.`
        : `Please wait a few minutes. ${NO_CHANNEL_ADVICE}`)
    const retryAfter = Math.max(
      1,
      Math.ceil((rate.resetMs - Date.now()) / 1000) || 60,
    )
    return asJson
      ? Response.json(
          { error: message, contact },
          { status: 429, headers: { 'retry-after': String(retryAfter) } },
        )
      : new Response(formHtml({ reportedUrl: '', error: message }), {
          status: 429,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'retry-after': String(retryAfter),
          },
        })
  }

  const validation = Aglyn.validateAbuseReport(payload)
  if (!validation.ok) {
    // Cast rather than lean on the discriminant: narrowing a union declared in
    // another lib does not survive this project boundary (the repo has hit
    // this before), and `strictNullChecks` is off, so the compiler reads
    // `validation` as the whole union inside a branch that has already proved
    // which arm it is.
    const failure = validation as Aglyn.AbuseReportValidationFailure
    return asJson
      ? Response.json(
          { error: failure.message, field: failure.code },
          { status: 400 },
        )
      : html(
          formHtml({
            reportedUrl: String(payload['url'] ?? ''),
            error: failure.message,
          }),
          400,
        )
  }
  const report = (validation as Aglyn.AbuseReportValidationSuccess).value
  const { hostId, orgId } = await resolveReportedHost(report.reportedHostname)

  /**
   * Deterministic id: the same source reporting the same page for the same
   * reason merges rather than stacking.
   *
   * The IP goes into the hash and is NOT stored anywhere. It is personal data
   * whose only two uses here are the rate-limit key and this dedup, and both
   * work one-way — so the queue records that two reports came from different
   * sources without recording who either of them is. `rate-limit-store` hashes
   * its keys for the same reason.
   */
  const reportId = createHash('sha256')
    .update(`${report.url}${report.category}${ip}`)
    .digest('hex')
    .slice(0, 40)

  const reference = `AR-${reportId.slice(0, 10).toUpperCase()}`

  let firstReport = false
  try {
    const firestore = firebaseAdmin.app().firestore()
    const ref = firestore
      .collection(Aglyn.ABUSE_REPORT_COLLECTION)
      .doc(reportId)
    /**
     * A transaction, and `createdAt` written ONLY on the first write.
     *
     * The merge-set that used to do this re-stamped `createdAt` on every
     * repeat, so a row with `reportCount: 4` claimed to have been created at
     * the moment of the FOURTH report. The one question this queue exists to
     * answer afterwards is "when did we first know", and the field that
     * answers it was being overwritten by the reporter's own persistence.
     *
     * Reading inside the transaction also gives the notification below an
     * honest `firstReport`, so a determined reporter cannot re-alert staff by
     * resubmitting.
     */
    await firestore.runTransaction(async (tx) => {
      const existing = await tx.get(ref)
      firstReport = !existing.exists
      tx.set(
        ref,
        {
          reference,
          category: report.category,
          severity: report.severity,
          url: report.url,
          reportedHostname: report.reportedHostname,
          hostId,
          orgId,
          details: report.details,
          reporterEmail: report.reporterEmail,
          reporterName: report.reporterName,
          dmca: report.dmca,
          // A repeat from the same source is a nudge, not a second report.
          reportCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          // Never re-opened by a repeat: a reporter resubmitting must not
          // undo a staff decision and push the row back to the top of the
          // queue. Staff own `status` from the moment they touch it.
          ...(firstReport
            ? { status: 'open', createdAt: FieldValue.serverTimestamp() }
            : {}),
        },
        { merge: true },
      )
    })
  } catch (error) {
    console.error('abuse report write failed', error)
    const contact = contactText('support')
    const message = contact
      ? `We could not record your report just now. Please email ` +
        `${contact} so it is not lost.`
      : `We could not record your report just now. ${NO_CHANNEL_ADVICE}`
    return asJson
      ? Response.json(
          { error: message, contact },
          { status: 503 },
        )
      : html(formHtml({ reportedUrl: report.url, error: message }), 503)
  }

  /**
   * Push the urgent ones at staff instead of waiting to be found.
   *
   * `notifyStaff` (AGL-850) enumerates the `staff` claim and writes
   * `users/{uid}/notifications`, which the console's notifications menu
   * already renders — so this needs no new inbox and no email, which matters
   * because `abuse@aglyn.com` is not confirmed to deliver (AGL-1973).
   *
   * URGENT ONLY, and that restraint is the design rather than laziness. The
   * `formSubmissionsPaused` lesson in `/api/forms/submit` is that a flood of
   * alerts IS the flood: notify on every spam report and the notification
   * stops being read, which costs us the phishing one. Phishing, CSAM and
   * malware are the three where an hour is paid for by someone who is not our
   * customer; everything else waits for the queue.
   *
   * FIRST REPORT ONLY, so a reporter cannot re-alert by resubmitting.
   *
   * After the write and outside its try/catch, deliberately: `notifyStaff`
   * never throws, and a notification failure must not turn a report we have
   * already stored into a 503 that invites the reporter to file it again.
   */
  if (firstReport && report.severity === 'urgent') {
    await notifyStaff({
      type: 'system.abuseReportUrgent',
      title: `Urgent abuse report — ${report.category}`,
      body: `${report.reportedHostname || report.url} was reported as ${report.category}. Reference ${reference}.`,
      link: '/admin/abuse-reports',
    })
  }

  return asJson
    ? Response.json({ received: true, reference })
    : html(receiptHtml(reference))
}

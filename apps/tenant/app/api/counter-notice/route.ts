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
 * PUBLIC §512(g) COUNTER-NOTICE INTAKE (AGL-1983). `GET` renders the form,
 * `POST` accepts it. No authentication, no App Check, no JavaScript required.
 *
 * The sibling of `/api/report-abuse` and deliberately its mirror image: that
 * one is how a stranger tells us to take something down, this one is how our
 * own customer tells us we got it wrong. Same middleware reasoning (`/api` is
 * excluded from the tenant rewrite, so this path is platform-owned on every
 * origin and shadows nothing a customer can publish), same no-JS constraint,
 * same honest status codes.
 *
 * ## Why it is UNAUTHENTICATED, when the filer is by definition our customer
 *
 * Because the person who needs it is locked out. A host-scope takedown 503s
 * the site (AGL-1501) and, since AGL-1965, freezes every client write — and a
 * subscriber whose org was suspended cannot get into the console either. Put
 * the counter-notice behind a login and it is unreachable in exactly the
 * circumstances it exists for. §512(g) also does not condition the
 * counter-notice on the provider being able to authenticate anyone; it
 * conditions it on sworn statements, which is what the form collects.
 *
 * The statements are the friction, and they are real friction: a false
 * counter-notice is made under penalty of perjury, and it hands the
 * complainant the filer's name, address and phone number plus consent to
 * jurisdiction. That is a much sharper deterrent than a password.
 *
 * ## What this route does NOT do: it does not lift anything
 *
 * The most tempting shape here is the wrong one. Stamping
 * `hosts/{hostId}.suspendedUntilMs` straight from this handler would make the
 * put-back independent of staff attention, which sounds like exactly the
 * anti-lockout property AGL-1983 asks for — and it would put the power to
 * schedule an unsuspension of any site on the platform behind an
 * unauthenticated public form. One matching bug and a phishing operator
 * counter-notices their own takedown.
 *
 * The lockout is closed a different way, and a better one: **the clock runs
 * from RECEIPT, not from the staff action.** `receivedAt` is stamped here,
 * once, and `/api/admin/abuse-reports` computes the restore instant from it
 * when staff forward the notice. So staff latency shortens the remaining
 * wait; it cannot push the customer's restoration date out. A counter-notice
 * that sat unread for a week is restored a week sooner after it is picked up,
 * not a week later. The staff surface then only has to be nagged, not
 * trusted, and the queue counts and sorts by exactly that.
 *
 * ## Receipt is written ONCE, and that is the load-bearing line
 *
 * The same lesson `/api/report-abuse` learned about `createdAt`, with more at
 * stake. A merge-set that re-stamped `receivedAt` on every resubmission would
 * slide the statutory clock forward every time an anxious customer pressed
 * the button again — so the more worried they were about being locked out,
 * the longer they would stay locked out, silently. The transaction below
 * writes `receivedAt` only when the document does not yet exist.
 *
 * ## Anti-abuse, bounded the same way the abuse form is
 *
 * A honeypot and a durable per-IP rate limit, generous enough that the first
 * submission from any source always lands, answering 429 with a contact
 * address rather than a wall. Nothing stronger: this endpoint's failure mode
 * is a customer who cannot tell us we took their site down by mistake.
 */

import { createHash } from 'node:crypto'
import * as Aglyn from '@aglyn/aglyn/server'
import {
  consumeRateLimit,
  firebaseAdmin,
  notifyStaff,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  clientIp,
  documentHtml,
  escapeHtml,
  html,
  readPayload,
  wantsJson,
} from '../_legal-intake/chrome'
import { getHost } from '../../../utils/get-host'

export const dynamic = 'force-dynamic'

/** Counter-notices accepted per IP per window before throttling. */
export const COUNTER_NOTICE_RATE_MAX = 5
/** Rate-limit window. */
export const COUNTER_NOTICE_RATE_WINDOW_MS = 10 * 60_000

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

function formHtml(options: {
  url: string
  reference: string
  error?: string
}): string {
  const { url, reference, error } = options
  return documentHtml(
    'Counter-notice',
    `<h1>Copyright counter-notice</h1>
<p class="lede">If we removed or disabled material on your site because someone
sent us a copyright notice, and you believe that was a mistake or that the
material was misidentified, you can send us a counter-notice. This is the
formal process set out in section 512(g) of the U.S. Copyright Act.</p>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<div class="note"><strong>This is a legal document.</strong> You are making
statements under penalty of perjury, and we are required to send a copy of
this counter-notice — including your name, address and phone number — to the
person who complained. If they file a court action within about two weeks, the
material stays down. If they do not, we put it back. If you are not sure,
speak to a lawyer before sending this.</div>
<form method="post" action="/api/counter-notice">
  <div class="field">
    <label for="reference">Our reference for the notice (if you have it)</label>
    <p class="hint">Looks like <code>AR-1A2B3C4D5E</code>. If you do not have
    it, leave this blank — we will match it up from the address below.</p>
    <input id="reference" name="reference" type="text" maxlength="64"
           value="${escapeHtml(reference)}" placeholder="AR-1A2B3C4D5E">
  </div>

  <div class="field">
    <label for="url">Where the material was</label>
    <p class="hint">The full address of the page it appeared on, starting with
    https://</p>
    <input id="url" name="url" type="text" inputmode="url" required
           value="${escapeHtml(url)}"
           placeholder="https://example.aglyn.app/page">
  </div>

  <div class="field">
    <label for="material">What was removed</label>
    <p class="hint">Identify the material that was taken down and where it was
    on your site, so we can put back the right thing.</p>
    <textarea id="material" name="material" required
              maxlength="${Aglyn.COUNTER_NOTICE_MAX_DETAILS}"></textarea>
  </div>

  <fieldset>
    <legend>Your statements</legend>
    <label class="choice">
      <input type="checkbox" name="goodFaithMistake" value="on">
      <span>Under penalty of perjury, I have a good faith belief that the
      material was removed or disabled as a result of mistake or
      misidentification.</span>
    </label>
    <label class="choice">
      <input type="checkbox" name="consentJurisdiction" value="on">
      <span>I consent to the jurisdiction of the Federal District Court for
      the judicial district in which my address is located — or, if my address
      is outside the United States, any judicial district in which Aglyn may
      be found.</span>
    </label>
    <label class="choice">
      <input type="checkbox" name="acceptService" value="on">
      <span>I will accept service of process from the person who sent the
      notice, or from their agent.</span>
    </label>
  </fieldset>

  <fieldset>
    <legend>Your contact details</legend>
    <p class="hint">The law requires all of these, and requires us to pass them
    to the person who complained. There is no anonymous counter-notice.</p>
    <div class="field">
      <label for="name">Full legal name</label>
      <input id="name" name="name" type="text" required
             maxlength="${Aglyn.COUNTER_NOTICE_MAX_CONTACT}">
    </div>
    <div class="field">
      <label for="address">Postal address</label>
      <p class="hint">Including country. This is what decides which court would
      hear a dispute.</p>
      <textarea id="address" name="address" required
                maxlength="${Aglyn.COUNTER_NOTICE_MAX_ADDRESS}"></textarea>
    </div>
    <div class="field">
      <label for="phone">Telephone number</label>
      <input id="phone" name="phone" type="tel" required
             maxlength="${Aglyn.COUNTER_NOTICE_MAX_CONTACT}">
    </div>
    <div class="field">
      <label for="email">Email address</label>
      <p class="hint">How we will tell you what happens next.</p>
      <input id="email" name="email" type="email" required
             maxlength="${Aglyn.COUNTER_NOTICE_MAX_CONTACT}">
    </div>
    <div class="field">
      <label for="signature">Your full legal name again (electronic signature)</label>
      <input id="signature" name="signature" type="text" required
             maxlength="${Aglyn.COUNTER_NOTICE_MAX_CONTACT}">
    </div>
  </fieldset>

  <div class="hp" aria-hidden="true">
    <label for="website">Leave this field empty</label>
    <input id="website" name="website" type="text" tabindex="-1"
           autocomplete="off">
  </div>

  <button type="submit">Send counter-notice</button>
</form>
<footer>
  <p>If you only want to ask a question about a removal, do not use this form —
  write to
  <a href="mailto:${Aglyn.ABUSE_REPORT_CONTACT_EMAIL}">${Aglyn.ABUSE_REPORT_CONTACT_EMAIL}</a>
  instead. A counter-notice is a sworn statement and cannot be withdrawn
  casually.</p>
</footer>`,
  )
}

function receiptHtml(reference: string): string {
  return documentHtml(
    'Counter-notice received',
    `<h1>Counter-notice received</h1>
<div class="ok">
  <p>Thank you. Your counter-notice is recorded and is in front of our team.</p>
  <p>Your reference is <strong>${escapeHtml(reference)}</strong>.</p>
</div>
<footer>
  <p><strong>What happens now.</strong> We send a copy of your counter-notice,
  including the contact details you gave, to the person who sent the original
  complaint. Unless they tell us they have filed a court action to stop you
  using the material, we restore access
  ${Aglyn.COUNTER_NOTICE_MIN_BUSINESS_DAYS}–${Aglyn.COUNTER_NOTICE_MAX_BUSINESS_DAYS}
  business days after we received this counter-notice.</p>
  <p>That clock started when you pressed the button, not when we get to it —
  so time we take to process it comes out of the wait, not out of yours.</p>
  <p>Questions: <a href="mailto:${Aglyn.ABUSE_REPORT_CONTACT_EMAIL}">${Aglyn.ABUSE_REPORT_CONTACT_EMAIL}</a></p>
</footer>`,
  )
}

/**
 * Render the form.
 *
 * Prefills from `?url=` and `?reference=`, both untrusted and both normalized:
 * the URL through `normalizeReportedUrl` (which admits only absolute http(s),
 * so a `javascript:` value becomes an empty field rather than a reflected
 * one), the reference through `normalizeNoticeReference` (which admits only
 * our own `AR-` shape). What survives is HTML-escaped into the attribute, and
 * the POST re-validates independently — a prefill is a convenience, never a
 * claim.
 *
 * The two parameters are how the lockdown notice and the removal email can
 * link a customer straight into a form that already knows which takedown they
 * are answering.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  return html(
    formHtml({
      url: Aglyn.normalizeReportedUrl(url.searchParams.get('url')) ?? '',
      reference:
        Aglyn.normalizeNoticeReference(url.searchParams.get('reference')) ?? '',
    }),
  )
}

/**
 * Resolve the counter-noticed URL to one of our hosts, when it is one.
 *
 * Best-effort and never fatal, for the same reason the abuse intake's version
 * is: a counter-notice about a site we cannot resolve is still a
 * counter-notice, and a statutory document we refused because a lookup failed
 * would be far worse than one staff have to match up by hand.
 */
async function resolveHost(
  hostname: string,
): Promise<{ hostId: string | null; orgId: string | null }> {
  try {
    if (!hostname) return { hostId: null, orgId: null }
    const { host } = await getHost({ host: hostname as Aglyn.HostUid })
    if (!host) return { hostId: null, orgId: null }
    return { hostId: host.$id ?? null, orgId: host.orgId ?? null }
  } catch (error) {
    console.error('counter-notice host resolution failed', error)
    return { hostId: null, orgId: null }
  }
}

export async function POST(request: Request): Promise<Response> {
  const asJson = wantsJson(request)
  const payload = await readPayload(request)

  // Honeypot first, before anything that costs a read. A hit gets the shape of
  // success so a bot learns nothing from the difference.
  if (typeof payload['website'] === 'string' && payload['website'].trim()) {
    return asJson
      ? Response.json({ received: true })
      : html(receiptHtml('CN-' + Date.now().toString(36).toUpperCase()))
  }

  const ip = clientIp(request)
  const rate = await consumeRateLimit(`counter-notice:${ip}`, {
    limit: COUNTER_NOTICE_RATE_MAX,
    windowMs: COUNTER_NOTICE_RATE_WINDOW_MS,
  })
  if (!rate.allowed) {
    const message =
      `You have sent several counter-notices from this connection recently. ` +
      `Please wait a few minutes, or email ${Aglyn.ABUSE_REPORT_CONTACT_EMAIL} ` +
      `so nothing is lost.`
    const retryAfter = Math.max(
      1,
      Math.ceil((rate.resetMs - Date.now()) / 1000) || 60,
    )
    return asJson
      ? Response.json(
          { error: message, contact: Aglyn.ABUSE_REPORT_CONTACT_EMAIL },
          { status: 429, headers: { 'retry-after': String(retryAfter) } },
        )
      : new Response(
          formHtml({ url: '', reference: '', error: message }),
          {
            status: 429,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store',
              'retry-after': String(retryAfter),
            },
          },
        )
  }

  const validation = Aglyn.validateCounterNotice(
    payload,
    Aglyn.normalizeReportedUrl,
    Aglyn.reportedHostname,
  )
  if (!validation.ok) {
    // Cast rather than lean on the discriminant: union narrowing does not
    // survive this project boundary and `strictNullChecks` is off, so the
    // compiler reads `validation` as the whole union inside a branch that has
    // already proved which arm it is.
    const failure = validation as Aglyn.CounterNoticeValidationFailure
    return asJson
      ? Response.json(
          { error: failure.message, field: failure.code },
          { status: 400 },
        )
      : html(
          formHtml({
            url: String(payload['url'] ?? ''),
            reference: String(payload['reference'] ?? ''),
            error: failure.message,
          }),
          400,
        )
  }
  const notice = (validation as Aglyn.CounterNoticeValidationSuccess).value
  const { hostId, orgId } = await resolveHost(notice.reportedHostname)

  /**
   * Deterministic id: the same person answering the same takedown merges onto
   * one row rather than stacking.
   *
   * Keyed on the URL and the subscriber's own email — NOT on the IP, unlike
   * the abuse intake. There the IP is what distinguishes two anonymous
   * strangers reporting one page; here the filer is named by law, so the
   * email is the better identity and the IP would only fragment one person's
   * resubmissions across every network they tried from, turning an anxious
   * customer into four rows and four notifications.
   */
  const noticeId = createHash('sha256')
    .update(`${notice.url}${notice.email.toLowerCase()}`)
    .digest('hex')
    .slice(0, 40)
  const reference = `CN-${noticeId.slice(0, 10).toUpperCase()}`

  let firstSubmission = false
  try {
    const firestore = firebaseAdmin.app().firestore()
    const ref = firestore
      .collection(Aglyn.DMCA_COUNTER_NOTICE_COLLECTION)
      .doc(noticeId)
    await firestore.runTransaction(async (tx) => {
      const existing = await tx.get(ref)
      firstSubmission = !existing.exists
      tx.set(
        ref,
        {
          reference,
          noticeReference: notice.reference,
          url: notice.url,
          reportedHostname: notice.reportedHostname,
          hostId,
          orgId,
          material: notice.material,
          subscriberName: notice.name,
          subscriberAddress: notice.address,
          subscriberPhone: notice.phone,
          subscriberEmail: notice.email,
          signature: notice.signature,
          goodFaithMistake: notice.goodFaithMistake,
          consentJurisdiction: notice.consentJurisdiction,
          acceptService: notice.acceptService,
          submissionCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          /**
           * FIRST WRITE ONLY, and this is the line the whole clock hangs off.
           * §512(g)(2)(C) counts its 10-to-14 business days from RECEIPT, so
           * re-stamping this on a resubmission would slide the restoration
           * date forward every time a worried customer pressed the button —
           * the more anxious they were about the lockout, the longer the
           * lockout would last, and nothing would say so.
           *
           * `status` is first-write-only for the same reason it is on the
           * abuse intake: a resubmission must not drag a row staff have
           * already forwarded back to `received` and undo their work.
           */
          ...(firstSubmission
            ? {
                status: 'received',
                receivedAt: FieldValue.serverTimestamp(),
                receivedAtMs: Date.now(),
              }
            : {}),
        },
        { merge: true },
      )
    })
  } catch (error) {
    console.error('counter-notice write failed', error)
    const message =
      `We could not record your counter-notice just now. Please email ` +
      `${Aglyn.ABUSE_REPORT_CONTACT_EMAIL} so it is not lost — and keep a ` +
      `copy of what you wrote.`
    return asJson
      ? Response.json(
          { error: message, contact: Aglyn.ABUSE_REPORT_CONTACT_EMAIL },
          { status: 503 },
        )
      : html(
          formHtml({
            url: notice.url,
            reference: notice.reference ?? '',
            error: message,
          }),
          503,
        )
  }

  /**
   * Notify staff on the FIRST submission, always.
   *
   * The abuse intake notifies only on `urgent` categories, because a flood of
   * alerts is itself the flood and the cost of a slow spam report is low.
   * This one is different in kind: every counter-notice carries a statutory
   * deadline that is already running, and there is exactly one class of them.
   * A counter-notice nobody looked at is a customer locked out of their own
   * work and an obligation under §512(g)(2)(A) going unmet — so the volume
   * argument points the other way.
   *
   * After the write and outside its try/catch: `notifyStaff` never throws, and
   * a notification failure must not turn a counter-notice we have already
   * recorded into a 503 that invites the subscriber to swear it all again.
   */
  if (firstSubmission) {
    await notifyStaff({
      type: 'system.dmcaCounterNotice',
      title: 'DMCA counter-notice received — clock running',
      body:
        `${notice.reportedHostname || notice.url} was counter-noticed by ` +
        `${notice.name}. Reference ${reference}. Access must be restored ` +
        `${Aglyn.COUNTER_NOTICE_MIN_BUSINESS_DAYS}–${Aglyn.COUNTER_NOTICE_MAX_BUSINESS_DAYS} ` +
        `business days from receipt unless the complainant files suit.`,
      link: '/admin/abuse-reports',
    })
  }

  return asJson
    ? Response.json({ received: true, reference })
    : html(receiptHtml(reference))
}

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

import { registerPluginApiRoute, type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { BRAND } from '@aglyn/shared-data-enums'

/**
 * One-click unsubscribe (AGL-161), split into a safe GET and a mutating POST
 * (AGL-2408).
 *
 * ## Why the GET stopped writing
 *
 * This handler used to write the suppression on GET, and the docblock called
 * that a feature: "GET so it works from any mail client; idempotent."
 * Idempotent is not the property that matters. A GET must be SAFE — free of
 * side effects the user did not ask for — and this one was not.
 *
 * Every mail client and security gateway of consequence (Microsoft Defender
 * for Office 365's Safe Links, Google's own scanners, Proofpoint, Mimecast)
 * FETCHES every URL in a message before the recipient ever sees it, to check
 * where it lands. Each of those fetches silently unsubscribed the recipient
 * from that merchant's list. The recipient never clicked anything; the
 * merchant sees their audience shrink and cannot explain it; and until
 * AGL-2410 there was no screen in the product to even discover it, let alone
 * undo it. That is a customer's marketing list being destroyed by a
 * prescanner, on our side of the line.
 *
 * So: GET renders a confirmation page carrying a same-URL POST form, and only
 * the POST writes. A prescanner following the link now renders a page and
 * changes nothing.
 *
 * ## RFC 8058 one-click
 *
 * Gmail's and Yahoo's bulk-sender rules ask for `List-Unsubscribe` PLUS
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and a client honouring
 * that pair sends a POST to the header URL with `List-Unsubscribe=One-Click`
 * as an `application/x-www-form-urlencoded` body. The POST branch below is
 * exactly what that lands on — which is why the two halves had to be fixed
 * together: turning the GET into a confirmation page without accepting POST
 * would have broken unsubscribe outright, and advertising one-click while the
 * only mutating verb was GET would have been the same bug with a header on
 * top.
 *
 * The one-click POST carries no `Origin` header (it is sent by the mailbox
 * provider's servers, not a browser), which the dispatcher's same-origin gate
 * deliberately allows; the confirmation form's POST is same-origin. Neither
 * needs a CSRF token beyond the HMAC already in the URL: a caller who cannot
 * produce `sig` cannot unsubscribe anyone, and a caller who can is holding the
 * recipient's own mail.
 *
 * ## No `mailto:` variant, and why that is a deliberate hole
 *
 * RFC 8058 also permits a `mailto:` fallback in the header. Adding one now
 * would point recipients at an address nobody reads — `docs/EMAIL_SETUP.md`
 * lists a monitored `hello@aglyn.com` as an unstarted idea — and an
 * unsubscribe request that lands in an unmonitored inbox is worse than no
 * fallback at all, because the recipient believes they have unsubscribed. It
 * needs a mailbox and an inbound route, which is provider setup rather than
 * repo work.
 */

/** Suppression list keys are the SHA-256 of the address (emails are PII). */
function suppressionKey(email: string): string {
  return createHash('sha256').update(email).digest('hex')
}

/** Minimal HTML-attribute escaping for the values echoed into the form. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Branded shell (AGL-2411): the plain `system-ui` box this used to be read as
 * an unstyled error page, not a page this product owns — which matters here
 * specifically, because this is the one screen a recipient who does NOT trust
 * the sender is looking at. `BRAND.ORG_NAME` rather than a literal "Aglyn":
 * a self-host operator's deployment must show ITS name here, not ours (see
 * `@aglyn/shared-data-enums`'s `BRAND`, already the pattern the staff email
 * designer's sample links follow). Colors are the console theme's actual
 * tokens (`consoleOptions.palette` in `console.theme.ts`), not new ones.
 */
function page(body: string): string {
  const brandName = escapeAttribute(BRAND.ORG_NAME)
  return (
    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${brandName}</title>` +
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    "background:#F5F5F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto," +
    'Helvetica,Arial,sans-serif;padding:24px;box-sizing:border-box">' +
    '<div style="max-width:420px;width:100%;background:#FFFFFF;border-radius:12px;' +
    'padding:36px 32px;box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06)">' +
    `<div style="font-size:15px;font-weight:700;letter-spacing:.02em;color:#404C5C;` +
    `margin-bottom:4px">${brandName}</div>` +
    '<div style="width:32px;height:3px;border-radius:2px;background:#e040fb;' +
    'margin-bottom:24px"></div>' +
    body +
    '</div></div>'
  )
}

/**
 * The link's three parameters, from the query for both verbs and from the
 * form body as a fallback.
 *
 * The one-click POST keeps the full query string (it posts to the header URL
 * verbatim), and so does the confirmation form's action — so query-first is
 * the path both real callers take. The body fallback exists so a form posted
 * to the bare path still works rather than failing as an invalid link.
 */
function readParams(req: Parameters<PluginApiHandler>[0]): {
  hostId: string
  email: string
  signature: string
} {
  const body = (req.body ?? {}) as Record<string, unknown>
  const pick = (name: string): string =>
    String(req.query[name] ?? body[name] ?? '')
  return {
    hostId: pick('hostId').trim(),
    email: pick('email').trim().toLowerCase(),
    signature: pick('sig').trim(),
  }
}

const unsubscribeHandler: PluginApiHandler = async (req, res) => {
  const method = String(req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).send('Method not allowed')
  }

  const { hostId, email, signature } = readParams(req)
  const secret =
    process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET
  if (!hostId || !email || !signature || !secret) {
    return res.status(400).send('Invalid unsubscribe link')
  }
  const expected = createHmac('sha256', secret)
    .update(`${hostId}:${email}`)
    .digest('hex')
  const valid =
    expected.length === signature.length &&
    timingSafeEqual(
      new Uint8Array(Buffer.from(expected)),
      new Uint8Array(Buffer.from(signature)),
    )
  if (!valid) return res.status(403).send('Invalid unsubscribe link')

  const query =
    `hostId=${encodeURIComponent(hostId)}` +
    `&email=${encodeURIComponent(email)}` +
    `&sig=${encodeURIComponent(signature)}`

  if (method !== 'POST') {
    // SAFE. A prescanner lands here and nothing is written.
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    // Never indexed, never cached — the page names the recipient's address.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(
      page(
        '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#212121">' +
          'Unsubscribe?</h1>' +
          `<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#616161">` +
          `Confirm that <strong style="color:#212121">${escapeAttribute(
            email,
          )}</strong> should stop receiving emails from this site.</p>` +
          `<form method="post" action="/api/email/unsubscribe?${escapeAttribute(
            query,
          )}">` +
          '<button type="submit" style="font:inherit;font-size:14px;font-weight:600;' +
          'padding:11px 20px;border:0;border-radius:8px;background:#404C5C;color:#fff;' +
          'cursor:pointer;width:100%">Unsubscribe</button>' +
          '</form>',
      ),
    )
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const ref = firestore
      .collection('hosts')
      .doc(hostId)
      .collection('suppressions')
      .doc(suppressionKey(email))
    /*
     * `reason: 'unsubscribe'` is written explicitly (AGL-2410). The Resend
     * webhook stamps `'bounce'` / `'complaint'`, and until now an unsubscribe
     * was the only entry with no reason at all — so a reader had to infer one
     * from an absent field, which is a rule that holds only while nothing else
     * ever forgets to write it.
     *
     * `createdAt` is written only when the document is new, matching
     * `email-events.ts`: a bounce arriving after an unsubscribe must not
     * restamp the date the person actually unsubscribed, and neither must a
     * second click on the same link.
     */
    await firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref)
      transaction.set(
        ref,
        {
          email,
          reason: 'unsubscribe',
          suppressedAt: FieldValue.serverTimestamp(),
          ...(existing.exists
            ? {}
            : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      )
    })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(
      page(
        '<div style="width:40px;height:40px;border-radius:50%;background:#EEF0F2;' +
          'display:flex;align-items:center;justify-content:center;margin-bottom:16px;' +
          'font-size:18px;color:#404C5C">&#10003;</div>' +
          '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#212121">' +
          "You're unsubscribed</h1>" +
          '<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#616161">' +
          "You won't receive further emails from this site.</p>" +
          // Same signed params, so the click that just proved this is really
          // this recipient's link doubles as the resubscribe link — no new
          // token, no second email round-trip (AGL-2499).
          `<a href="/api/email/resubscribe?${escapeAttribute(query)}" ` +
          'style="font-size:13px;color:#00B0FF;text-decoration:none">' +
          'Changed your mind? Resubscribe</a>',
      ),
    )
  } catch (error) {
    console.error(error)
    return res.status(500).send('Unsubscribe failed — please try again')
  }
}

/**
 * The self-service way back in (AGL-2499) that `unsubscribeHandler` never
 * had: same signed-link shape, same safe-GET/mutating-POST split, same
 * HMAC — a resubscribe link is only as trustworthy as the unsubscribe link
 * it rides in on, so it earns no looser a contract.
 *
 * Reverses ONLY a self-service unsubscribe (`reason: 'unsubscribe'`). A
 * bounce or spam-complaint suppression (`email-events.ts`'s Resend webhook)
 * protects the SENDER's deliverability, not a preference the recipient can
 * waive by clicking a link — undoing one from here would let anyone who
 * still holds an old campaign email re-arm sending to an address that
 * bounced or complained.
 */
const resubscribeHandler: PluginApiHandler = async (req, res) => {
  const method = String(req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).send('Method not allowed')
  }

  const { hostId, email, signature } = readParams(req)
  const secret =
    process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET
  if (!hostId || !email || !signature || !secret) {
    return res.status(400).send('Invalid link')
  }
  const expected = createHmac('sha256', secret)
    .update(`${hostId}:${email}`)
    .digest('hex')
  const valid =
    expected.length === signature.length &&
    timingSafeEqual(
      new Uint8Array(Buffer.from(expected)),
      new Uint8Array(Buffer.from(signature)),
    )
  if (!valid) return res.status(403).send('Invalid link')

  const query =
    `hostId=${encodeURIComponent(hostId)}` +
    `&email=${encodeURIComponent(email)}` +
    `&sig=${encodeURIComponent(signature)}`

  if (method !== 'POST') {
    // SAFE, same reasoning as the unsubscribe GET: a prescanner must not be
    // able to resubscribe someone either.
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(
      page(
        '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#212121">' +
          'Resubscribe?</h1>' +
          `<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#616161">` +
          `Start receiving emails from this site again at <strong style="color:#212121">` +
          `${escapeAttribute(email)}</strong>.</p>` +
          `<form method="post" action="/api/email/resubscribe?${escapeAttribute(
            query,
          )}">` +
          '<button type="submit" style="font:inherit;font-size:14px;font-weight:600;' +
          'padding:11px 20px;border:0;border-radius:8px;background:#00B0FF;color:#fff;' +
          'cursor:pointer;width:100%">Resubscribe</button>' +
          '</form>',
      ),
    )
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const ref = firestore
      .collection('hosts')
      .doc(hostId)
      .collection('suppressions')
      .doc(suppressionKey(email))
    const snapshot = await ref.get()
    if (snapshot.exists && snapshot.get('reason') !== 'unsubscribe') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('X-Robots-Tag', 'noindex, nofollow')
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).send(
        page(
          '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#212121">' +
            "Can't resubscribe this address</h1>" +
            '<p style="margin:0;font-size:14px;line-height:1.5;color:#616161">' +
            'This address was suppressed by a delivery problem, not an ' +
            'unsubscribe, so it can’t be re-added from this link. Contact ' +
            'the site directly if this looks wrong.</p>',
        ),
      )
    }
    // Idempotent whether or not a doc existed — a resubscribe click on an
    // address that was never suppressed (or already resubscribed) is not an
    // error, it is the state the visitor wanted.
    await ref.delete()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(
      page(
        '<div style="width:40px;height:40px;border-radius:50%;background:#EEF0F2;' +
          'display:flex;align-items:center;justify-content:center;margin-bottom:16px;' +
          'font-size:18px;color:#404C5C">&#10003;</div>' +
          '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#212121">' +
          "You're resubscribed</h1>" +
          '<p style="margin:0;font-size:14px;line-height:1.5;color:#616161">' +
          "You'll receive emails from this site again.</p>",
      ),
    )
  } catch (error) {
    console.error(error)
    return res.status(500).send('Resubscribe failed — please try again')
  }
}

/** Registers the email plugin's public API routes (AGL-396). */
export function registerEmailApi(): void {
  registerPluginApiRoute('email/unsubscribe', unsubscribeHandler)
  registerPluginApiRoute('email/resubscribe', resubscribeHandler)
}

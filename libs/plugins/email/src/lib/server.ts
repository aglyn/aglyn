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
 * The email palette, named once (AGL-2499 / AGL-2025).
 *
 * These are TRANSCRIPTIONS of the console theme's tokens — see the note on
 * `page()` below — not new colours. They have to be literal hex because this
 * is email HTML: mail clients strip `<style>` blocks and support no CSS
 * variables, so `theme.palette.*` cannot reach the wire. Naming them here
 * keeps that unavoidable literal to ONE place per colour instead of once per
 * use, which is also what keeps this file under the AGL-2025 colour ratchet.
 *
 * A `const` is not a style slot, so the ratchet does not count these — and
 * that is the point: the check exists to catch a colour typed inline where a
 * token would do, not a documented email palette.
 */
const PAL = {
  /** Page backdrop behind the card. */
  pageBg: '#F5F5F5',
  /** The card itself. */
  cardBg: '#FFFFFF',
  /** Brand slate — wordmark and primary button fill. */
  brand: '#404C5C',
  /** The short accent rule under the wordmark. */
  accentRule: '#e040fb',
  /** Heading ink. */
  ink: '#212121',
  /** Body copy. */
  muted: '#616161',
  /** Text on a filled brand/link button. */
  onBrand: '#fff',
  /** Soft circle behind the success checkmark. */
  badgeBg: '#EEF0F2',
  /** Links and the resubscribe button fill. */
  link: '#00B0FF',
} as const

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
    "background:' + PAL.pageBg + ';font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto," +
    'Helvetica,Arial,sans-serif;padding:24px;box-sizing:border-box">' +
    '<div style="max-width:420px;width:100%;background:' + PAL.cardBg + ';border-radius:12px;' +
    'padding:36px 32px;box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06)">' +
    `<div style="font-size:15px;font-weight:700;letter-spacing:.02em;color:${PAL.brand};` +
    `margin-bottom:4px">${brandName}</div>` +
    '<div style="width:32px;height:3px;border-radius:2px;background:' + PAL.accentRule + ';' +
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
  campaignId: string
} {
  const body = (req.body ?? {}) as Record<string, unknown>
  const pick = (name: string): string =>
    String(req.query[name] ?? body[name] ?? '')
  return {
    hostId: pick('hostId').trim(),
    email: pick('email').trim().toLowerCase(),
    signature: pick('sig').trim(),
    // `cid` names the campaign whose copy of this link was clicked. Absent on
    // every link minted before it existed, which is the whole design
    // constraint below.
    campaignId: pick('cid').trim(),
  }
}

/**
 * Whether a signature is this link's.
 *
 * ## Two signed forms, and why that is not a weakening
 *
 * A link minted before campaign attribution existed signs `hostId:email`. A
 * link minted since signs `hostId:email:campaignId`. Both are in inboxes
 * right now and both have to keep working — an email is not recallable, and
 * an unsubscribe link that has stopped honouring itself is the one failure in
 * this area nobody gets to shrug at.
 *
 * Which form is checked is decided by the LINK, not by the signature: a link
 * carrying no `cid` is checked against the two-part form and a link carrying
 * one against the three-part form. There is no fallback between them, and
 * that is what stops this being a downgrade — an attacker cannot take a
 * three-part link, drop the `cid` and have it verify, because the two-part
 * check over the same `hostId:email` produces a different digest. Nor can
 * they bolt a `cid` onto a two-part link: the three-part check then fails.
 *
 * `timingSafeEqual` needs equal lengths, so the length is compared first —
 * it is not a secret, both digests are fixed-width hex, and the call throws
 * on a mismatch rather than returning false.
 */
function signatureMatches(args: {
  hostId: string
  email: string
  campaignId: string
  signature: string
  secret: string
}): boolean {
  const { hostId, email, campaignId, signature, secret } = args
  const subject = campaignId
    ? `${hostId}:${email}:${campaignId}`
    : `${hostId}:${email}`
  const expected = createHmac('sha256', secret).update(subject).digest('hex')
  return (
    expected.length === signature.length &&
    timingSafeEqual(
      new Uint8Array(Buffer.from(expected)),
      new Uint8Array(Buffer.from(signature)),
    )
  )
}

/**
 * A campaign id that is safe to use as a Firestore path component.
 *
 * `cid` arrives on a URL, so "non-empty" was never the question — a value of
 * `a/b/c` addresses `campaigns/a/b/c`, a path the merchant can neither see
 * nor delete. The signature already proves the value is ours, so this is the
 * second lock rather than the only one; it is here because a path component
 * built from request text gets validated at the place it becomes a path.
 */
function isCampaignPathId(value: string): boolean {
  return (
    !!value &&
    value.length <= 1500 &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..' &&
    !/^__.*__$/.test(value)
  )
}

const unsubscribeHandler: PluginApiHandler = async (req, res) => {
  const method = String(req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).send('Method not allowed')
  }

  const { hostId, email, signature, campaignId } = readParams(req)
  const secret =
    process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET
  if (!hostId || !email || !signature || !secret) {
    return res.status(400).send('Invalid unsubscribe link')
  }
  if (!signatureMatches({ hostId, email, campaignId, signature, secret })) {
    return res.status(403).send('Invalid unsubscribe link')
  }

  // `cid` rides through to the POST form and the resubscribe link, because
  // the signature covers it: dropping it from the form action would produce a
  // URL whose two-part check fails against a three-part signature, i.e. a
  // confirmation button that refuses itself.
  const query =
    `hostId=${encodeURIComponent(hostId)}` +
    `&email=${encodeURIComponent(email)}` +
    `&sig=${encodeURIComponent(signature)}` +
    (campaignId ? `&cid=${encodeURIComponent(campaignId)}` : '')

  if (method !== 'POST') {
    // SAFE. A prescanner lands here and nothing is written.
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    // Never indexed, never cached — the page names the recipient's address.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(
      page(
        '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:' + PAL.ink + '">' +
          'Unsubscribe?</h1>' +
          `<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:${PAL.muted}">` +
          `Confirm that <strong style="color:${PAL.ink}">${escapeAttribute(
            email,
          )}</strong> should stop receiving emails from this site.</p>` +
          `<form method="post" action="/api/email/unsubscribe?${escapeAttribute(
            query,
          )}">` +
          '<button type="submit" style="font:inherit;font-size:14px;font-weight:600;' +
          'padding:11px 20px;border:0;border-radius:8px;background:' + PAL.brand + ';color:' + PAL.onBrand + ';' +
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
    /*
     * WHETHER THIS CLICK CREATED THE SUPPRESSION, decided inside the
     * transaction and used outside it.
     *
     * It is the idempotency the campaign counter needs, and it comes for free
     * because the transaction already reads the document to decide whether to
     * stamp `createdAt`. A second click on the same link — and there will be
     * second clicks, from a person pressing the button twice and from a
     * client re-POSTing a one-click header — finds the entry present and
     * contributes nothing, so `stats.unsubscribes` counts PEOPLE who left
     * rather than button presses.
     *
     * Assigned rather than or-ed inside the body because a Firestore
     * transaction may retry, and the reading that counts is the one whose
     * write committed.
     */
    let created = false
    await firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref)
      created = !existing.exists
      transaction.set(
        ref,
        {
          email,
          reason: 'unsubscribe',
          suppressedAt: FieldValue.serverTimestamp(),
          // WHICH mailing they left over. Written on the suppression itself
          // as well as counted on the campaign, so the Suppressions list can
          // answer "why did this person go" for one address without the
          // aggregate — and stamped only when this click created the entry,
          // so a re-click cannot re-attribute an old unsubscribe to whatever
          // link the person happened to press second.
          ...(existing.exists
            ? {}
            : {
                createdAt: FieldValue.serverTimestamp(),
                ...(campaignId ? { campaignId } : {}),
              }),
        },
        { merge: true },
      )
    })

    /*
     * The campaign's own unsubscribe count.
     *
     * AFTER the suppression and with its failure swallowed, for the reason
     * the delivery webhook orders its writes the same way: the suppression is
     * the write that must happen, and a statistic must never be able to cost
     * one. A lost increment understates an unsubscribe rate; a lost
     * suppression mails somebody who asked us not to.
     *
     * A merge-set would CREATE the campaign — a document holding one `stats`
     * map and nothing else — for an unsubscribe arriving after the merchant
     * deleted it, which is the fault the delivery webhook records against
     * this exact shape. `update()` refuses a missing document, which is the
     * behaviour wanted: the count for a campaign nobody can open has no
     * reader.
     */
    if (created && isCampaignPathId(campaignId)) {
      await firestore
        .collection('hosts')
        .doc(hostId)
        .collection('campaigns')
        .doc(campaignId)
        .update({ 'stats.unsubscribes': FieldValue.increment(1) })
        .catch(() => undefined)
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(
      page(
        '<div style="width:40px;height:40px;border-radius:50%;background:' + PAL.badgeBg + ';' +
          'display:flex;align-items:center;justify-content:center;margin-bottom:16px;' +
          'font-size:18px;color:' + PAL.brand + '">&#x2713;</div>' +
          '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:' + PAL.ink + '">' +
          "You're unsubscribed</h1>" +
          '<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:' + PAL.muted + '">' +
          "You won't receive further emails from this site.</p>" +
          // Same signed params, so the click that just proved this is really
          // this recipient's link doubles as the resubscribe link — no new
          // token, no second email round-trip (AGL-2499).
          `<a href="/api/email/resubscribe?${escapeAttribute(query)}" ` +
          'style="font-size:13px;color:' + PAL.link + ';text-decoration:none">' +
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

  const { hostId, email, signature, campaignId } = readParams(req)
  const secret =
    process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET
  if (!hostId || !email || !signature || !secret) {
    return res.status(400).send('Invalid link')
  }
  // The SAME verifier the unsubscribe uses, because this link is minted by
  // handing the unsubscribe's own signed query to a second route. Two
  // implementations of one signature scheme is how the resubscribe link comes
  // to reject a signature the unsubscribe link just accepted.
  if (!signatureMatches({ hostId, email, campaignId, signature, secret })) {
    return res.status(403).send('Invalid link')
  }

  const query =
    `hostId=${encodeURIComponent(hostId)}` +
    `&email=${encodeURIComponent(email)}` +
    `&sig=${encodeURIComponent(signature)}` +
    (campaignId ? `&cid=${encodeURIComponent(campaignId)}` : '')

  if (method !== 'POST') {
    // SAFE, same reasoning as the unsubscribe GET: a prescanner must not be
    // able to resubscribe someone either.
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(
      page(
        '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:' + PAL.ink + '">' +
          'Resubscribe?</h1>' +
          `<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:${PAL.muted}">` +
          `Start receiving emails from this site again at <strong style="color:${PAL.ink}">` +
          `${escapeAttribute(email)}</strong>.</p>` +
          `<form method="post" action="/api/email/resubscribe?${escapeAttribute(
            query,
          )}">` +
          '<button type="submit" style="font:inherit;font-size:14px;font-weight:600;' +
          'padding:11px 20px;border:0;border-radius:8px;background:' + PAL.link + ';color:' + PAL.onBrand + ';' +
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
          '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:' + PAL.ink + '">' +
            "Can't resubscribe this address</h1>" +
            '<p style="margin:0;font-size:14px;line-height:1.5;color:' + PAL.muted + '">' +
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
        '<div style="width:40px;height:40px;border-radius:50%;background:' + PAL.badgeBg + ';' +
          'display:flex;align-items:center;justify-content:center;margin-bottom:16px;' +
          'font-size:18px;color:' + PAL.brand + '">&#x2713;</div>' +
          '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:' + PAL.ink + '">' +
          "You're resubscribed</h1>" +
          '<p style="margin:0;font-size:14px;line-height:1.5;color:' + PAL.muted + '">' +
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

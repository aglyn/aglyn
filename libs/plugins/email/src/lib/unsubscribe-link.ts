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
 * The SIGNED-LINK primitives every recipient-facing email route shares.
 *
 * Three routes read the same link — `email/unsubscribe`, `email/resubscribe`
 * and `email/preferences` — and every one of them verifies the same HMAC,
 * derives the same suppression key, and renders the same branded shell. They
 * live here rather than in one route's module because the alternative is what
 * the resubscribe route's docblock already warns about: "Two implementations
 * of one signature scheme is how the resubscribe link comes to reject a
 * signature the unsubscribe link just accepted."
 *
 * Nothing here touches Firestore. That is deliberate — the verification and
 * the rendering are pure, so a spec can exercise the signature scheme without
 * standing up a database double.
 */

import { personKey, type PluginApiHandler } from '@aglyn/aglyn/server'
import { BRAND } from '@aglyn/shared-data-enums'
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Suppression list keys are the SHA-256 of the normalized address (emails are
 * PII).
 *
 * `personKey` and NOT a fourth local `createHash` call. D5 of
 * `docs/specs/email-competitive-gaps.md` records two derivations that agree
 * only by luck: this module's predecessor hashed the address without
 * lowercasing or trimming, `campaign-send.ts` lowercased, and the two matched
 * only because `performCampaignSend` lowercases every address upstream before
 * the link is minted. The preference page is a THIRD caller, and the
 * instruction that comes with a third caller is to unify rather than to add a
 * variant.
 *
 * The digest is unchanged for every address these routes have ever seen —
 * `readParams` already trims and lowercases, which is exactly what
 * `normalizeContactEmail` does — so no stored suppression moves.
 *
 * @returns the key, or `null` for a value that is not an address. The old
 *          local helper hashed anything it was handed, which meant a
 *          malformed `email` parameter addressed a suppression document for a
 *          person who does not exist.
 */
export function suppressionKeyFor(email: string): string | null {
  return personKey(email)
}

/** Minimal HTML-attribute escaping for the values echoed into a page. */
export function escapeAttribute(value: string): string {
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
 * {@link page} below — not new colors. They have to be literal hex because
 * this is email-adjacent HTML served without a stylesheet: no CSS variables,
 * no theme provider, so `theme.palette.*` cannot reach the wire. Naming them
 * here keeps that unavoidable literal to ONE place per color instead of once
 * per use, which is also what keeps this file under the AGL-2025 color
 * ratchet.
 *
 * A `const` is not a style slot, so the ratchet does not count these — and
 * that is the point: the check exists to catch a color typed inline where a
 * token would do, not a documented email palette.
 */
export const PAL = {
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
  /** Hairline between the preference page's topic rows. */
  divider: '#E0E0E0',
} as const

/**
 * Branded shell (AGL-2411): the plain `system-ui` box this used to be read as
 * an unstyled error page, not a page this product owns — which matters here
 * specifically, because this is the one screen a recipient who does NOT trust
 * the sender is looking at. `BRAND.ORG_NAME` rather than a literal "Aglyn": a
 * self-host operator's deployment must show ITS name here, not ours (see
 * `@aglyn/shared-data-enums`'s `BRAND`, already the pattern the staff email
 * designer's sample links follow). Colors are the console theme's actual
 * tokens (`consoleOptions.palette` in `console.theme.ts`), not new ones.
 *
 * `maxWidth` widens for the preference page, which is a list of choices rather
 * than a single sentence and a button.
 */
export function page(body: string, maxWidth = 420): string {
  const brandName = escapeAttribute(BRAND.ORG_NAME)
  return (
    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${brandName}</title>` +
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    `background:${PAL.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,` +
    'Helvetica,Arial,sans-serif;padding:24px;box-sizing:border-box">' +
    `<div style="max-width:${maxWidth}px;width:100%;background:${PAL.cardBg};border-radius:12px;` +
    'padding:36px 32px;box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06)">' +
    `<div style="font-size:15px;font-weight:700;letter-spacing:.02em;color:${PAL.brand};` +
    `margin-bottom:4px">${brandName}</div>` +
    `<div style="width:32px;height:3px;border-radius:2px;background:${PAL.accentRule};` +
    'margin-bottom:24px"></div>' +
    body +
    '</div></div>'
  )
}

/** A heading in the shell's type scale. */
export function heading(text: string): string {
  return (
    `<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${PAL.ink}">` +
    `${text}</h1>`
  )
}

/** Body copy in the shell's type scale. */
export function paragraph(html: string, marginBottom = 24): string {
  return (
    `<p style="margin:0 0 ${marginBottom}px;font-size:14px;line-height:1.5;` +
    `color:${PAL.muted}">${html}</p>`
  )
}

/** The success checkmark badge the result pages open with. */
export function successBadge(): string {
  return (
    `<div style="width:40px;height:40px;border-radius:50%;background:${PAL.badgeBg};` +
    'display:flex;align-items:center;justify-content:center;margin-bottom:16px;' +
    `font-size:18px;color:${PAL.brand}">&#x2713;</div>`
  )
}

/** A full-width submit button in either the brand or the link fill. */
export function submitButton(
  label: string,
  options?: { name?: string; value?: string; accent?: 'brand' | 'link' },
): string {
  const background = options?.accent === 'link' ? PAL.link : PAL.brand
  return (
    '<button type="submit"' +
    (options?.name ? ` name="${escapeAttribute(options.name)}"` : '') +
    (options?.value ? ` value="${escapeAttribute(options.value)}"` : '') +
    ' style="font:inherit;font-size:14px;font-weight:600;' +
    `padding:11px 20px;border:0;border-radius:8px;background:${background};` +
    `color:${PAL.onBrand};cursor:pointer;width:100%">${label}</button>`
  )
}

/** Headers every one of these pages sets: never indexed, never cached. */
export function sendPage(
  res: Parameters<PluginApiHandler>[1],
  html: string,
): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Never indexed, never cached — the page names the recipient's address.
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).send(html)
}

/** Everything the signed link carries. */
export interface UnsubscribeLinkParams {
  hostId: string
  email: string
  signature: string
  campaignId: string
  topicId: string
}

/**
 * The link's parameters, from the query for both verbs and from the form body
 * as a fallback.
 *
 * The one-click POST keeps the full query string (it posts to the header URL
 * verbatim), and so does the confirmation form's action — so query-first is
 * the path both real callers take. The body fallback exists so a form posted
 * to the bare path still works rather than failing as an invalid link.
 */
export function readParams(
  req: Parameters<PluginApiHandler>[0],
): UnsubscribeLinkParams {
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
    // `tid` names the STREAM the message belonged to. Absent on every link
    // minted before topics existed, on the same footing as `cid`.
    topicId: pick('tid').trim(),
  }
}

/**
 * The subject a signature covers, or `null` when the parameters cannot make
 * one unambiguously.
 *
 * ## Three signed forms, and why that is not a weakening
 *
 * A link minted before campaign attribution existed signs `hostId:email`. A
 * link minted since signs `hostId:email:campaignId`. A link minted since
 * topics signs `hostId:email:campaignId:topicId`. All three are in inboxes
 * right now and all three have to keep working — an email is not recallable,
 * and an unsubscribe link that has stopped honoring itself is the one failure
 * in this area nobody gets to shrug at.
 *
 * Which form is checked is decided by the LINK, not by the signature: the
 * arity of the subject follows exactly which of `cid` and `tid` the URL
 * carries. There is no fallback between the forms, and that is what stops
 * this being a downgrade — an attacker cannot take a three-part link, drop
 * the `cid` and have it verify, because the two-part check over the same
 * `hostId:email` produces a different digest. Nor can they bolt a `cid` or a
 * `tid` onto a shorter link: the longer check then fails.
 *
 * ## What makes the three forms unambiguous
 *
 * The forms are joined with `:`, so a `cid` or `tid` that CONTAINED a colon
 * would let one subject string be read as two different parameter tuples —
 * a four-part `host:email:c:t` is byte-identical to a three-part subject
 * whose campaign id is `c:t`. That is the edit this function has to refuse:
 * an attacker holding a topic link could otherwise re-present it as a
 * campaign link with the topic spliced into the campaign id, and the topic
 * they were signed for would silently become something else.
 *
 * So a colon in either id is refused outright, on every form. It costs
 * nothing real: campaign ids come from `createResourceUid()`, which is
 * `nanoid`'s `A-Za-z0-9_-` alphabet, and `isEmailTopicId` refuses a colon at
 * the point a topic is created.
 *
 * A `tid` with no `cid` is refused for the same reason — the empty middle
 * component would make `host:email::t` and a campaign id of `:t` the same
 * string. Every link the send path mints carries both.
 */
export function signedSubject(params: {
  hostId: string
  email: string
  campaignId: string
  topicId: string
}): string | null {
  const { hostId, email, campaignId, topicId } = params
  if (campaignId.includes(':') || topicId.includes(':')) return null
  if (topicId && !campaignId) return null
  if (topicId) return `${hostId}:${email}:${campaignId}:${topicId}`
  if (campaignId) return `${hostId}:${email}:${campaignId}`
  return `${hostId}:${email}`
}

/**
 * Whether a signature is this link's.
 *
 * `timingSafeEqual` needs equal lengths, so the length is compared first — it
 * is not a secret, both digests are fixed-width hex, and the call throws on a
 * mismatch rather than returning false.
 */
export function signatureMatches(args: {
  hostId: string
  email: string
  campaignId: string
  topicId: string
  signature: string
  secret: string
}): boolean {
  const subject = signedSubject(args)
  if (subject === null) return false
  const expected = createHmac('sha256', args.secret)
    .update(subject)
    .digest('hex')
  return (
    expected.length === args.signature.length &&
    timingSafeEqual(
      new Uint8Array(Buffer.from(expected)),
      new Uint8Array(Buffer.from(args.signature)),
    )
  )
}

/**
 * The signed parameters, re-encoded for a form action or a sibling link.
 *
 * Every id rides through to the POST form, the preference page and the
 * resubscribe link, because the signature covers them: dropping one would
 * produce a URL whose shorter check fails against a longer signature, i.e. a
 * confirmation button that refuses itself.
 */
export function signedQuery(params: UnsubscribeLinkParams): string {
  return (
    `hostId=${encodeURIComponent(params.hostId)}` +
    `&email=${encodeURIComponent(params.email)}` +
    `&sig=${encodeURIComponent(params.signature)}` +
    (params.campaignId ? `&cid=${encodeURIComponent(params.campaignId)}` : '') +
    (params.topicId ? `&tid=${encodeURIComponent(params.topicId)}` : '')
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
export function isCampaignPathId(value: string): boolean {
  return (
    !!value &&
    value.length <= 1500 &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..' &&
    !/^__.*__$/.test(value)
  )
}

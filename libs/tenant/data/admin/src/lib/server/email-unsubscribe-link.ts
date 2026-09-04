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
 * THE UNSUBSCRIBE LINK — one signer, one URL shape, one verifier.
 *
 * A signed `/api/email/unsubscribe` URL was minted in exactly one place, the
 * campaign sender, and verified in another, the unsubscribe handler. Two
 * copies of an HMAC subject is a shape that only stays correct while nobody
 * adds a third caller — and the marketing gate is the third caller, so the
 * subject moved here and both existing sides now read it from one place.
 *
 * ## The address is lowercased in the subject AND in the URL
 *
 * This is the property that makes one derivation work rather than two that
 * agree by luck. The campaign sender lowercases every address far upstream,
 * so its links have always carried a lowercase address and its signature has
 * always covered one; the handler's verifier does not lowercase, and did not
 * need to. Marketing mail reaches addresses that no upstream step
 * normalized — a checkout's `customerEmail`, a form payload's `email` — so a
 * link minted over `Bob@Example.com` would sign the lowercase form and put
 * the mixed-case form on the URL, and the verifier would answer 403 to a
 * recipient pressing Unsubscribe.
 *
 * So {@link buildUnsubscribeUrl} writes the lowercased address into the query
 * as well as into the subject, and the two agree by construction rather than
 * by every caller remembering.
 */

import { createHmac, timingSafeEqual } from 'crypto'

/**
 * The shared secret, or empty when the deployment has none.
 *
 * `CRON_SECRET` is the documented fallback, matching what the campaign sender
 * and the unsubscribe handler already resolve. Read per call rather than at
 * module load: these run in serverless handlers where the module may be
 * evaluated during a build, long before the runtime env exists.
 */
export function unsubscribeLinkSecret(): string {
  return process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || ''
}

/**
 * The signed subject for an unsubscribe link.
 *
 * ## Two signed forms, and why the campaign id is additive
 *
 * Every email already sitting in an inbox carries a two-part signature over
 * `hostId:email`, and those links must go on working forever — an unsubscribe
 * link that stops honoring itself is the one bug in this area with a legal
 * edge on it. So the campaign is appended only when it is present, and the
 * verifier chooses which form to check by whether the link carries a `cid`.
 *
 * SIGNED rather than passed alongside. An unsigned `cid` would be an
 * attribution anybody holding one valid link could point at any campaign they
 * liked — a small forgery, and a completely gratuitous one, since the
 * campaign is already known at the moment the link is minted.
 */
export function unsubscribeSignatureSubject(
  hostId: string,
  email: string,
  campaignId?: string,
  topicId?: string,
): string {
  const address = String(email ?? '')
    .trim()
    .toLowerCase()
  /*
   * A colon in either id is refused outright, because the forms are joined
   * with one. A four-part `host:email:c:t` is byte-identical to a three-part
   * subject whose campaign id is `c:t`, so one signature would verify two
   * different parameter tuples and a topic link could be re-presented as a
   * campaign link with the topic spliced in. It costs nothing real: ids come
   * from `createResourceUid()`, whose alphabet has no colon.
   *
   * A topic with no campaign DROPS the topic rather than producing a
   * four-part subject with an empty middle, which would make
   * `host:email::t` and a campaign id of `:t` the same string. The sender
   * always has a campaign, so this is a guard rather than a path.
   */
  const campaign = String(campaignId ?? '')
  const topic = String(topicId ?? '')
  if (campaign.includes(':') || topic.includes(':')) return ''
  if (topic && campaign) return `${hostId}:${address}:${campaign}:${topic}`
  if (campaign) return `${hostId}:${address}:${campaign}`
  return `${hostId}:${address}`
}

/** HMAC for unsubscribe links; env-gated on the shared secret. */
export function unsubscribeSignature(
  hostId: string,
  email: string,
  secret: string,
  campaignId?: string,
  topicId?: string,
): string {
  const subject = unsubscribeSignatureSubject(hostId, email, campaignId, topicId)
  // An unsignable subject yields no signature rather than a signature over the
  // empty string, which would verify for every caller that also passed one.
  if (!subject) return ''
  return createHmac('sha256', secret).update(subject).digest('hex')
}

/**
 * Whether a signature is this link's.
 *
 * Which form is checked is decided by the LINK, not by the signature: a link
 * carrying no `cid` is checked against the two-part form and a link carrying
 * one against the three-part form. There is no fallback between them, and
 * that is what stops this being a downgrade — an attacker cannot take a
 * three-part link, drop the `cid` and have it verify, because the two-part
 * check over the same `hostId:email` produces a different digest. Nor can
 * they bolt a `cid` onto a two-part link: the three-part check then fails.
 *
 * `timingSafeEqual` needs equal lengths, so the length is compared first — it
 * is not a secret, both digests are fixed-width hex, and the call throws on a
 * mismatch rather than returning false.
 */
export function unsubscribeSignatureMatches(args: {
  hostId: string
  email: string
  campaignId?: string
  signature: string
  secret: string
}): boolean {
  const expected = unsubscribeSignature(
    args.hostId,
    args.email,
    args.secret,
    args.campaignId || undefined,
  )
  return (
    expected.length === args.signature.length &&
    timingSafeEqual(
      new Uint8Array(Buffer.from(expected)),
      new Uint8Array(Buffer.from(args.signature)),
    )
  )
}

/**
 * The purpose component that distinguishes a CONFIRMATION subject.
 *
 * See {@link confirmSignatureSubject}. Exported because the plugin's verifier
 * imports it rather than restating the literal.
 */
export const CONFIRM_SUBJECT_PREFIX = 'confirm'

/**
 * The signed subject for a double opt-in confirmation link.
 *
 * ## Why it is not one of the three forms above
 *
 * A confirmation names a host, an address and a topic, and it has NO
 * campaign — nobody is unsubscribing from a message, they are joining a
 * stream. The forms above refuse exactly that combination: a topic with no
 * campaign would leave an empty middle component, and `host:email::t` is the
 * same string as a three-part subject whose campaign id is `:t`.
 *
 * So it gets a leading PURPOSE component. That is a fourth form of the same
 * scheme, not a second scheme: the digest, the secret and the comparison are
 * unchanged.
 *
 * ## The one collision, and the guard for it
 *
 * `confirm:H:E:T` is byte-identical to the four-part unsubscribe subject
 * `A:B:C:D` when the site's id is literally `confirm`, which would let one
 * signature verify as both. Ids are not ours to constrain after the fact, so
 * the subject is refused for that host rather than the collision being
 * reasoned about: the cost is one unusable document id, and the alternative
 * is a signature that means two things.
 *
 * @returns the subject, or `''` for a combination it cannot sign
 *          unambiguously. Empty rather than a partial subject, so
 *          {@link confirmSignature} yields no signature rather than one over
 *          the empty string — which would verify for every other caller that
 *          also produced one.
 */
export function confirmSignatureSubject(
  hostId: string,
  email: string,
  topicId: string,
): string {
  const address = String(email ?? '')
    .trim()
    .toLowerCase()
  const host = String(hostId ?? '')
  const topic = String(topicId ?? '')
  if (!host || !address || !topic) return ''
  if (host === CONFIRM_SUBJECT_PREFIX) return ''
  if (host.includes(':') || topic.includes(':')) return ''
  return `${CONFIRM_SUBJECT_PREFIX}:${host}:${address}:${topic}`
}

/** HMAC for a confirmation link; empty for an unsignable subject. */
export function confirmSignature(
  hostId: string,
  email: string,
  topicId: string,
  secret: string,
): string {
  const subject = confirmSignatureSubject(hostId, email, topicId)
  if (!subject || !secret) return ''
  return createHmac('sha256', secret).update(subject).digest('hex')
}

/**
 * The absolute confirmation URL for one address and one topic.
 *
 * Minted where the signup happens, because the message carrying it is sent
 * from there — and that message is TRANSACTIONAL, not marketing: the person
 * just asked for this, so asking them to confirm it is the transaction they
 * started. It carries no unsubscribe header for the same reason a receipt
 * does not.
 *
 * Empty when there is no secret or no origin, for the reason
 * {@link buildUnsubscribeUrl} gives: a link pointing at nothing is worse than
 * no link, because the recipient believes they have confirmed.
 */
export function buildConfirmUrl(input: {
  siteBase: string
  hostId: string
  email: string
  topicId: string
  /** Defaults to {@link unsubscribeLinkSecret} — the same signing secret. */
  secret?: string
}): string {
  const secret = input.secret ?? unsubscribeLinkSecret()
  const siteBase = String(input.siteBase ?? '').replace(/\/+$/, '')
  const address = String(input.email ?? '')
    .trim()
    .toLowerCase()
  const signature = confirmSignature(
    input.hostId,
    address,
    input.topicId,
    secret,
  )
  if (!siteBase || !signature) return ''
  return (
    `${siteBase}/api/email/confirm` +
    `?hostId=${encodeURIComponent(input.hostId)}` +
    `&email=${encodeURIComponent(address)}` +
    `&tid=${encodeURIComponent(input.topicId)}` +
    `&sig=${signature}`
  )
}

/**
 * The absolute unsubscribe URL for one recipient of one site's mail.
 *
 * @returns the URL, or empty string when there is no secret to sign with or
 *          no origin to resolve against. Empty rather than a half-built URL:
 *          a caller can tell it does not have a link, and a link pointing at
 *          nothing is worse than an absent header, because the recipient
 *          believes they have unsubscribed.
 */
export function buildUnsubscribeUrl(input: {
  siteBase: string
  hostId: string
  email: string
  /** The campaign this link rides in, when there is one. */
  campaignId?: string
  /** The topic the message belonged to, when it belonged to one. */
  topicId?: string
  /**
   * Which of the two URLs over this one signature to build.
   *
   * `one-click` is what the `List-Unsubscribe` header names: a mailbox
   * provider POSTs it with no human present and expects the act to have
   * happened when it reads the 200, so it points at the route whose POST
   * writes immediately and must never point at a page somebody has to submit.
   * `preferences` is the link a PERSON clicks in the footer, where the topic
   * this message belonged to is one of the things they can stop instead of
   * all of it. Defaults to `one-click`, which is what a sender with no topic
   * — every non-campaign marketing path — wants.
   */
  surface?: 'one-click' | 'preferences'
  /** Defaults to {@link unsubscribeLinkSecret}. */
  secret?: string
}): string {
  const secret = input.secret ?? unsubscribeLinkSecret()
  const siteBase = String(input.siteBase ?? '').replace(/\/+$/, '')
  const address = String(input.email ?? '')
    .trim()
    .toLowerCase()
  if (!secret || !siteBase || !input.hostId || !address) return ''
  const signature = unsubscribeSignature(
    input.hostId,
    address,
    secret,
    input.campaignId,
    input.topicId,
  )
  if (!signature) return ''
  const route =
    input.surface === 'preferences'
      ? '/api/email/preferences'
      : '/api/email/unsubscribe'
  return (
    `${siteBase}${route}` +
    `?hostId=${encodeURIComponent(input.hostId)}` +
    `&email=${encodeURIComponent(address)}` +
    `&sig=${signature}` +
    (input.campaignId ? `&cid=${encodeURIComponent(input.campaignId)}` : '') +
    (input.topicId ? `&tid=${encodeURIComponent(input.topicId)}` : '')
  )
}

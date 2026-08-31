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
/*
 * The MODULE, not the barrel. `@aglyn/aglyn` re-exports the app-utils index,
 * which reaches `enabled-plugins-context` and therefore React — and this file
 * is loaded by the plugin API route's SERVER graph, where a client-only
 * module is a bundle `app-router-graph.spec.ts` refuses. Every name here is a
 * pure function or a constant that lives in one leaf file.
 */
import {
  activeEmailTopics,
  mergeEmailTopics,
  normalizeEmailTopic,
  readTopicSubscriptionState,
  resolveCampaignTopic,
  EMAIL_TOPICS_COLLECTION,
  TOPIC_OPT_OUTS_SUBCOLLECTION,
  type EmailTopic,
  type TopicSubscriptionEntry,
} from '@aglyn/aglyn/app-utils/email-topics'
import {
  confirmTopicSubscription,
  EMAIL_FREQUENCY_SUBCOLLECTION,
  firebaseAdmin,
  resolveOrgIdForHost,
  setMarketingCadence,
  UNSUBSCRIBE_SUPPRESSION_REASON,
  type ConfirmTopicResult,
} from '@aglyn/tenant-data-admin'
/*
 * The pure cadence rule from the shared email library, where the SEND path
 * reads it too. The preference page and the gate must agree about what
 * `'weekly'` means down to the coercion of a malformed value, and two copies
 * of that is how a page comes to record a choice the gate does not recognize.
 */
import {
  normalizeMarketingCadence,
  type MarketingCadence,
} from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'
import {
  escapeAttribute,
  heading,
  isCampaignPathId,
  page,
  paragraph,
  PAL,
  PLATFORM_EMAIL_BRAND,
  readParams,
  resolveEmailPageBrand,
  sendPage,
  signatureMatches,
  signedQuery,
  submitButton,
  successBadge,
  suppressionKeyFor,
  type EmailBrandSource,
  type EmailPageBrand,
  type EmailPalette,
  type UnsubscribeLinkParams,
} from './unsubscribe-link'

/**
 * One-click unsubscribe (AGL-161), split into a safe GET and a mutating POST
 * (AGL-2408), with a preference center in front of the human-facing half.
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
 * So: GET renders a page carrying a same-URL POST form, and only the POST
 * writes. A prescanner following any of these three links now renders a page
 * and changes nothing. That property is not negotiable and every handler in
 * this file holds it.
 *
 * ## RFC 8058 one-click
 *
 * Gmail's and Yahoo's bulk-sender rules ask for `List-Unsubscribe` PLUS
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and a client honoring
 * that pair sends a POST to the header URL with `List-Unsubscribe=One-Click`
 * as an `application/x-www-form-urlencoded` body. `unsubscribeHandler`'s POST
 * branch is exactly what that lands on — which is why the two halves had to be
 * fixed together: turning the GET into a confirmation page without accepting
 * POST would have broken unsubscribe outright, and advertising one-click while
 * the only mutating verb was GET would have been the same bug with a header on
 * top.
 *
 * THE PREFERENCE CENTER IS NOT IN THAT PATH, and must never be. The
 * `List-Unsubscribe` header still names `email/unsubscribe`, whose POST acts
 * immediately with no page in between; the preference center is what the
 * FOOTER link in the message body points at, where a human is present to make
 * a choice. Routing the header at a page of checkboxes would be advertising
 * one-click against a surface that cannot honor it — a mailbox provider POSTs
 * that URL with nobody watching, reads a 200, and reports the recipient
 * unsubscribed when nothing was written.
 *
 * The one-click POST carries no `Origin` header (it is sent by the mailbox
 * provider's servers, not a browser), which the dispatcher's same-origin gate
 * deliberately allows; the forms' POSTs are same-origin. Neither needs a CSRF
 * token beyond the HMAC already in the URL: a caller who cannot produce `sig`
 * cannot unsubscribe anyone, and a caller who can is holding the recipient's
 * own mail.
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

/** Read from both verbs; the secret the link was signed with. */
function linkSecret(): string {
  return process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || ''
}

/**
 * Params + suppression key, or the status to answer with.
 *
 * Every one of these routes opens the same way — read, check the secret is
 * configured, verify the HMAC, key the address — and every one of them has to
 * do it before touching Firestore. A shared preamble is also what keeps the
 * three from drifting into three slightly different ideas of a valid link.
 */
interface OpenedLink {
  /**
   * The status to answer with, or 0 when the link is good.
   *
   * A refusal CODE rather than a discriminated union: this library compiles
   * with `strictNullChecks: false`, under which a `{ok: true} | {ok: false}`
   * union does not narrow on a truthiness check, so the union shape would
   * type-error at every call site that read the status.
   */
  refusal: number
  params: UnsubscribeLinkParams
  key: string
}

function openSignedLink(req: Parameters<PluginApiHandler>[0]): OpenedLink {
  const params = readParams(req)
  const secret = linkSecret()
  const refuse = (status: number): OpenedLink => ({
    refusal: status,
    params,
    key: '',
  })
  if (!params.hostId || !params.email || !params.signature || !secret) {
    return refuse(400)
  }
  if (!signatureMatches({ ...params, secret })) return refuse(403)
  // `personKey` refuses a value that is not an address rather than hashing it,
  // so a signed link naming a malformed address is a bad link and not a
  // suppression document for a person who does not exist.
  const key = suppressionKeyFor(params.email)
  if (!key) return refuse(400)
  return { refusal: 0, params, key }
}

/**
 * How long the shell will wait for the sending site's identity.
 *
 * A branded page is worth one host read; it is not worth a page that never
 * arrives. These four routes are the recipient's only way to stop the mail, so
 * an unbranded page rendered promptly beats a correct one that hangs behind a
 * slow read — the timeout falls back rather than failing.
 */
const BRAND_READ_TIMEOUT_MS = 1500

/**
 * The SENDING SITE's identity for the shell, not ours.
 *
 * One read of `hosts/{hostId}`, and every failure mode lands on the same
 * answer: no host id, a missing document, a read that throws, a read that is
 * slow, or a host that has simply set no brand all resolve to
 * {@link PLATFORM_EMAIL_BRAND}. That is also the self-host answer, so the
 * fallback path is the one an operator runs every day rather than a branch
 * only reached when something is broken.
 */
async function loadHostBrand(hostId: string): Promise<EmailPageBrand> {
  if (!hostId) return PLATFORM_EMAIL_BRAND
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const firestore = firebaseAdmin.app().firestore()
    const snapshot = await Promise.race([
      firestore.collection('hosts').doc(hostId).get(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), BRAND_READ_TIMEOUT_MS)
      }),
    ])
    if (!snapshot?.exists) return PLATFORM_EMAIL_BRAND
    // The id LAST: it addresses the `media:` logo reference, and the copy of
    // it stored in the document is the one that can be stale or absent.
    return resolveEmailPageBrand({
      ...(snapshot.data() as EmailBrandSource),
      $id: hostId,
    })
  } catch (error) {
    console.error('[email] host brand read failed', error)
    return PLATFORM_EMAIL_BRAND
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const unsubscribeHandler: PluginApiHandler = async (req, res) => {
  const method = String(req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return void res.status(405).send('Method not allowed')
  }

  const opened = openSignedLink(req)
  if (opened.refusal) {
    return void res.status(opened.refusal).send('Invalid unsubscribe link')
  }
  const { params, key } = opened
  const { hostId, email, campaignId, topicId } = params
  const query = signedQuery(params)

  if (method !== 'POST') {
    // SAFE. A prescanner lands here and nothing is written — the brand read
    // is the only Firestore access on this path, and it is a read.
    const brand = await loadHostBrand(hostId)
    return void sendPage(
      res,
      page(
        heading('Unsubscribe?') +
          paragraph(
            `Confirm that <strong style="color:${PAL.ink}">${escapeAttribute(
              email,
            )}</strong> should stop receiving emails from ` +
            `<strong style="color:${PAL.ink}">${escapeAttribute(
              brand.name,
            )}</strong>.`,
          ) +
          `<form method="post" action="/api/email/unsubscribe?${escapeAttribute(
            query,
          )}">` +
          submitButton('Unsubscribe', { pal: brand.pal }) +
          '</form>' +
          // The way to a NARROWER choice, offered on the page rather than only
          // in the message footer: a recipient who reached the total
          // unsubscribe from a mail client's own link has never been shown
          // that leaving one stream is possible.
          `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;text-align:center">` +
          `<a href="/api/email/preferences?${escapeAttribute(query)}" ` +
          `style="color:${brand.pal.link};text-decoration:none">` +
          'Choose which emails to stop instead</a></p>',
        420,
        brand,
      ),
    )
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const [created, brand] = await Promise.all([
      writeSiteSuppression(firestore, hostId, key, {
        email,
        campaignId,
        topicId,
      }),
      loadHostBrand(hostId),
    ])

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
     * behavior wanted: the count for a campaign nobody can open has no
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
    return void sendPage(
      res,
      page(
        successBadge(brand.pal) +
          heading("You're unsubscribed") +
          paragraph(
            `You won't receive further emails from ${escapeAttribute(
              brand.name,
            )}.`,
            20,
          ) +
          // Same signed params, so the click that just proved this is really
          // this recipient's link doubles as the resubscribe link — no new
          // token, no second email round-trip (AGL-2499).
          `<a href="/api/email/resubscribe?${escapeAttribute(query)}" ` +
          `style="font-size:13px;color:${brand.pal.link};text-decoration:none">` +
          'Changed your mind? Resubscribe</a>',
        420,
        brand,
      ),
    )
  } catch (error) {
    console.error(error)
    return void res.status(500).send('Unsubscribe failed — please try again')
  }
}

/**
 * The whole-site suppression, written the same way from both routes that
 * write one.
 *
 * `reason: 'unsubscribe'` is written explicitly (AGL-2410). The Resend webhook
 * stamps `'bounce'` / `'complaint'`, and until now an unsubscribe was the only
 * entry with no reason at all — so a reader had to infer one from an absent
 * field, which is a rule that holds only while nothing else ever forgets to
 * write it.
 *
 * `createdAt` is written only when the document is new, matching
 * `email-events.ts`: a bounce arriving after an unsubscribe must not restamp
 * the date the person actually unsubscribed, and neither must a second click
 * on the same link.
 *
 * @returns WHETHER THIS CLICK CREATED THE SUPPRESSION, decided inside the
 *          transaction and used outside it. It is the idempotency the campaign
 *          counter needs, and it comes for free because the transaction
 *          already reads the document to decide whether to stamp `createdAt`.
 *          A second click on the same link — and there will be second clicks,
 *          from a person pressing the button twice and from a client
 *          re-POSTing a one-click header — finds the entry present and
 *          contributes nothing, so `stats.unsubscribes` counts PEOPLE who left
 *          rather than button presses.
 */
async function writeSiteSuppression(
  firestore: any,
  hostId: string,
  key: string,
  fields: { email: string; campaignId: string; topicId: string },
): Promise<boolean> {
  const ref = firestore
    .collection('hosts')
    .doc(hostId)
    .collection('suppressions')
    .doc(key)
  /*
   * Assigned rather than or-ed inside the body because a Firestore
   * transaction may retry, and the reading that counts is the one whose write
   * committed.
   */
  let created = false
  await firestore.runTransaction(async (transaction: any) => {
    const existing = await transaction.get(ref)
    created = !existing.exists
    transaction.set(
      ref,
      {
        email: fields.email,
        reason: UNSUBSCRIBE_SUPPRESSION_REASON,
        suppressedAt: FieldValue.serverTimestamp(),
        // WHICH mailing they left over. Written on the suppression itself as
        // well as counted on the campaign, so the Suppressions list can answer
        // "why did this person go" for one address without the aggregate — and
        // stamped only when this click created the entry, so a re-click cannot
        // re-attribute an old unsubscribe to whatever link the person happened
        // to press second. `topicId` rides along on the same rule: it is the
        // stream that lost them, which is the finer half of the same question.
        ...(existing.exists
          ? {}
          : {
              createdAt: FieldValue.serverTimestamp(),
              ...(fields.campaignId ? { campaignId: fields.campaignId } : {}),
              ...(fields.topicId ? { topicId: fields.topicId } : {}),
            }),
      },
      { merge: true },
    )
  })
  return created
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
    return void res.status(405).send('Method not allowed')
  }

  // The SAME verifier the unsubscribe uses, because this link is minted by
  // handing the unsubscribe's own signed query to a second route. Two
  // implementations of one signature scheme is how the resubscribe link comes
  // to reject a signature the unsubscribe link just accepted.
  const opened = openSignedLink(req)
  if (opened.refusal) {
    return void res.status(opened.refusal).send('Invalid link')
  }
  const { params, key } = opened
  const { hostId, email } = params
  const query = signedQuery(params)

  if (method !== 'POST') {
    // SAFE, same reasoning as the unsubscribe GET: a prescanner must not be
    // able to resubscribe someone either.
    const brand = await loadHostBrand(hostId)
    return void sendPage(
      res,
      page(
        heading('Resubscribe?') +
          paragraph(
            `Start receiving emails from <strong style="color:${PAL.ink}">` +
              `${escapeAttribute(brand.name)}</strong> again at ` +
              `<strong style="color:${PAL.ink}">${escapeAttribute(
                email,
              )}</strong>.`,
          ) +
          `<form method="post" action="/api/email/resubscribe?${escapeAttribute(
            query,
          )}">` +
          submitButton('Resubscribe', { accent: 'link', pal: brand.pal }) +
          '</form>',
        420,
        brand,
      ),
    )
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const [released, brand] = await Promise.all([
      releaseSiteSuppression(firestore, hostId, key),
      loadHostBrand(hostId),
    ])
    if (!released) {
      return void sendPage(res, page(protectedAddressBody(), 420, brand))
    }
    return void sendPage(
      res,
      page(
        successBadge(brand.pal) +
          heading("You're resubscribed") +
          paragraph(
            `You'll receive emails from ${escapeAttribute(
              brand.name,
            )} again.`,
            0,
          ),
        420,
        brand,
      ),
    )
  } catch (error) {
    console.error(error)
    return void res.status(500).send('Resubscribe failed — please try again')
  }
}

/**
 * Lift a whole-site suppression, or refuse to.
 *
 * THE ONE RULE THAT IS NOT A PREFERENCE. A `bounce` or `complaint` entry says
 * the mailbox is dead or its owner pressed "report spam", and neither is a
 * setting the person on the other end of a link may change. Both are the
 * sending domain's protection — one shared domain under `p=reject` for every
 * tenant — so honoring a resubscribe over one would be handing the recipient a
 * lever on somebody else's deliverability. Every path that puts an address
 * back in circulation goes through here so that there is exactly one place the
 * rule is stated.
 *
 * @returns false when the record was left standing because it is not an
 *          unsubscribe.
 */
async function releaseSiteSuppression(
  firestore: any,
  hostId: string,
  key: string,
): Promise<boolean> {
  const ref = firestore
    .collection('hosts')
    .doc(hostId)
    .collection('suppressions')
    .doc(key)
  const snapshot = await ref.get()
  if (
    snapshot.exists &&
    snapshot.get('reason') !== UNSUBSCRIBE_SUPPRESSION_REASON
  ) {
    return false
  }
  // Idempotent whether or not a doc existed — a resubscribe click on an
  // address that was never suppressed (or already resubscribed) is not an
  // error, it is the state the visitor wanted.
  await ref.delete()
  return true
}

/** Shown wherever a resubscribe is refused, so the wording is one wording. */
function protectedAddressBody(): string {
  return (
    heading("Can't resubscribe this address") +
    paragraph(
      'This address was suppressed by a delivery problem, not an ' +
        'unsubscribe, so it can’t be re-added from this link. Contact ' +
        'the site directly if this looks wrong.',
      0,
    )
  )
}

/**
 * THE PREFERENCE CENTER — the page the message footer links to.
 *
 * ## What it is for
 *
 * `docs/specs/email-competitive-gaps.md` §1f: every product compared has a
 * preference center and we had one lever, marked all-or-nothing. The cost of
 * that is not a missing feature, it is a misdirected one — the recipient who
 * only wanted the sales mail to stop had to stop everything, and the recipient
 * who did not want to stop everything pressed "report spam" instead, which is
 * a complaint on a shared sending domain.
 *
 * ## What it may show, and what it must not
 *
 * Reached with no session, by anyone holding the link. The HMAC is what
 * authorizes it, and it covers exactly the host, the address, the campaign and
 * the topic — so the page shows the org's topic CATALOG and this address's
 * opt-out state against it, and nothing else. Not the contact record, not the
 * lists they are on, not their name, not whether we have ever heard of them.
 *
 * It is not an enumeration oracle for two reasons that both have to hold. A
 * caller cannot ask about an address they do not already hold a signed link
 * for; and the page renders IDENTICALLY for an address with no records at all
 * — an unknown address reads as "subscribed to everything", which is both the
 * truthful answer and the one that reveals nothing. There is deliberately no
 * "we don't have that address" branch, because that branch is the oracle.
 */
const preferencesHandler: PluginApiHandler = async (req, res) => {
  const method = String(req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return void res.status(405).send('Method not allowed')
  }

  const opened = openSignedLink(req)
  if (opened.refusal) {
    return void res.status(opened.refusal).send('Invalid preferences link')
  }
  const { params, key } = opened
  const { hostId, email, campaignId, topicId } = params
  const query = signedQuery(params)

  try {
    const firestore = firebaseAdmin.app().firestore()
    // Three independent reads, so they go together rather than in series —
    // the brand is not worth a third round trip on the page a recipient is
    // waiting for.
    const [catalog, state, brand] = await Promise.all([
      loadTopicCatalog(firestore, hostId),
      readSubscriptionState(firestore, hostId, key),
      loadHostBrand(hostId),
    ])
    const topics = activeEmailTopics(catalog)

    if (method !== 'POST') {
      // SAFE. Reads only, exactly like the other two GETs.
      return void sendPage(
        res,
        page(
          preferencesFormBody({ email, query, topics, state, topicId, brand }),
          520,
          brand,
        ),
      )
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    if (String(body['action'] ?? '') === 'all') {
      const created = await writeSiteSuppression(firestore, hostId, key, {
        email,
        campaignId,
        topicId,
      })
      if (created && isCampaignPathId(campaignId)) {
        await firestore
          .collection('hosts')
          .doc(hostId)
          .collection('campaigns')
          .doc(campaignId)
          .update({ 'stats.unsubscribes': FieldValue.increment(1) })
          .catch(() => undefined)
      }
      return void sendPage(
        res,
        page(
          successBadge(brand.pal) +
            heading('Sorry to see you go') +
            paragraph(
              `<strong style="color:${PAL.ink}">${escapeAttribute(email)}</strong> ` +
                'has been unsubscribed from every email ' +
                `${escapeAttribute(brand.name)} sends.`,
              20,
            ) +
            paragraph(
              'Changed your mind? ' +
                `<a href="/api/email/resubscribe?${escapeAttribute(query)}" ` +
                `style="color:${brand.pal.link};text-decoration:none">` +
                'Resubscribe</a>, or ' +
                `<a href="/api/email/preferences?${escapeAttribute(query)}" ` +
                `style="color:${brand.pal.link};text-decoration:none">` +
                'pick just the emails you want</a>.',
              0,
            ),
          420,
          brand,
        ),
      )
    }

    /*
     * A CHECKED BOX MEANS "KEEP SENDING", so the opt-outs are the complement.
     *
     * Read off the catalog rather than off the form, deliberately. A browser
     * submits nothing at all for an unchecked box, so a form that named only
     * the boxes to TURN OFF would be indistinguishable from a form where the
     * recipient turned everything off — and the two mean opposite things.
     */
    const keep = new Set(
      topics
        .map((topic) => topic.id)
        .filter((id) => String(body[`topic:${id}`] ?? '') !== ''),
    )
    const drop = topics.filter((topic) => !keep.has(topic.id))
    await writeTopicOptOuts(firestore, hostId, key, {
      email,
      optOut: drop.map((topic) => topic.id),
      resume: [...keep],
    })

    /*
     * HOW OFTEN, recorded from the same submit as WHAT.
     *
     * They are one decision — "less of this, and less often" — so they are
     * one form and one round trip. It is stored on the send counter rather
     * than beside the topic opt-outs because that is the document the send
     * path already reads for every marketing message, which is what makes
     * honoring the request free at the point it has to be honored.
     *
     * A value that is not a cadence lands on `'all'` rather than erroring:
     * this page is reached with no session by anybody holding the link, so
     * `body` is untrusted, and the failure a recipient must not meet on the
     * screen they came to in order to leave is a 500.
     */
    const cadence = normalizeMarketingCadence(body['cadence'])
    const cadenceStored = await setMarketingCadence(hostId, email, cadence)

    /*
     * A person asking for SOME mail is asking not to be suppressed from ALL of
     * it, so a whole-site unsubscribe standing against this address is lifted
     * — through the same guard the resubscribe route uses, which refuses to
     * touch a bounce or a complaint. Without this the page would accept a
     * choice it could not honor: every box ticked, and the send path still
     * dropping the address at the site suppression one layer above topics.
     */
    let stillBlocked = false
    if (keep.size) {
      stillBlocked = !(await releaseSiteSuppression(firestore, hostId, key))
    }

    return void sendPage(
      res,
      page(
        successBadge(brand.pal) +
          heading(drop.length ? 'Sorry to see you go' : 'Preferences saved') +
          paragraph(
            changeSummary({ email, keep: [...keep], drop, topics }),
            cadence === 'all' && cadenceStored ? 20 : 8,
          ) +
          /*
           * The pace is reported only when it is a CHOICE. "As they come" is
           * the default and the absence, so announcing it would tell somebody
           * who touched nothing that they had just asked for something.
           */
          (cadence !== 'all' && cadenceStored
            ? paragraph(
                `They will arrive no more than ${cadenceSentence(cadence)}.`,
                20,
              )
            : '') +
          (!cadenceStored
            ? paragraph(
                'One thing we could not change: how often these arrive. Your ' +
                  'other choices are saved — come back to this page to try ' +
                  'that one again.',
                20,
              )
            : '') +
          (stillBlocked
            ? paragraph(
                'One thing we could not change: this address is on hold ' +
                  'because an earlier message could not be delivered or was ' +
                  'reported as spam. Contact the site directly if that looks ' +
                  'wrong.',
                20,
              )
            : '') +
          paragraph(
            'Changed your mind? ' +
              `<a href="/api/email/preferences?${escapeAttribute(query)}" ` +
              `style="color:${brand.pal.link};text-decoration:none">` +
              'Come back to this page</a> and tick the boxes again — this ' +
              'link keeps working.',
            0,
          ),
        520,
        brand,
      ),
    )
  } catch (error) {
    console.error(error)
    return void res.status(500).send('Preferences failed — please try again')
  }
}

/**
 * The org's topic catalog for a site.
 *
 * Two reads, both fail-soft to the built-in defaults. A site with no owning
 * org, an org with no stored topics, or a Firestore hiccup all land on the
 * same page: the four built-ins, every box ticked. That is the right failure —
 * a preference page that renders NO topics offers the recipient nothing to
 * uncheck, which turns the one screen they came to in order to leave a stream
 * into a dead end.
 */
async function loadTopicCatalog(
  firestore: any,
  hostId: string,
): Promise<EmailTopic[]> {
  try {
    const orgId = await resolveOrgIdForHost(hostId)
    if (!orgId) return mergeEmailTopics(null)
    const snapshot = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection(EMAIL_TOPICS_COLLECTION)
      .get()
    const stored = (snapshot?.docs ?? [])
      .map((doc: any) => normalizeEmailTopic(doc.id, doc.data()))
      .filter((topic: EmailTopic | null): topic is EmailTopic => !!topic)
    return mergeEmailTopics(stored)
  } catch (error) {
    console.error('[email/preferences] topic catalog read failed', error)
    return mergeEmailTopics(null)
  }
}

/** What this address currently receives from this site. */
interface SubscriptionState {
  /** A whole-site suppression stands. */
  suppressed: boolean
  /**
   * The suppression is a bounce or a complaint, so nothing on this page may
   * lift it.
   */
  protectedRecord: boolean
  /** Topic ids this address has left and not rejoined. */
  optedOut: Set<string>
  /**
   * Topic ids this address was asked to confirm and has not.
   *
   * Held apart from {@link optedOut} even though neither is mailable, because
   * the page says something different about each: one is a choice the person
   * made and the other is a question they have not answered.
   */
  pending: Set<string>
  /** The pace this address last asked for, or `'all'` for never asked. */
  cadence: MarketingCadence
}

/** How a chosen cadence reads inside a sentence about what will happen. */
function cadenceSentence(cadence: MarketingCadence): string {
  return cadence === 'daily'
    ? 'one a day'
    : cadence === 'weekly'
      ? 'one a week'
      : 'one a month'
}

/**
 * All three per-site records for one address, in three keyed `get()`s.
 *
 * By document id rather than a query, matching `filterSendableForHost`: no
 * composite index to go missing, and nothing that can fail open on a read
 * window. The third is the send counter, which is where the recipient's
 * chosen pace lives — see `EmailFrequencyRecord.cadence` for why it is stored
 * on the document the send path already reads rather than on this page's own.
 */
async function readSubscriptionState(
  firestore: any,
  hostId: string,
  key: string,
): Promise<SubscriptionState> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const [suppression, optOuts, frequency] = await Promise.all([
    hostRef.collection('suppressions').doc(key).get(),
    hostRef.collection(TOPIC_OPT_OUTS_SUBCOLLECTION).doc(key).get(),
    hostRef
      .collection(EMAIL_FREQUENCY_SUBCOLLECTION)
      .doc(key)
      .get()
      // The pace is the one field on this page whose absence is a legitimate
      // answer, so a read that fails renders the default rather than an
      // error — the recipient still gets their topic checkboxes.
      .catch(() => null),
  ])
  const stored = (optOuts?.exists ? optOuts.get('topics') : null) ?? {}
  const optedOut = new Set<string>()
  const pending = new Set<string>()
  for (const [id, record] of Object.entries(
    stored as Record<string, TopicSubscriptionEntry | null>,
  )) {
    /*
     * The shared reader, not a field test. An entry with a `resubscribedAt`
     * is EVIDENCE of an opt-out that has been lifted rather than a live one —
     * see `writeTopicOptOuts` for why the entry stays — and an entry with a
     * `confirmedAt` carries the same shape of evidence for a confirmation.
     * Only one function knows all three states.
     */
    const state = readTopicSubscriptionState(record)
    if (state === 'opted-out') optedOut.add(id)
    if (state === 'pending') pending.add(id)
  }
  return {
    suppressed: !!suppression?.exists,
    protectedRecord:
      !!suppression?.exists &&
      suppression.get('reason') !== UNSUBSCRIBE_SUPPRESSION_REASON,
    optedOut,
    pending,
    cadence: normalizeMarketingCadence(
      frequency?.exists ? frequency.get('cadence') : null,
    ),
  }
}

/**
 * Record the recipient's per-topic choices.
 *
 * ## The record is EVIDENCE, so nothing is removed
 *
 * `email-suppression.ts` makes the argument for the suppression lists: "a
 * revocation is a FIELD and not a delete, because the record is the evidence
 * that the suppression was honored while it was in force." A topic opt-out is
 * the same kind of fact — somebody asked us to stop, and the answer to "did
 * you honor it" has to survive them changing their mind later. So rejoining a
 * topic stamps `resubscribedAt` on the existing entry rather than deleting it,
 * and the pair of timestamps is the window the request was in force for.
 *
 * One document per address, a map keyed by topic, rather than a document per
 * (address, topic): the send path reads this by key alongside the suppression
 * lists, and one `get()` per address is what keeps a topic-filtered send the
 * same cost as an unfiltered one.
 *
 * ## Ticking a box here IS the confirmation a double opt-in asks for
 *
 * The entry also carries a pending-confirmation pair, and a recipient who
 * ticks a topic on this page has done more than the confirmation link asks:
 * they clicked a signed link delivered to that mailbox and then made a
 * choice in it. Leaving them pending would mean the page recorded a
 * subscription the send path refuses — a form whose submit does not take
 * effect, which this page refuses to be anywhere else. So a resumed topic
 * that is still pending is confirmed here, stamped with the moment they did
 * it.
 *
 * ## Every write CARRIES the entry forward
 *
 * Each branch spreads the previous entry rather than replacing it. Two pairs
 * of timestamps now live on one entry, and a branch that wrote only its own
 * pair would silently discard the other — an opt-out would erase the record
 * that somebody confirmed, and the erasure would look exactly like a person
 * who never confirmed.
 */
async function writeTopicOptOuts(
  firestore: any,
  hostId: string,
  key: string,
  fields: { email: string; optOut: string[]; resume: string[] },
): Promise<void> {
  const ref = firestore
    .collection('hosts')
    .doc(hostId)
    .collection(TOPIC_OPT_OUTS_SUBCOLLECTION)
    .doc(key)
  await firestore.runTransaction(async (transaction: any) => {
    const existing = await transaction.get(ref)
    const stored = ((existing.exists ? existing.get('topics') : null) ??
      {}) as Record<string, Record<string, unknown>>
    const topics: Record<string, unknown> = {}
    for (const id of fields.optOut) {
      const previous = stored[id]
      /*
       * Already opted out and never rejoined: leave the original timestamp
       * alone. Re-submitting the same form must not restamp the date the
       * person actually left, for the reason `createdAt` is not restamped on
       * the suppression.
       *
       * The state reader, not "an entry with no `resubscribedAt`". That
       * shorthand reads a CONFIRMED double opt-in — which carries `pendingAt`
       * and `confirmedAt` and no `resubscribedAt` — as somebody who had
       * already left, so unticking their box would record no opt-out at all
       * and the send path would go on mailing them.
       */
      topics[id] =
        readTopicSubscriptionState(previous) === 'opted-out'
          ? previous
          : {
              ...(previous ?? {}),
              optedOutAt: FieldValue.serverTimestamp(),
              resubscribedAt: null,
            }
    }
    for (const id of fields.resume) {
      const previous = stored[id]
      if (!previous) continue
      const state = readTopicSubscriptionState(previous)
      if (state === 'pending') {
        topics[id] = { ...previous, confirmedAt: Date.now() }
        continue
      }
      topics[id] = previous['resubscribedAt']
        ? previous
        : { ...previous, resubscribedAt: FieldValue.serverTimestamp() }
    }
    transaction.set(
      ref,
      {
        email: fields.email,
        // The whole map, not a merge of one key: a topic the recipient
        // rejoined has to lose its live status, and a dotted merge cannot
        // express "these and no others" for a map whose keys are data.
        topics: { ...stored, ...topics },
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing.exists
          ? {}
          : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    )
  })
}

/** One topic row: a checkbox, its name and its description. */
function topicRow(
  topic: EmailTopic,
  checked: boolean,
  highlighted: boolean,
  /**
   * Asked to confirm and has not.
   *
   * The box is EMPTY for a pending topic, because empty is the truth: the
   * send path refuses this stream until it is confirmed, and a ticked box
   * over a stream nothing will send would be the page telling a lie the
   * recipient can only discover by waiting for mail that never comes. The
   * note beside it is what turns "not ticked" from a puzzle into an answer,
   * and ticking it here confirms — see `writeTopicOptOuts`.
   */
  pending = false,
  pal: EmailPalette = PAL,
): string {
  return (
    `<label style="display:flex;gap:12px;align-items:flex-start;padding:14px 0;` +
    `border-top:1px solid ${PAL.divider};cursor:pointer">` +
    `<input type="checkbox" name="topic:${escapeAttribute(topic.id)}" value="on"` +
    (checked ? ' checked' : '') +
    ' style="margin:2px 0 0;width:18px;height:18px;flex:none">' +
    '<span style="flex:1">' +
    `<span style="display:block;font-size:14px;font-weight:600;color:${PAL.ink}">` +
    escapeAttribute(topic.name) +
    (highlighted
      ? `<span style="margin-left:8px;font-size:11px;font-weight:600;` +
        `text-transform:uppercase;letter-spacing:.04em;color:${pal.link}">` +
        'This email</span>'
      : '') +
    '</span>' +
    (pending
      ? `<span style="display:block;margin-top:2px;font-size:13px;line-height:1.45;` +
        `color:${PAL.muted}">Waiting for you to confirm — tick this and save ` +
        'to start receiving it.</span>'
      : '') +
    (topic.description
      ? `<span style="display:block;margin-top:2px;font-size:13px;line-height:1.45;` +
        `color:${PAL.muted}">${escapeAttribute(topic.description)}</span>`
      : '') +
    '</span></label>'
  )
}

/**
 * HOW OFTEN — the half of the preference center that shipped without.
 *
 * `docs/specs/email-competitive-gaps.md` G10: the frequency CAP shipped and
 * this did not, so a recipient who wanted the same mail less often had two
 * options and one of them was the spam button.
 *
 * Radio buttons rather than a select, and every option written out. The whole
 * value of the control is that somebody skimming a footer link can see, in
 * one glance, that "less" is available at all — a collapsed select says only
 * that there is a setting.
 *
 * The default option is named ("As they come") rather than left as the empty
 * choice, because a radio group whose default is unlabeled reads as a
 * question the recipient has not answered, and answering it is not something
 * this page should require of somebody who came here to uncheck one box.
 */
function cadenceFieldset(current: MarketingCadence): string {
  const option = (value: MarketingCadence, label: string): string =>
    `<label style="display:flex;gap:12px;align-items:center;padding:10px 0;cursor:pointer">` +
    `<input type="radio" name="cadence" value="${escapeAttribute(value)}"` +
    (value === current ? ' checked' : '') +
    ' style="margin:0;width:18px;height:18px;flex:none">' +
    `<span style="font-size:14px;color:${PAL.ink}">${label}</span></label>`
  return (
    `<div style="border-top:1px solid ${PAL.divider};padding-top:18px;margin-top:6px">` +
    `<div style="font-size:14px;font-weight:600;color:${PAL.ink};margin-bottom:2px">` +
    'How often' +
    '</div>' +
    `<div style="font-size:13px;line-height:1.45;color:${PAL.muted};margin-bottom:6px">` +
    'This applies to everything above. Nothing is canceled — messages just ' +
    'wait until the next one is due.' +
    '</div>' +
    option('all', 'As they come') +
    option('daily', 'At most one a day') +
    option('weekly', 'At most one a week') +
    option('monthly', 'At most one a month') +
    '</div>'
  )
}

/** The preference page's body. */
function preferencesFormBody(args: {
  email: string
  query: string
  topics: EmailTopic[]
  state: SubscriptionState
  topicId: string
  brand: EmailPageBrand
}): string {
  const { email, query, topics, state, topicId, brand } = args
  const pal = brand.pal
  // A bounce or a complaint is not a preference, so the page does not pretend
  // the recipient can edit their way out of one. Shown instead of the form
  // rather than beside it: a form whose submit cannot take effect is worse
  // than no form.
  if (state.protectedRecord) return protectedAddressBody()
  const current = resolveCampaignTopic(topicId, topics)
  const action = `/api/email/preferences?${escapeAttribute(query)}`
  return (
    heading('Email preferences') +
    paragraph(
      `Choose what <strong style="color:${PAL.ink}">${escapeAttribute(
        email,
      )}</strong> should keep receiving from ` +
        `<strong style="color:${PAL.ink}">${escapeAttribute(
          brand.name,
        )}</strong>. Unticked emails stop; everything else carries on.`,
      8,
    ) +
    (state.suppressed
      ? paragraph(
          'You are currently unsubscribed from everything. Tick anything ' +
            'below to start receiving it again.',
          8,
        )
      : '') +
    `<form method="post" action="${action}">` +
    topics
      .map((topic) =>
        topicRow(
          topic,
          // A whole-site suppression outranks the per-topic record, so an
          // unsubscribed recipient sees every box empty — which is the state
          // they are actually in, and the state the form must round-trip. An
          // unconfirmed topic is empty for the same reason: the send path
          // refuses it, so a ticked box would not be what is true.
          !state.suppressed &&
            !state.optedOut.has(topic.id) &&
            !state.pending.has(topic.id),
          topic.id === current.id,
          !state.suppressed && state.pending.has(topic.id),
          pal,
        ),
      )
      .join('') +
    /*
     * HOW OFTEN, inside the same form as WHAT.
     *
     * The alternative to letting somebody choose "monthly" is letting them
     * choose "report spam", and on a shared sending domain under `p=reject`
     * that choice is charged to every other tenant. It sits under the topics
     * because it is the smaller decision of the two and a recipient who has
     * already found the thing they wanted to stop should not have to read
     * past a frequency question to stop it.
     */
    cadenceFieldset(state.cadence) +
    `<div style="border-top:1px solid ${PAL.divider};padding-top:20px;margin-top:6px">` +
    submitButton('Save my preferences', { pal }) +
    '</div></form>' +
    // A SECOND form, not a second button in the first one. Sharing the form
    // would submit the checkbox state along with the "everything" action, so a
    // browser that fell back to the first submit button — or a user pressing
    // Return in the form — would send an ambiguous request. Two forms make the
    // two intentions two requests.
    `<form method="post" action="${action}" style="margin-top:12px">` +
    '<input type="hidden" name="action" value="all">' +
    '<button type="submit" style="font:inherit;font-size:13px;font-weight:600;' +
    `padding:10px 20px;border:1px solid ${PAL.divider};border-radius:8px;` +
    `background:transparent;color:${PAL.muted};cursor:pointer;width:100%">` +
    'Unsubscribe from everything</button></form>'
  )
}

/** What the result page tells the recipient actually changed. */
function changeSummary(args: {
  email: string
  keep: string[]
  drop: EmailTopic[]
  topics: EmailTopic[]
}): string {
  const address = `<strong style="color:${PAL.ink}">${escapeAttribute(
    args.email,
  )}</strong>`
  if (!args.drop.length) {
    return `${address} keeps receiving everything this site sends.`
  }
  const names = args.drop
    .map((topic) => escapeAttribute(topic.name))
    .join(', ')
  if (!args.keep.length) {
    return (
      `${address} has been unsubscribed from ${names} — everything this ` +
      'site currently sends.'
    )
  }
  return `${address} will stop receiving ${names}, and keeps the rest.`
}

/**
 * `email/confirm` — the click that turns a pending subscription into a real
 * one (`docs/specs/email-competitive-gaps.md` P8).
 *
 * Same signed-link shape as its three siblings and the same safe-GET /
 * mutating-POST split, which matters here for exactly the reason it mattered
 * to the unsubscribe: a security gateway fetching every URL in the message
 * would otherwise confirm the subscription on the recipient's behalf, and a
 * confirmation nobody made is the one thing a double opt-in exists to
 * prevent. A prescanner following this link renders a page and changes
 * nothing.
 *
 * The subject it verifies is the confirmation form — see
 * `signedConfirmSubject` for why a topic without a campaign needs one — and
 * it is checked through the same comparison every other link goes through.
 */
const confirmHandler: PluginApiHandler = async (req, res) => {
  const method = String(req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return void res.status(405).send('Method not allowed')
  }

  const params = readParams(req)
  const secret = linkSecret()
  if (!params.hostId || !params.email || !params.signature || !secret) {
    return void res.status(400).send('Invalid confirmation link')
  }
  if (!signatureMatches({ ...params, secret, purpose: 'confirm' })) {
    return void res.status(403).send('Invalid confirmation link')
  }
  if (!suppressionKeyFor(params.email)) {
    return void res.status(400).send('Invalid confirmation link')
  }
  const { hostId, email, topicId } = params
  const query = signedQuery(params)

  try {
    const firestore = firebaseAdmin.app().firestore()
    const [catalog, brand] = await Promise.all([
      loadTopicCatalog(firestore, hostId),
      loadHostBrand(hostId),
    ])
    const topic = resolveCampaignTopic(topicId, catalog)

    if (method !== 'POST') {
      // SAFE. A prescanner lands here and confirms nothing.
      return void sendPage(
        res,
        page(
          heading('Confirm your subscription') +
            paragraph(
              `Confirm that <strong style="color:${PAL.ink}">${escapeAttribute(
                email,
              )}</strong> should receive ` +
                `<strong style="color:${PAL.ink}">${escapeAttribute(
                  topic.name,
                )}</strong> from ` +
                `<strong style="color:${PAL.ink}">${escapeAttribute(
                  brand.name,
                )}</strong>.`,
            ) +
            `<form method="post" action="/api/email/confirm?${escapeAttribute(
              query,
            )}">` +
            submitButton('Yes, subscribe me', { pal: brand.pal }) +
            '</form>',
          420,
          brand,
        ),
      )
    }

    const outcome = await confirmTopicSubscription(hostId, email, topicId)
    return void sendPage(
      res,
      page(confirmationBody(outcome, topic.name, brand.pal), 420, brand),
    )
  } catch (error) {
    console.error(error)
    return void res.status(500).send('Confirmation failed — please try again')
  }
}

/**
 * What each outcome tells the person in front of it.
 *
 * Every arm names what is TRUE rather than what went wrong. Somebody who
 * clicked an expired link has not made a mistake, and somebody who clicked
 * twice has not either — telling either of them "invalid" would read as the
 * subscription having failed when the first case needs a fresh signup and the
 * second is already done.
 */
function confirmationBody(
  outcome: ConfirmTopicResult,
  topicName: string,
  pal: EmailPalette = PAL,
): string {
  const stream = `<strong style="color:${PAL.ink}">${escapeAttribute(
    topicName,
  )}</strong>`
  switch (outcome) {
    case 'confirmed':
      return (
        successBadge(pal) +
        heading("You're subscribed") +
        paragraph(`You'll start receiving ${stream} from this site.`, 0)
      )
    case 'already-confirmed':
      return (
        successBadge(pal) +
        heading('Already confirmed') +
        paragraph(`${stream} is already on its way to you.`, 0)
      )
    case 'expired':
      return (
        heading('This link has expired') +
        paragraph(
          `Confirmation links are good for three days. Sign up again and ` +
            `we'll send a fresh one — you are not subscribed to ${stream} in ` +
            'the meantime.',
          0,
        )
      )
    case 'opted-out':
      return (
        heading("Can't subscribe this address") +
        paragraph(
          `This address asked to stop receiving ${stream} from this site, so ` +
            'a confirmation link cannot put it back. Sign up again if that ' +
            'was not what you meant.',
          0,
        )
      )
    default:
      return (
        heading('Nothing to confirm') +
        paragraph(
          `There is no pending request for ${stream} at this address. If you ` +
            'meant to subscribe, sign up on the site.',
          0,
        )
      )
  }
}

/** Registers the email plugin's public API routes (AGL-396). */
export function registerEmailApi(): void {
  registerPluginApiRoute('email/unsubscribe', unsubscribeHandler)
  registerPluginApiRoute('email/resubscribe', resubscribeHandler)
  registerPluginApiRoute('email/preferences', preferencesHandler)
  registerPluginApiRoute('email/confirm', confirmHandler)
}

/*
 * The CONSOLE half of the same `email` prefix, kept in its own module.
 *
 * Two audiences, one entry point: the tenant loads this file for
 * `registerEmailApi` (the signed unsubscribe links a recipient clicks, no
 * session behind them), and the console loads it for
 * `registerEmailConsoleApi` (list membership, behind an org-wide role). The
 * manifest generator resolves both surfaces through `@aglyn/plugins-email/server`,
 * so this re-export is what makes the console half reachable — a second entry
 * point would be a second thing to keep in step with plugins.config.json.
 */
export {
  registerEmailConsoleApi,
  emailListMembersAddHandler,
  emailListMembersPreviewHandler,
  emailListRulePreviewHandler,
  CONSOLE_ADD_SOURCE,
  LIST_MEMBER_BATCH_MAX,
} from './server-console'

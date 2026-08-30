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
import {
  activeEmailTopics,
  mergeEmailTopics,
  normalizeEmailTopic,
  resolveCampaignTopic,
  EMAIL_TOPICS_COLLECTION,
  TOPIC_OPT_OUTS_SUBCOLLECTION,
  type EmailTopic,
} from '@aglyn/aglyn'
import { firebaseAdmin, resolveOrgIdForHost } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  escapeAttribute,
  heading,
  isCampaignPathId,
  page,
  paragraph,
  PAL,
  readParams,
  sendPage,
  signatureMatches,
  signedQuery,
  submitButton,
  successBadge,
  suppressionKeyFor,
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
    // SAFE. A prescanner lands here and nothing is written.
    return void sendPage(
      res,
      page(
        heading('Unsubscribe?') +
          paragraph(
            `Confirm that <strong style="color:${PAL.ink}">${escapeAttribute(
              email,
            )}</strong> should stop receiving emails from this site.`,
          ) +
          `<form method="post" action="/api/email/unsubscribe?${escapeAttribute(
            query,
          )}">` +
          submitButton('Unsubscribe') +
          '</form>' +
          // The way to a NARROWER choice, offered on the page rather than only
          // in the message footer: a recipient who reached the total
          // unsubscribe from a mail client's own link has never been shown
          // that leaving one stream is possible.
          `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;text-align:center">` +
          `<a href="/api/email/preferences?${escapeAttribute(query)}" ` +
          `style="color:${PAL.link};text-decoration:none">` +
          'Choose which emails to stop instead</a></p>',
      ),
    )
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const created = await writeSiteSuppression(firestore, hostId, key, {
      email,
      campaignId,
      topicId,
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
        successBadge() +
          heading("You're unsubscribed") +
          paragraph("You won't receive further emails from this site.", 20) +
          // Same signed params, so the click that just proved this is really
          // this recipient's link doubles as the resubscribe link — no new
          // token, no second email round-trip (AGL-2499).
          `<a href="/api/email/resubscribe?${escapeAttribute(query)}" ` +
          `style="font-size:13px;color:${PAL.link};text-decoration:none">` +
          'Changed your mind? Resubscribe</a>',
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
        reason: 'unsubscribe',
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
    return void sendPage(
      res,
      page(
        heading('Resubscribe?') +
          paragraph(
            'Start receiving emails from this site again at ' +
              `<strong style="color:${PAL.ink}">${escapeAttribute(
                email,
              )}</strong>.`,
          ) +
          `<form method="post" action="/api/email/resubscribe?${escapeAttribute(
            query,
          )}">` +
          submitButton('Resubscribe', { accent: 'link' }) +
          '</form>',
      ),
    )
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const released = await releaseSiteSuppression(firestore, hostId, key)
    if (!released) return void sendPage(res, page(protectedAddressBody()))
    return void sendPage(
      res,
      page(
        successBadge() +
          heading("You're resubscribed") +
          paragraph("You'll receive emails from this site again.", 0),
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
  if (snapshot.exists && snapshot.get('reason') !== 'unsubscribe') return false
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
    const topics = activeEmailTopics(await loadTopicCatalog(firestore, hostId))
    const state = await readSubscriptionState(firestore, hostId, key)

    if (method !== 'POST') {
      // SAFE. Reads only, exactly like the other two GETs.
      return void sendPage(
        res,
        page(preferencesFormBody({ email, query, topics, state, topicId }), 520),
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
          successBadge() +
            heading('Sorry to see you go') +
            paragraph(
              `<strong style="color:${PAL.ink}">${escapeAttribute(email)}</strong> ` +
                'has been unsubscribed from every email this site sends.',
              20,
            ) +
            paragraph(
              'Changed your mind? ' +
                `<a href="/api/email/resubscribe?${escapeAttribute(query)}" ` +
                `style="color:${PAL.link};text-decoration:none">` +
                'Resubscribe</a>, or ' +
                `<a href="/api/email/preferences?${escapeAttribute(query)}" ` +
                `style="color:${PAL.link};text-decoration:none">` +
                'pick just the emails you want</a>.',
              0,
            ),
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
        successBadge() +
          heading(drop.length ? 'Sorry to see you go' : 'Preferences saved') +
          paragraph(
            changeSummary({ email, keep: [...keep], drop, topics }),
            20,
          ) +
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
              `style="color:${PAL.link};text-decoration:none">` +
              'Come back to this page</a> and tick the boxes again — this ' +
              'link keeps working.',
            0,
          ),
        520,
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
}

/**
 * Both per-site records for one address, in two keyed `get()`s.
 *
 * By document id rather than a query, matching `filterSendableForHost`: no
 * composite index to go missing, and nothing that can fail open on a read
 * window.
 */
async function readSubscriptionState(
  firestore: any,
  hostId: string,
  key: string,
): Promise<SubscriptionState> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const [suppression, optOuts] = await Promise.all([
    hostRef.collection('suppressions').doc(key).get(),
    hostRef.collection(TOPIC_OPT_OUTS_SUBCOLLECTION).doc(key).get(),
  ])
  const stored = (optOuts?.exists ? optOuts.get('topics') : null) ?? {}
  const optedOut = new Set<string>()
  for (const [id, record] of Object.entries(
    stored as Record<string, { resubscribedAt?: unknown } | null>,
  )) {
    // An entry with a `resubscribedAt` is EVIDENCE of an opt-out that has been
    // lifted, not a live one. See `writeTopicOptOuts` for why the entry stays.
    if (record && !record.resubscribedAt) optedOut.add(id)
  }
  return {
    suppressed: !!suppression?.exists,
    protectedRecord:
      !!suppression?.exists && suppression.get('reason') !== 'unsubscribe',
    optedOut,
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
      // Already opted out and never rejoined: leave the original timestamp
      // alone. Re-submitting the same form must not restamp the date the
      // person actually left, for the reason `createdAt` is not restamped on
      // the suppression.
      topics[id] =
        previous && !previous['resubscribedAt']
          ? previous
          : { optedOutAt: FieldValue.serverTimestamp(), resubscribedAt: null }
    }
    for (const id of fields.resume) {
      const previous = stored[id]
      if (!previous) continue
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
        `text-transform:uppercase;letter-spacing:.04em;color:${PAL.link}">` +
        'This email</span>'
      : '') +
    '</span>' +
    (topic.description
      ? `<span style="display:block;margin-top:2px;font-size:13px;line-height:1.45;` +
        `color:${PAL.muted}">${escapeAttribute(topic.description)}</span>`
      : '') +
    '</span></label>'
  )
}

/** The preference page's body. */
function preferencesFormBody(args: {
  email: string
  query: string
  topics: EmailTopic[]
  state: SubscriptionState
  topicId: string
}): string {
  const { email, query, topics, state, topicId } = args
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
      )}</strong> should keep receiving from this site. ` +
        'Unticked emails stop; everything else carries on.',
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
          // they are actually in, and the state the form must round-trip.
          !state.suppressed && !state.optedOut.has(topic.id),
          topic.id === current.id,
        ),
      )
      .join('') +
    `<div style="border-top:1px solid ${PAL.divider};padding-top:20px;margin-top:6px">` +
    submitButton('Save my preferences') +
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

/** Registers the email plugin's public API routes (AGL-396). */
export function registerEmailApi(): void {
  registerPluginApiRoute('email/unsubscribe', unsubscribeHandler)
  registerPluginApiRoute('email/resubscribe', resubscribeHandler)
  registerPluginApiRoute('email/preferences', preferencesHandler)
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

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
  consentGroupOptOutHosts,
  soloConsentGroup,
  type ConsentGroup,
} from '@aglyn/aglyn/app-utils/consent-groups'
import {
  confirmTopicSubscription,
  consentGroupForSite,
  EMAIL_FREQUENCY_SUBCOLLECTION,
  firebaseAdmin,
  mirrorPlatformResubscribe,
  mirrorPlatformUnsubscribe,
  resolveCampaignSendRef,
  resolveOrgIdForHost,
  setMarketingCadence,
  UNSUBSCRIBE_SUPPRESSION_REASON,
  type ConfirmTopicResult,
} from '@aglyn/tenant-data-admin'
import type {
  PluginEmailStreamRejoinRequest,
  PluginEmailStreamRejoinResult,
} from '@aglyn/aglyn/plugin-manager/plugin-email-streams'
import { stampRecordEmailState } from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
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
import { escapeHtml } from '@aglyn/shared-util-tools/escape-html'
import { FieldValue } from 'firebase-admin/firestore'
import {
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

/**
 * THE SENDER A PERSON LEAVES HERE — the link site's consent group
 * (`consent-groups.ts`), or the site alone.
 *
 * An org may declare several sites ONE sender, and every capture form in the
 * group named it as one. So these pages treat it as one: an opt-out made here
 * is read by every site in it (the send paths read across the group), the
 * state shown is the group's, a way back in lifts the group's records, and
 * the page names the group rather than one of its sites.
 *
 * `consentGroupForSite` fails to the site alone, and so does this when it
 * throws. `waitMs` bounds the wait where a page only NAMES the sender, for the
 * reason {@link BRAND_READ_TIMEOUT_MS} gives; a page deciding what to read or
 * lift waits for the real answer.
 */
async function loadConsentGroup(
  hostId: string,
  waitMs?: number,
): Promise<ConsentGroup> {
  const alone = soloConsentGroup(hostId)
  const resolving = (async () => {
    try {
      return await consentGroupForSite(hostId)
    } catch (error) {
      console.error('[email] consent group read failed', error)
      return alone
    }
  })()
  if (!waitMs) return resolving
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      resolving,
      new Promise<ConsentGroup>((resolve) => {
        timer = setTimeout(() => resolve(alone), waitMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** How the pages name the sender, escaped for HTML. */
interface EmailPageSender {
  /** The group's name for a declared group, else the site's brand. */
  name: string
  /**
   * The sentence that says an act here covers every site in the group, or
   * `''` for a site alone, where the brand already says everything.
   */
  reach: string
}

/**
 * The sender as a page names it.
 *
 * The group's name is what the capture form disclosed — "You'll receive
 * marketing email from" the group — so it is the name the person knows this
 * sender by, and the one an opt-out here reaches. The site's own brand still
 * frames the page; `reach` is what stops the two names reading as a mistake.
 */
function pageSender(brand: EmailPageBrand, group: ConsentGroup): EmailPageSender {
  if (!group.declared || !group.name) {
    return { name: escapeHtml(brand.name), reach: '' }
  }
  return {
    name: escapeHtml(group.name),
    reach:
      `${escapeHtml(group.name)} sends from ${group.hostIds.length} sites, ` +
      `${escapeHtml(brand.name)} among them, and this covers all of them.`,
  }
}

/** The `reach` sentence as a paragraph, or nothing for a site alone. */
function reachParagraph(sender: EmailPageSender, gap = 20): string {
  return sender.reach ? paragraph(sender.reach, gap) : ''
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
    // SAFE. A prescanner lands here and nothing is written — the brand and
    // the consent group are the only Firestore access on this path, and both
    // are reads.
    const [brand, group] = await Promise.all([
      loadHostBrand(hostId),
      loadConsentGroup(hostId, BRAND_READ_TIMEOUT_MS),
    ])
    const sender = pageSender(brand, group)
    return void sendPage(
      res,
      page(
        heading('Unsubscribe?') +
          paragraph(
            `Confirm that <strong style="color:${PAL.ink}">${escapeHtml(
              email,
            )}</strong> should stop receiving emails from ` +
            `<strong style="color:${PAL.ink}">${sender.name}</strong>.`,
            sender.reach ? 8 : 24,
          ) +
          reachParagraph(sender, 24) +
          `<form method="post" action="/api/email/unsubscribe?${escapeHtml(
            query,
          )}">` +
          submitButton('Unsubscribe', { pal: brand.pal }) +
          '</form>' +
          // The way to a NARROWER choice, offered on the page rather than only
          // in the message footer: a recipient who reached the total
          // unsubscribe from a mail client's own link has never been shown
          // that leaving one stream is possible.
          `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;text-align:center">` +
          `<a href="/api/email/preferences?${escapeHtml(query)}" ` +
          `style="color:${brand.pal.link};text-decoration:none">` +
          'Choose which emails to stop instead</a></p>',
        420,
        brand,
      ),
    )
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    /*
     * Written against the ONE site the link names, and honored by every site
     * in its consent group: the send paths read a group's lists together, so
     * the one row is the refusal for the whole sender — and it reaches a site
     * that joins the group later, which a copy written now could not.
     */
    const [created, brand, group] = await Promise.all([
      writeSiteSuppression(firestore, hostId, key, {
        email,
        campaignId,
        topicId,
      }),
      loadHostBrand(hostId),
      loadConsentGroup(hostId, BRAND_READ_TIMEOUT_MS),
    ])
    const sender = pageSender(brand, group)

    /*
     * The campaign's own unsubscribe count.
     *
     * AFTER the suppression and with its failure swallowed, for the reason
     * the delivery webhook orders its writes the same way: the suppression is
     * the write that must happen, and a statistic must never be able to cost
     * one. A lost increment understates an unsubscribe rate; a lost
     * suppression mails somebody who asked us not to. Where the send is, and
     * why the write never creates it, is {@link countSendUnsubscribe}'s.
     */
    if (created) await countSendUnsubscribe(firestore, hostId, campaignId)
    // The account's answer about product updates, when this is the
    // platform's own marketing site (AGL-3305). After the suppression, and it
    // never throws: the list is what stops the mail.
    await mirrorPlatformUnsubscribe({ hostId, email, left: 'everything' })
    return void sendPage(
      res,
      page(
        successBadge(brand.pal) +
          heading("You're unsubscribed") +
          paragraph(
            `You won't receive further emails from ${sender.name}.`,
            sender.reach ? 8 : 20,
          ) +
          reachParagraph(sender) +
          // Same signed params, so the click that just proved this is really
          // this recipient's link doubles as the resubscribe link — no new
          // token, no second email round-trip (AGL-2499).
          `<a href="/api/email/resubscribe?${escapeHtml(query)}" ` +
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
 * One more unsubscribe on the send a link named (`cid`), never throwing.
 *
 * The link carries the site and the send id it was signed over, and nothing
 * else; the send itself is the organization's
 * (`orgs/{orgId}/campaigns/{sendId}`), or still the site's when the
 * migration has not reached it, and `resolveCampaignSendRef` finds whichever
 * holds it. A send in neither place was discarded, and there is nothing to
 * count against.
 *
 * `update()`, never a merge-set: a merge-set would re-create a send deleted
 * between the resolve and the write as a husk holding one `stats` map, and
 * `update()` refuses a missing document — the count for a send nobody can
 * open has no reader. Every failure is swallowed, because the suppression
 * has already been written and a statistic must never be able to cost one.
 */
async function countSendUnsubscribe(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  campaignId: string,
): Promise<void> {
  if (!isCampaignPathId(campaignId)) return
  try {
    const orgId = await resolveOrgIdForHost(hostId)
    const sendRef = await resolveCampaignSendRef({
      hostId,
      sendId: campaignId,
      orgId,
      firestore,
    })
    await sendRef?.update({ 'stats.unsubscribes': FieldValue.increment(1) })
  } catch {
    // The suppression is the write that mattered, and it has landed.
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
  // The same verdict on the record the person is (AGL-3245), through
  // whichever plugin keeps the workspace's records, so the record page says
  // they left. A stamp that failed is logged by the seam and costs the
  // unsubscribe nothing.
  if (created) {
    await stampRecordEmailState({
      hostId,
      email: fields.email,
      state: {
        status: 'unsubscribed',
        atMs: Date.now(),
        source: 'campaign',
        detail: fields.campaignId ? 'Unsubscribed from a campaign email.' : 'Unsubscribed by the link.',
      },
    })
  }
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
    const [brand, group] = await Promise.all([
      loadHostBrand(hostId),
      loadConsentGroup(hostId, BRAND_READ_TIMEOUT_MS),
    ])
    const sender = pageSender(brand, group)
    return void sendPage(
      res,
      page(
        heading('Resubscribe?') +
          paragraph(
            `Start receiving emails from <strong style="color:${PAL.ink}">` +
              `${sender.name}</strong> again at ` +
              `<strong style="color:${PAL.ink}">${escapeHtml(
                email,
              )}</strong>.`,
            sender.reach ? 8 : 24,
          ) +
          reachParagraph(sender, 24) +
          `<form method="post" action="/api/email/resubscribe?${escapeHtml(
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
    // The group decides which rows are lifted, so it is waited for in full.
    const groupRead = loadConsentGroup(hostId)
    const [released, brand, group] = await Promise.all([
      groupRead.then((resolved) =>
        releaseSiteSuppression(firestore, resolved, key),
      ),
      loadHostBrand(hostId),
      groupRead,
    ])
    if (!released) {
      return void sendPage(res, page(protectedAddressBody(), 420, brand))
    }
    // Restores the account's Yes only when an email door took it away and
    // product updates now reach them (AGL-3305).
    await mirrorPlatformResubscribe({ hostId, email, via: 'email-resubscribe' })
    const sender = pageSender(brand, group)
    return void sendPage(
      res,
      page(
        successBadge(brand.pal) +
          heading("You're resubscribed") +
          paragraph(
            `You'll receive emails from ${sender.name} again.`,
            sender.reach ? 8 : 0,
          ) +
          reachParagraph(sender, 0),
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
 * ## Across the consent group, all or nothing
 *
 * The send paths read every site's list in the link site's consent group, so
 * an unsubscribe filed on a sibling holds this site's mail too — and a way
 * back in that lifted only this site's row would tell the person they were
 * resubscribed while the sender went on withholding. Every site's row is
 * therefore read first, and the release happens only if none of them is a
 * record this rule may not lift: one bounce or complaint anywhere in the
 * group still holds the whole group, so lifting the unsubscribes beside it
 * would change nothing the person could see, and the page says so instead.
 *
 * @returns false when a record was left standing because it is not an
 *          unsubscribe.
 */
async function releaseSiteSuppression(
  firestore: any,
  group: ConsentGroup,
  key: string,
): Promise<boolean> {
  const [own, ...siblings] = consentGroupOptOutHosts(group).map((id) =>
    firestore.collection('hosts').doc(id).collection('suppressions').doc(key),
  )
  const [ownSnapshot, ...siblingSnapshots] = await Promise.all(
    [own, ...siblings].map((ref) => ref.get()),
  )
  if (
    [ownSnapshot, ...siblingSnapshots].some(
      (snapshot) =>
        snapshot.exists &&
        snapshot.get('reason') !== UNSUBSCRIBE_SUPPRESSION_REASON,
    )
  ) {
    return false
  }
  // Idempotent whether or not a doc existed — a resubscribe click on an
  // address that was never suppressed (or already resubscribed) is not an
  // error, it is the state the visitor wanted. A sibling's row is deleted
  // only where one stands.
  await Promise.all([
    own.delete(),
    ...siblings
      .filter((_ref, index) => siblingSnapshots[index].exists)
      .map((ref) => ref.delete()),
  ])
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
    // Independent reads, so they go together rather than in series — the
    // brand is not worth another round trip on the page a recipient is
    // waiting for. The state is the consent GROUP's, so it waits on the group.
    const groupRead = loadConsentGroup(hostId)
    const [catalog, state, brand, group] = await Promise.all([
      loadTopicCatalog(firestore, hostId),
      groupRead.then((resolved) =>
        readSubscriptionState(firestore, resolved, key),
      ),
      loadHostBrand(hostId),
      groupRead,
    ])
    const topics = activeEmailTopics(catalog)
    const sender = pageSender(brand, group)

    if (method !== 'POST') {
      // SAFE. Reads only, exactly like the other two GETs.
      return void sendPage(
        res,
        page(
          preferencesFormBody({
            email,
            query,
            topics,
            state,
            topicId,
            brand,
            sender,
          }),
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
      if (created) await countSendUnsubscribe(firestore, hostId, campaignId)
      await mirrorPlatformUnsubscribe({ hostId, email, left: 'everything' })
      return void sendPage(
        res,
        page(
          successBadge(brand.pal) +
            heading('Sorry to see you go') +
            paragraph(
              `<strong style="color:${PAL.ink}">${escapeHtml(email)}</strong> ` +
                'has been unsubscribed from every email ' +
                `${sender.name} sends.`,
              sender.reach ? 8 : 20,
            ) +
            reachParagraph(sender) +
            paragraph(
              'Changed your mind? ' +
                `<a href="/api/email/resubscribe?${escapeHtml(query)}" ` +
                `style="color:${brand.pal.link};text-decoration:none">` +
                'Resubscribe</a>, or ' +
                `<a href="/api/email/preferences?${escapeHtml(query)}" ` +
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
     * A ticked box is a stream the person wants back FROM THE SENDER, and the
     * send paths read an opt-out on any site of the consent group — so an
     * opt-out a sibling holds is lifted too, or the box would be a choice the
     * send path goes on refusing. The unticked ones are written here alone:
     * this site's record is read across the group already.
     */
    await resumeTopicsAcrossGroup(firestore, group, key, [...keep])

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
      stillBlocked = !(await releaseSiteSuppression(firestore, group, key))
    }

    /*
     * The account's answer about product updates follows what this page just
     * wrote (AGL-3305), and only on the platform's own marketing site: a No
     * when product updates is among what they left, and a Yes back only when
     * an email door took it and the list is open again. Leaving the
     * newsletter says nothing about product updates, so neither call does
     * anything for it. After every write above, so both read the outcome.
     */
    if (drop.length) {
      await mirrorPlatformUnsubscribe({
        hostId,
        email,
        left: drop.map((topic) => topic.id),
      })
    }
    if (keep.size) {
      await mirrorPlatformResubscribe({ hostId, email, via: 'email-preferences' })
    }

    return void sendPage(
      res,
      page(
        successBadge(brand.pal) +
          heading(drop.length ? 'Sorry to see you go' : 'Preferences saved') +
          paragraph(
            changeSummary({ email, keep: [...keep], drop, topics, sender }),
            cadence === 'all' && cadenceStored && !sender.reach ? 20 : 8,
          ) +
          reachParagraph(sender, cadence === 'all' && cadenceStored ? 20 : 8) +
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
              `<a href="/api/email/preferences?${escapeHtml(query)}" ` +
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
  /**
   * Throw instead of falling back. For a caller about to lift a whole-site
   * unsubscribe on the strength of the list, where the built-ins alone would
   * leave every custom stream mailable (`rejoinStreamForAccount`).
   */
  strict = false,
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
    if (strict) throw error
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
  /** The reason on that record, when there is one. */
  protectedReason: string | null
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
 * All three per-site records for one address, in three keyed `get()`s per
 * site of the link site's consent group.
 *
 * By document id rather than a query, matching `filterSendableForHost`: no
 * composite index to go missing, and nothing that can fail open on a read
 * window. The third is the send counter, which is where the recipient's
 * chosen pace lives — see `EmailFrequencyRecord.cadence` for why it is stored
 * on the document the send path already reads rather than on this page's own.
 *
 * ## The group's state, read the way the send paths read it
 *
 * The page shows what the SENDER will do, and the sender is the consent
 * group: a suppression standing on any of its sites, and a stream left on any
 * of them, holds this site's mail too, so both show here. The pace is the one
 * chosen most recently on any site's page. A pending confirmation is the link
 * site's own, as it is on the send path. A group of one is the three reads
 * this page always made.
 */
async function readSubscriptionState(
  firestore: any,
  group: ConsentGroup,
  key: string,
): Promise<SubscriptionState> {
  const sites = await Promise.all(
    consentGroupOptOutHosts(group).map((id) => {
      const hostRef = firestore.collection('hosts').doc(id)
      return Promise.all([
        hostRef.collection('suppressions').doc(key).get(),
        hostRef.collection(TOPIC_OPT_OUTS_SUBCOLLECTION).doc(key).get(),
        hostRef
          .collection(EMAIL_FREQUENCY_SUBCOLLECTION)
          .doc(key)
          .get()
          // The pace is the one field on this page whose absence is a
          // legitimate answer, so a read that fails renders the default
          // rather than an error — the recipient still gets their topic
          // checkboxes.
          .catch(() => null),
      ])
    }),
  )
  const optedOut = new Set<string>()
  const pending = new Set<string>()
  let suppressed = false
  let protectedReason: string | null = null
  let cadence: unknown = null
  let cadenceSetAtMs = Number.NEGATIVE_INFINITY
  sites.forEach(([suppression, optOuts, frequency], index) => {
    const own = index === 0
    if (suppression?.exists) {
      suppressed = true
      const reason = suppression.get('reason')
      if (reason !== UNSUBSCRIBE_SUPPRESSION_REASON && protectedReason === null) {
        protectedReason = String(reason ?? 'held')
      }
    }
    const stored = (optOuts?.exists ? optOuts.get('topics') : null) ?? {}
    for (const [id, record] of Object.entries(
      stored as Record<string, TopicSubscriptionEntry | null>,
    )) {
      /*
       * The shared reader, not a field test. An entry with a `resubscribedAt`
       * is EVIDENCE of an opt-out that has been lifted rather than a live one
       * — see `writeTopicOptOuts` for why the entry stays — and an entry with
       * a `confirmedAt` carries the same shape of evidence for a
       * confirmation. Only one function knows all three states.
       */
      const state = readTopicSubscriptionState(record)
      if (state === 'opted-out') optedOut.add(id)
      if (own && state === 'pending') pending.add(id)
    }
    // The most recent choice on any site, the link site keeping a tie — the
    // rule `filterCadenceSendable` decides by.
    if (frequency?.exists && frequency.get('cadence') != null) {
      const setAtMs = Number(frequency.get('cadenceSetAtMs'))
      const atMs = Number.isFinite(setAtMs) ? setAtMs : 0
      if (atMs > cadenceSetAtMs) {
        cadenceSetAtMs = atMs
        cadence = frequency.get('cadence')
      }
    }
  })
  return {
    suppressed,
    protectedRecord: protectedReason !== null,
    protectedReason,
    optedOut,
    pending,
    cadence: normalizeMarketingCadence(cadence),
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
  fields: {
    email: string
    optOut: string[]
    resume: string[]
    /**
     * Whether resuming a pending topic confirms it. True for this page, whose
     * tick is the confirmation; false for a reopening that did not come
     * through a link delivered to the mailbox (`rejoinStreamForAccount`).
     */
    confirmPending?: boolean
  },
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
        if (fields.confirmPending !== false) {
          topics[id] = { ...previous, confirmedAt: Date.now() }
        }
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

/**
 * Lifts the opt-outs the link site's consent-group SIBLINGS hold on streams
 * the person has just asked for back, so a stream rejoined here is rejoined
 * from the whole sender — the send paths read a sibling's opt-out as this
 * site's own.
 *
 * Only a live opt-out is touched, and it is lifted the way
 * `writeTopicOptOuts` lifts one: `resubscribedAt` stamped onto the entry,
 * which stays as the evidence that the opt-out was honored while it stood. A
 * sibling's pending confirmation is left alone — it is that site's question,
 * not a refusal of the sender. Nothing is read or written for a site alone.
 */
async function resumeTopicsAcrossGroup(
  firestore: any,
  group: ConsentGroup,
  key: string,
  topicIds: readonly string[],
): Promise<void> {
  const siblings = consentGroupOptOutHosts(group).slice(1)
  if (!siblings.length || !topicIds.length) return
  await Promise.all(
    siblings.map(async (id) => {
      const ref = firestore
        .collection('hosts')
        .doc(id)
        .collection(TOPIC_OPT_OUTS_SUBCOLLECTION)
        .doc(key)
      await firestore.runTransaction(async (transaction: any) => {
        const existing = await transaction.get(ref)
        if (!existing.exists) return
        const stored = (existing.get('topics') ?? {}) as Record<
          string,
          Record<string, unknown>
        >
        const lifted: Record<string, unknown> = {}
        for (const topicId of topicIds) {
          const previous = stored[topicId]
          if (readTopicSubscriptionState(previous) !== 'opted-out') continue
          lifted[topicId] = {
            ...previous,
            resubscribedAt: FieldValue.serverTimestamp(),
          }
        }
        if (!Object.keys(lifted).length) return
        transaction.set(
          ref,
          {
            topics: { ...stored, ...lifted },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      })
    }),
  )
}

/**
 * Reopens ONE stream for a signed-in account (AGL-3305) — this plugin's side
 * of `plugin-email-streams`, which the console asks when an account's answer
 * about a stream turns back to yes. The caller has already proven the
 * mailbox; see the seam for why that is the caller's job.
 *
 * Two cases, and the second is the reason this lives here:
 *
 *  - The address left just this stream: its opt-out is lifted, exactly as
 *    re-ticking the box on the preference page lifts it.
 *  - The address left EVERYTHING: every other active stream becomes an
 *    opt-out first, and only then is the whole-site unsubscribe lifted —
 *    through the same guard the resubscribe link uses. They asked for one
 *    stream back, not for the newsletter and the promotions they also left,
 *    and writing the opt-outs before the lift means there is no moment in
 *    which the whole catalog is mailable.
 *
 * A pending confirmation is left pending. The preference page confirms by a
 * tick because the tick came through a link delivered to the mailbox; this
 * request came from the console, which is proof of an account, not of a
 * click in the mailbox the confirmation was sent to.
 *
 * A bounce, a complaint, an erasure or a staff hold is `held`, and nothing is
 * written: none of them is a preference, so no switch lifts them.
 */
export async function rejoinStreamForAccount(
  request: PluginEmailStreamRejoinRequest,
  firestore: any = firebaseAdmin.app().firestore(),
): Promise<PluginEmailStreamRejoinResult> {
  const key = suppressionKeyFor(request.email)
  if (!key) return { status: 'held', reason: 'unusable-address' }
  // The sender the stream is rejoined FROM — the site's consent group, whose
  // records hold its mail as its own do.
  const group = await loadConsentGroup(request.hostId)
  const state = await readSubscriptionState(firestore, group, key)
  if (state.protectedRecord) {
    return { status: 'held', reason: state.protectedReason ?? 'held' }
  }
  const email = String(request.email).trim().toLowerCase()
  if (!state.suppressed) {
    await writeTopicOptOuts(firestore, request.hostId, key, {
      email,
      optOut: [],
      resume: [request.topicId],
      confirmPending: false,
    })
    await resumeTopicsAcrossGroup(firestore, group, key, [request.topicId])
    return { status: 'rejoined', releasedSuppression: false, keptLeft: 0 }
  }
  const others = activeEmailTopics(await loadTopicCatalog(firestore, request.hostId, true))
    .map((topic) => topic.id)
    .filter((id) => id !== request.topicId)
  await writeTopicOptOuts(firestore, request.hostId, key, {
    email,
    optOut: others,
    resume: [request.topicId],
    confirmPending: false,
  })
  await resumeTopicsAcrossGroup(firestore, group, key, [request.topicId])
  if (!(await releaseSiteSuppression(firestore, group, key))) {
    // Turned into a bounce or a complaint between the read and the lift.
    return { status: 'held', reason: 'protected' }
  }
  return { status: 'rejoined', releasedSuppression: true, keptLeft: others.length }
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
    `<input type="checkbox" name="topic:${escapeHtml(topic.id)}" value="on"` +
    (checked ? ' checked' : '') +
    ' style="margin:2px 0 0;width:18px;height:18px;flex:none">' +
    '<span style="flex:1">' +
    `<span style="display:block;font-size:14px;font-weight:600;color:${PAL.ink}">` +
    escapeHtml(topic.name) +
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
        `color:${PAL.muted}">${escapeHtml(topic.description)}</span>`
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
    `<input type="radio" name="cadence" value="${escapeHtml(value)}"` +
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
  /** Who the choices are made about — see {@link pageSender}. */
  sender: EmailPageSender
}): string {
  const { email, query, topics, state, topicId, brand, sender } = args
  const pal = brand.pal
  // A bounce or a complaint is not a preference, so the page does not pretend
  // the recipient can edit their way out of one. Shown instead of the form
  // rather than beside it: a form whose submit cannot take effect is worse
  // than no form.
  if (state.protectedRecord) return protectedAddressBody()
  const current = resolveCampaignTopic(topicId, topics)
  const action = `/api/email/preferences?${escapeHtml(query)}`
  return (
    heading('Email preferences') +
    paragraph(
      `Choose what <strong style="color:${PAL.ink}">${escapeHtml(
        email,
      )}</strong> should keep receiving from ` +
        `<strong style="color:${PAL.ink}">${sender.name}</strong>. ` +
        'Unticked emails stop; everything else carries on.',
      8,
    ) +
    reachParagraph(sender, 8) +
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
  /** A declared group is named; a site alone is "this site". */
  sender: EmailPageSender
}): string {
  const address = `<strong style="color:${PAL.ink}">${escapeHtml(
    args.email,
  )}</strong>`
  const from = args.sender.reach ? args.sender.name : 'this site'
  if (!args.drop.length) {
    return `${address} keeps receiving everything ${from} sends.`
  }
  const names = args.drop
    .map((topic) => escapeHtml(topic.name))
    .join(', ')
  if (!args.keep.length) {
    return (
      `${address} has been unsubscribed from ${names} — everything ` +
      `${from} currently sends.`
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
              `Confirm that <strong style="color:${PAL.ink}">${escapeHtml(
                email,
              )}</strong> should receive ` +
                `<strong style="color:${PAL.ink}">${escapeHtml(
                  topic.name,
                )}</strong> from ` +
                `<strong style="color:${PAL.ink}">${escapeHtml(
                  brand.name,
                )}</strong>.`,
            ) +
            `<form method="post" action="/api/email/confirm?${escapeHtml(
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
  const stream = `<strong style="color:${PAL.ink}">${escapeHtml(
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

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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
import {
  mergeEmailTopics,
  normalizeEmailTopic,
  topicRequiresDoubleOptIn,
  EMAIL_TOPICS_COLLECTION,
  type EmailTopic,
} from '@aglyn/aglyn/app-utils/email-topics'
import {
  enrollListMember,
  firebaseAdmin,
  hostSendingIdentity,
  meterHostEmail,
  consentGroupForSite,
  orgDataCollectionForHost,
  recordPendingTopicConfirmation,
  resolveCampaignTouch,
  resolveOrgIdForHost,
  siteRequiresDoubleOptIn,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
import { buildConfirmUrl } from '@aglyn/tenant-data-admin/server/email-unsubscribe-link'
import { sendEmail } from '@aglyn/shared-util-email'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The stream a newsletter signup joins.
 *
 * The built-in id, not the campaign default: somebody typing their address
 * into a footer box is asking for the newsletter, and attributing it to
 * "Promotions and offers" would confirm them for a stream they did not name.
 */
const NEWSLETTER_TOPIC_ID = 'newsletter'

/**
 * Enrolls one address into an org list's members (AGL-2499).
 *
 * The document id comes from `enrollListMember`, which is the only writer of
 * that collection — the workflow `enrollList` step reaches it too, and when
 * the two derived their own ids the same person subscribing by both routes
 * became two members of one list.
 *
 * Best-effort and silent on any problem: list enrollment rides along with
 * the newsletter signup, which must still succeed (and still upsert the
 * contact) even when the list id is stale, was mistyped into the besigner
 * prop, or belongs to an org this host cannot resolve.
 */
async function enrollInList(options: {
  hostId: string
  listId: string
  email: string
  name?: string
  /** The opt-in the signup itself carries — see the call site. */
  marketingConsent?: boolean
}): Promise<void> {
  if (!isDocumentId(options.listId)) return
  try {
    const contactsRef = await orgDataCollectionForHost(options.hostId, 'contacts')
    const listRef = contactsRef.parent?.collection('lists').doc(options.listId)
    if (!listRef) return
    const listSnapshot = await listRef.get()
    // A stale/mistyped id must not silently CREATE a list — campaign-send's
    // `list` audience would then read a list nobody set up.
    if (!listSnapshot.exists) return
    await enrollListMember({
      listRef,
      group: await consentGroupForSite(options.hostId),
      email: options.email,
      ...(options.name ? { name: options.name } : {}),
      source: 'newsletter',
      ...(options.marketingConsent ? { marketingConsent: true } : {}),
    })
  } catch (error) {
    console.error('list enrollment failed', error)
  }
}

/**
 * DOUBLE OPT-IN, when this site asks for one
 * (`docs/specs/email-competitive-gaps.md` P8).
 *
 * A footer signup is where a confirmation belongs — ActiveCampaign's shape,
 * where forms are the thing that default to it — and it is the only capture
 * path in the product where the person is present, expecting a reply, and has
 * just typed the address themselves.
 *
 * ## The confirmation message is TRANSACTIONAL
 *
 * It carries no marketing context, so it passes no frequency cap and adds no
 * unsubscribe header: somebody who just asked to subscribe is owed the answer
 * to what they asked, and gating it behind a marketing ceiling would drop
 * exactly the message that lets them out of the quarantine. The suppression
 * lists are not consulted here either — `recordPendingTopicConfirmation`
 * refuses an address that left this stream before any message is composed,
 * which is the check that matters: a signup form must not become a way to
 * mail somebody who unsubscribed by asking them again.
 *
 * ## Best-effort, like the enrollment beside it
 *
 * A failure to send leaves the address pending and unmailable, which is the
 * safe direction: they signed up, nothing reaches them, and signing up again
 * re-sends. The signup itself still succeeds — the contact is captured with
 * its consent record either way, and losing the capture because a confirmation
 * bounced would be a worse trade for everybody.
 *
 * @returns whether the address was put in the quarantine, so the caller can
 *          decide whether to enroll them on a list yet.
 */
async function requestConfirmation(options: {
  hostId: string
  email: string
  topics: EmailTopic[]
  /** The host document the setting was read from — see {@link loadHostGate}. */
  host: { cname?: unknown; subdomain?: unknown }
}): Promise<boolean> {
  const topic = options.topics.find(
    (candidate) => candidate.id === NEWSLETTER_TOPIC_ID,
  )
  const { result } = await recordPendingTopicConfirmation(
    options.hostId,
    options.email,
    NEWSLETTER_TOPIC_ID,
  )
  if (result !== 'pending') return false
  try {
    const siteBase =
      hostPublicOrigin({
        cname: String(options.host.cname ?? ''),
        subdomain: String(options.host.subdomain ?? ''),
      }) ?? ''
    const url = buildConfirmUrl({
      siteBase,
      hostId: options.hostId,
      email: options.email,
      topicId: NEWSLETTER_TOPIC_ID,
    })
    // No origin or no signing secret means no link, and a confirmation
    // message with nothing to click is worse than none: the person believes
    // they have subscribed and nothing ever arrives. Said out loud rather
    // than shipped quietly, exactly as the unsubscribe seam does.
    if (!url) {
      console.warn(
        '[newsletter] confirmation not sent — no public origin or no ' +
          'EMAIL_UNSUBSCRIBE_SECRET',
      )
      return true
    }
    const stream = topic?.name ?? 'our newsletter'
    const result = await sendEmail({
      to: options.email,
      subject: `Confirm your subscription`,
      text:
        `Please confirm that you want to receive ${stream} at this ` +
        `address:\n\n${url}\n\nThe link works for three days. If you did ` +
        'not sign up, ignore this message — nothing will be sent.',
      sendingIdentity: await hostSendingIdentity(options.hostId),
      audience: 'tenant',
      context: 'newsletter confirmation',
    })
    /*
     * Counted against the site, as TRANSACTIONAL.
     *
     * It is a message this site sent, so it costs what a message costs and
     * the meter has to see it. `'transactional'` is the honest class: the
     * person just typed their address into a form and is waiting for the
     * answer, which is why the message carries no marketing context and no
     * unsubscribe header either. Only a delivery is counted, so a send that
     * never left is not billed as one.
     */
    if (result.sent) await meterHostEmail(options.hostId)
  } catch (error) {
    console.error('confirmation send failed', error)
  }
  return true
}

/**
 * The site's topic catalog, for the one question the signup asks of it.
 *
 * Fails soft to the built-ins, like the preference page's read: a site whose
 * org cannot be resolved still gets the four defaults, so the decision is
 * made against a catalog rather than against nothing.
 */
async function loadTopics(hostId: string): Promise<EmailTopic[]> {
  try {
    const orgId = await resolveOrgIdForHost(hostId)
    if (!orgId) return mergeEmailTopics(null)
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .collection(EMAIL_TOPICS_COLLECTION)
      .get()
    return mergeEmailTopics(
      (snapshot?.docs ?? [])
        .map((doc: any) => normalizeEmailTopic(doc.id, doc.data()))
        .filter((topic: EmailTopic | null): topic is EmailTopic => !!topic),
    )
  } catch (error) {
    console.error('[newsletter] topic catalog read failed', error)
    return mergeEmailTopics(null)
  }
}

/**
 * Everything the confirmation decision needs, in one round trip.
 *
 * Three reads — the host document, the org lookup and the topic catalog — and
 * the first is issued IN PARALLEL with the other two rather than after them,
 * because none of the three depends on another's answer. A signup is a person
 * waiting for a form to come back, and serialized reads on that path are
 * latency the person feels for a decision that is usually "no".
 *
 * The host document is returned rather than discarded: the confirmation link
 * needs the site's public origin, which is on that same document, and reading
 * it twice would be a read per signup to recover something already in hand.
 *
 * Fails soft on the site flag, which `siteRequiresDoubleOptIn` already does —
 * a default a failed read could switch ON would quarantine every new signup
 * on a site whose owner never asked for confirmations.
 */
async function loadHostGate(hostId: string): Promise<{
  topics: EmailTopic[]
  siteDefault: boolean
  host: { cname?: unknown; subdomain?: unknown }
}> {
  const [topics, siteDefault, snapshot] = await Promise.all([
    loadTopics(hostId),
    siteRequiresDoubleOptIn(hostId),
    firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .get()
      .catch(() => null),
  ])
  return {
    topics,
    siteDefault,
    host: {
      cname: snapshot?.get('cname'),
      subdomain: snapshot?.get('subdomain'),
    },
  }
}

// Best-effort per-instance flood damper.
const attemptsByIp = new Map<string, number[]>()
import {
  NO_CLIENT_ADDRESS_BUCKET,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'

/**
 * Newsletter opt-in (AGL-301): footer signups and checkout opt-ins land
 * in the contacts CRM with an explicit consent timestamp, feeding the
 * email-campaign audiences.
 */
export const newsletterHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase()
  const listId = String(body.listId ?? '').trim()
  if (!hostId || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email' })
  }
  // Keeps counting under the no-address bucket rather than being skipped: an
  // unauthenticated signup endpoint that stops counting is an open write into
  // the contacts CRM.
  const ip =
    readClientIp(req.headers, { remoteAddress: req.socket?.remoteAddress }) ??
    NO_CLIENT_ADDRESS_BUCKET
  const now = Date.now()
  const attempts = (attemptsByIp.get(ip) ?? []).filter(
    (at) => now - at < 60_000,
  )
  attempts.push(now)
  attemptsByIp.set(ip, attempts)
  if (attempts.length > 10) {
    return res.status(429).json({ error: 'Too many attempts' })
  }
  try {
    // A newsletter signup is an identify moment: the visitor was anonymous
    // while they browsed and this request is the first thing that names them.
    // Both channels are asked once, here, and the later touch is credited.
    const campaignTouch = await resolveCampaignTouch({
      hostId,
      wire: body.campaignTouch,
      email,
      atMs: now,
    })
    await upsertHostContact({
      hostId,
      email,
      source: 'newsletter',
      marketingConsent: true,
      interaction: {
        refId: `newsletter-${now}`,
        summary: 'Subscribed to the newsletter',
      },
      ...(campaignTouch ? { campaignTouch } : {}),
    })
    /*
     * The confirmation, when this site asks for one.
     *
     * AFTER the contact upsert and never instead of it. The person typed
     * their address and ticked a box, and that consent record is a fact
     * whether or not they go on to click a link — withholding the capture
     * until they do would lose the record of what they actually did. What the
     * confirmation gates is the SEND, on the person's own topic entry, which
     * is where `filterTopicSendable` reads it.
     */
    const { topics, siteDefault, host } = await loadHostGate(hostId)
    const confirming =
      topicRequiresDoubleOptIn(
        topics.find((topic) => topic.id === NEWSLETTER_TOPIC_ID),
        siteDefault,
      ) && (await requestConfirmation({ hostId, email, topics, host }))
    if (listId) {
      /*
       * The same basis the contact upsert records, on the membership too.
       *
       * A list membership had no consent field at all, so `audience: 'list'`
       * gave the send-time join nothing to read even for the one audience
       * whose members literally asked for a newsletter
       * (`docs/specs/email-overhaul.md` §1d). This is a DECLARED opt-in and
       * not an inference from an act: the request this handler serves is
       * "subscribe me", which is the checkbox.
       */
      await enrollInList({ hostId, listId, email, marketingConsent: true })
    }
    /*
     * The caller is told which of the two things happened, so the signup form
     * can say "check your email" rather than "you're subscribed".
     *
     * A form that reported success identically either way would be the site
     * telling somebody they are on the list while the send path refuses them,
     * and the only way they could find out is by noticing that nothing
     * arrives.
     */
    return res.status(200).json({ ok: true, confirmationRequired: confirming })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Signup failed' })
  }
}

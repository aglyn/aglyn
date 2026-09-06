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

import {
  claimAttempt,
  CRM_EMAIL_ACTIVITY_TAG,
  CRM_EMAIL_ORG_TAG,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { normalizeResendDeliveryEvents } from '@aglyn/shared-util-email'
// AGL-1771 lifted `isDocumentId` here from the local copy AGL-1768 wrote. The
// copy's stated reason was wrong: `@nx/enforce-module-boundaries` does NOT
// refuse an edge between two feature plugins — every plugin carries only
// `aglyn:addons`, and that tag's rule permits `aglyn:addons` as a target, which
// is why `campaign-send.ts` already imports `@aglyn/plugins-commerce/model`. It
// now lives beside `updateExisting` in the library where Firestore paths are
// built, which was always the better home and is now the reachable one.
import { firebaseAdmin, updateExisting } from '@aglyn/tenant-data-admin'
// From the LEAF, not the barrel, for the same reason `isDocumentId` is
// (AGL-1771): a spec that mocks `@aglyn/tenant-data-admin` — which it must,
// because that graph reaches the admin SDK — would otherwise replace the real
// suppression writer with whatever the factory happened to list. A stub there
// is a false green on the one behaviour AGL-2407 is about.
import { suppressEmail } from '@aglyn/tenant-data-admin/server/email-suppression'
// Same leaf-import reasoning again: the per-recipient delivery log is the only
// record staff have of what we sent someone, and a mocked-away writer is a
// green test over an empty log.
import {
  recordEmailCampaignTouch,
  recordEmailDeliveryEvents,
  recordPersonEngagement,
} from '@aglyn/tenant-data-admin/server/email-delivery-log'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import {
  crmEmailDeliveryStateForEvent,
  recordCrmEmailDelivery,
} from '@aglyn/tenant-data-admin/server/crm-email-activity'
import { getOrgForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { recordEmailReputationFailure } from '@aglyn/tenant-data-admin/server/email-sender-reputation'
// The link rollup's key derivation and its cap live beside the READER that
// renders them (`@aglyn/shared-ui-email-campaigns/model`) rather than here, so
// the shape the webhook writes and the shape the report reads cannot drift
// into two definitions of what a "link" is.
import {
  CAMPAIGN_LINK_ROLLUP_MAX,
  campaignLinkKey,
} from '@aglyn/shared-ui-email-campaigns/model'
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { assignExperimentVariant, type HostExperiment } from '../model/experiments'
// The one list `campaign-send` reads, keyed the one way it keys it.
import { suppressionId } from './campaign-send'

/**
 * Svix signature check (Resend webhooks): HMAC-SHA256 over
 * `{id}.{timestamp}.{payload}` with the base64 secret after `whsec_`;
 * the header carries space-delimited `v1,<base64sig>` entries.
 */
function verifySvix(
  secret: string,
  id: string,
  timestamp: string,
  payload: Buffer,
  signatureHeader: string,
): boolean {
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const expected = createHmac('sha256', key)
      .update(`${id}.${timestamp}.`)
      .update(payload)
      .digest()
    return signatureHeader.split(' ').some((entry) => {
      const [, signature] = entry.split(',')
      if (!signature) return false
      const candidate = Buffer.from(signature, 'base64')
      return (
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
      )
    })
  } catch {
    return false
  }
}

/** Tags arrive as an array of {name, value} or a plain map — accept both. */
function tagMap(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    const map: Record<string, string> = {}
    for (const tag of raw) {
      if (tag?.name) map[String(tag.name)] = String(tag.value ?? '')
    }
    return map
  }
  if (raw && typeof raw === 'object') {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value ?? ''),
      ]),
    )
  }
  return {}
}

/**
 * A bounce or a complaint suppresses the address (AGL-1918).
 *
 * Until now this webhook answered `email.bounced` and `email.complained` with
 * `200 {ignored:true}` — acknowledged, and dropped. The consequences were not
 * cosmetic, because `campaign-send.ts` filters its audience against exactly
 * one list and nothing but an unsubscribe click ever wrote to it: a hard-bounced
 * address was re-sent on every subsequent campaign forever, and a spam
 * complaint had no effect on whether that complainant was mailed again. Both
 * are the behaviours mailbox providers measure a sending domain on, and
 * `aglyn.com` carries the password resets and receipts on the same key and the
 * same From address as the campaigns.
 *
 * WHICH failures suppress:
 *
 * - **Every complaint.** Someone pressed "report spam". There is no reading of
 *   that which permits mailing them again.
 * - **Permanent bounces only.** Resend reports `data.bounce.type` as
 *   `Permanent` or `Transient`. A transient bounce is a full mailbox or a
 *   greylisting server — suppressing on one would unsubscribe a real
 *   subscriber over a temporary condition at their provider, which is a
 *   customer's list being quietly destroyed by our error handling.
 * - An **unrecognised or absent** bounce type does NOT suppress. Guessing in
 *   the suppressing direction is the destructive guess, and the spec asserts
 *   the shape so a payload change fails as itself rather than by silently
 *   ceasing to suppress anything.
 *
 * The entry is keyed and shaped exactly as the unsubscribe handler's
 * (`suppressionId(email)` → `{ email, createdAt }`), because the reader does
 * not care how an address got there — it is one list, and a second shape would
 * be a second list that `campaign-send` reads half of. `createdAt` is written
 * only when the document is new, so a bounce arriving after an unsubscribe
 * does not restamp the date the person actually unsubscribed.
 *
 * WHERE it lands, since AGL-2407: BOTH lists, and the per-host one is now the
 * optional half.
 *
 * - The PLATFORM list (`emailSuppressions`) is always written. That is the
 *   half that did not exist: a bounce on an invite, a password reset, a
 *   receipt or a usage summary carries no `hostId` — only `campaign-send`
 *   ever stamped one — so this webhook had nowhere to file it and answered
 *   `200 {ignored:true}`, exactly as if the address were fine. A dead mailbox
 *   was re-mailed on every subsequent send, forever.
 * - The PER-HOST list is written when the send named a site, because that is
 *   the list `campaign-send` filters its audience against and a merchant's
 *   own list is theirs to see and undo (AGL-2410).
 *
 * A hard bounce is address-level truth and belongs on the platform list even
 * when a site was named — the mailbox does not exist for anyone. A COMPLAINT
 * is a judgement about one sender's mail, and it goes on the platform list too
 * for a narrower reason: the platform list is consulted only by bulk mail, and
 * someone who pressed "report spam" on anything from `noreply@aglyn.com` must
 * not receive more bulk mail from `noreply@aglyn.com`. Neither list is
 * consulted by transactional mail; see `email-suppression.ts` for why.
 */
async function recordDeliveryFailure(args: {
  firestore: FirebaseFirestore.Firestore
  /** Null when the send named no site — the case AGL-2407 exists for. */
  hostRef: FirebaseFirestore.DocumentReference | null
  type: 'email.bounced' | 'email.complained'
  recipient: string
  bounceType: string
  /** The `context` tag `sendEmail` stamps, naming which sender produced it. */
  context: string
  res: Parameters<PluginApiHandler>[1]
}) {
  const { firestore, hostRef, type, recipient, bounceType, context, res } = args
  if (!recipient) return res.status(200).json({ ignored: true })

  const complaint = type === 'email.complained'
  const permanent = bounceType.trim().toLowerCase() === 'permanent'
  if (!complaint && !permanent) {
    // A transient bounce is real information we deliberately do not act on.
    return res.status(200).json({ ok: true, suppressed: false })
  }
  const reason = complaint ? 'complaint' : 'bounce'

  /*==========================================
   * THE SAME EVENT, COUNTED AGAINST THE TENANT.
   *
   * The campaign counter the caller writes answers "how did this mailing do".
   * This one answers the question the shared sending domain actually depends
   * on: how is THIS WORKSPACE doing, across every campaign it has sent.
   * Nothing computed a rate at any scope before it, so one merchant's bad
   * list could push the domain every other merchant's receipts leave on
   * toward a block, and the first anybody would hear of it is a rejection.
   *
   * ## Why HERE, below the permanence filter
   *
   * The two decisions in front of it are the same two the suppression needs,
   * and a rate that included them would be measuring something else. A
   * TRANSIENT bounce is a full mailbox or a greylisting server — it says
   * nothing about list quality, it does not suppress, and counting it would
   * trip a merchant's breaker on their subscribers' holiday auto-replies.
   *
   * ## Why only a send that named a site
   *
   * `hostId` is the only tenant identity a delivery event carries, and only
   * `campaign-send` stamps one. A bounce on a password reset or an invite
   * therefore reaches the suppression lists — address-level truth belongs on
   * them — and deliberately not this counter: the breaker it feeds may only
   * ever refuse a CAMPAIGN, so mail it could never act on must neither
   * inflate the rate nor dilute it.
   *
   * Swallowed, and taken before the suppression writes rather than after, so
   * a counter that fails cannot cost an address its place on either list.
   *=========================================*/
  if (hostRef) {
    await getOrgForHost(hostRef.id)
      .then((org) =>
        org?.orgId
          ? recordEmailReputationFailure(org.orgId, reason)
          : undefined,
      )
      .catch(() => undefined)
  }

  // The platform list FIRST, and unconditionally. Ordered ahead of the
  // per-host write because it is the one that must happen for every failure:
  // if the per-host write throws, the outer handler answers 200 and the
  // address is still off the bulk senders' lists.
  await suppressEmail({
    email: recipient,
    reason,
    context: context || null,
    hostId: hostRef?.id ?? null,
    firestore,
  })

  if (hostRef) {
    const ref = hostRef.collection('suppressions').doc(suppressionId(recipient))
    await firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref)
      transaction.set(
        ref,
        {
          email: recipient,
          reason,
          suppressedAt: FieldValue.serverTimestamp(),
          ...(existing.exists
            ? {}
            : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      )
    })
  }
  return res
    .status(200)
    .json({ ok: true, suppressed: true, scope: hostRef ? 'host' : 'platform' })
}

/**
 * Counts one click against its destination in the campaign's link rollup.
 *
 * A transaction because the CAP has to be enforced against the map as it
 * stands: a merge-set cannot ask "is this key already here, and how many keys
 * are there" and would grow the document without limit. Firestore's 1 MiB
 * document ceiling is the hard reason, and a rollup that silently stopped
 * being writable at that ceiling would take the campaign's other counters
 * down with it if they shared the document — which is why this is its own.
 *
 * Nothing is DROPPED at the cap. A click on a destination past it lands in
 * `overflowClicks`, and a click that arrived with no destination at all lands
 * in `unattributedClicks`, so the table's own total plus the two excluded
 * figures reconcile with `stats.clicks` and the screen can say where the
 * difference went. Dropping either would leave a link table whose sum quietly
 * disagreed with the click count printed above it.
 *
 * The rollup does NOT create the campaign. Same reasoning as `updateExisting`
 * on the counters: a click arriving days after a merchant deleted a campaign
 * must not resurrect it, here as a document holding one map of URLs.
 */
async function recordCampaignLinkClick(args: {
  firestore: FirebaseFirestore.Firestore
  campaignRef: FirebaseFirestore.DocumentReference
  link: string | null
}): Promise<void> {
  const { firestore, campaignRef, link } = args
  const ref = campaignRef.collection('reports').doc('links')
  await firestore.runTransaction(async (transaction) => {
    const campaign = await transaction.get(campaignRef)
    if (!campaign.exists) return
    const snapshot = await transaction.get(ref)
    const stored = (snapshot.exists ? snapshot.data() : null) ?? {}
    const links = (stored.links ?? {}) as Record<string, unknown>

    if (!link) {
      transaction.set(
        ref,
        { unattributedClicks: FieldValue.increment(1) },
        { merge: true },
      )
      return
    }
    // The map key is a hash, not the URL: a Firestore field name may not
    // contain `.`, `/` or `~`, and every URL contains at least two of them.
    // The URL itself rides in the value, so nothing has to be un-hashed.
    const key = createHash('sha256').update(link).digest('hex').slice(0, 32)
    if (links[key] === undefined && Object.keys(links).length >= CAMPAIGN_LINK_ROLLUP_MAX) {
      transaction.set(
        ref,
        { overflowClicks: FieldValue.increment(1) },
        { merge: true },
      )
      return
    }
    transaction.set(
      ref,
      {
        // A nested map under a merge-set, which merges at depth — the dotted
        // form would write a field whose NAME contains dots and leave `links`
        // empty, the exact fault `email-delivery-log.ts` records against
        // `timestamps`.
        links: { [key]: { url: link, clicks: FieldValue.increment(1) } },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  })
}

/**
 * Resend event ingestion (AGL-268), relocated from the console app route
 * into its owning plugin (AGL-418) — the URL `/api/email/events` is
 * preserved through the plugin API dispatcher. Opened/clicked events
 * increment the tagged campaign's stats; clicks on experiment sends also
 * count as the recipient's variant conversion — the variant re-derives
 * deterministically from the address, so nothing per-send is stored.
 * Svix signs the RAW body: `req.rawBody` carries the exact request text.
 */
export const emailEventsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    return res.status(501).json({ error: 'Webhook is not configured' })
  }
  const payload = Buffer.from(req.rawBody ?? '', 'utf8')
  const headers = req.headers as Partial<Record<string, string>>
  const svixId = String(headers['svix-id'] ?? '')
  const svixTimestamp = String(headers['svix-timestamp'] ?? '')
  const svixSignature = String(headers['svix-signature'] ?? '')
  if (
    !svixId ||
    !svixTimestamp ||
    !verifySvix(secret, svixId, svixTimestamp, payload, svixSignature)
  ) {
    return res.status(401).json({ error: 'Bad signature' })
  }

  try {
    const event = JSON.parse(payload.toString('utf8'))
    const type = String(event?.type ?? '')

    /*==========================================
     * THE PER-RECIPIENT DELIVERY LOG.
     *
     * FIRST, and for every event type rather than the four below, because the
     * log is the staff answer to "did this person get their invite" and that
     * question is mostly asked about `sent`, `delivered` and `bounced` —
     * none of which the campaign statistics below have any use for.
     *
     * `normalizeResendDeliveryEvents` is the one place in the tree that reads
     * Resend's wire format; everything downstream stores and renders our own
     * vocabulary, so changing sender is a new adapter and nothing else.
     *
     * Best-effort and awaited but never fatal: a log write that fails must
     * not turn into a non-2xx, which the provider would answer by retrying
     * the same event forever.
     *=========================================*/
    const deliveryEvents = normalizeResendDeliveryEvents(event, Date.now())
    const outcomes = await recordEmailDeliveryEvents(deliveryEvents).catch(
      () => [],
    )

    /*
     * DISTINCT RECIPIENTS this event is the first of its kind for.
     *
     * The log's transaction already held each message's prior state, so this
     * is free — and it is the only honest way to count distinct openers
     * without a second document per recipient. It is also idempotent for the
     * same reason the replay guard below exists: a redelivered or replayed
     * event finds the state already recorded and contributes zero.
     *
     * Zero when the log write failed, which loses the count rather than
     * inventing one. That is the correct direction: a lost increment
     * understates engagement, and a guessed one is a number nobody can
     * defend.
     */
    const firstSeen = outcomes.filter((one) => one.firstOfType).length

    /*==========================================
     * THE PER-PERSON ENGAGEMENT ROLLUP.
     *
     * Opens and clicks were recorded per message and per campaign and rolled
     * onto NOBODY, so "has this person engaged lately" could only be answered
     * by walking every message subcollection. Two shipped things needed that
     * answer and could not have it: an audience rule that says "opened in the
     * last 30 days", and a sunset that stops mailing an address which has
     * gone quiet.
     *
     * HERE, above the type gate and above the campaign gates, on purpose.
     * Engagement is a fact about the PERSON, and the message they engaged
     * with does not have to be a campaign for it to be one — somebody who
     * clicks a receipt is reading our mail. Placing it below the
     * `hostId`/`campaignId` gate would record engagement for campaign mail
     * only and then let a sunset refuse people on the strength of it, which
     * is a control drawing conclusions from a fraction of the evidence.
     *
     * Driven by the same `firstOfType` outcomes `firstSeen` is counted from,
     * so a replay contributes nothing here for the same reason it contributes
     * nothing to `stats.uniqueOpens` — and the rollup needs no claim of its
     * own. Best-effort: a person's stamp is worth less than the campaign
     * counters below it and much less than a suppression.
     *=========================================*/
    await recordPersonEngagement(outcomes).catch(() => 0)

    if (
      type !== 'email.opened' &&
      type !== 'email.clicked' &&
      type !== 'email.bounced' &&
      type !== 'email.complained' &&
      type !== 'email.delivered'
    ) {
      return res.status(200).json({ ignored: true })
    }
    const data = event?.data ?? {}
    const tags = tagMap(data?.tags)
    const hostId = tags['hostId']
    const campaignId = tags['campaignId']
    const recipient = String(
      Array.isArray(data?.to) ? (data.to[0] ?? '') : (data?.to ?? ''),
    )
      .trim()
      .toLowerCase()
    // A path component, so "non-empty" was never the whole question.
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = isDocumentId(hostId)
      ? firestore.collection('hosts').doc(hostId)
      : null
    /** The campaign this event belongs to, or null when it names none. */
    const campaignRef =
      hostRef && isDocumentId(campaignId)
        ? hostRef.collection('campaigns').doc(campaignId)
        : null

    /*==========================================
     * THE ONE-TO-ONE EMAIL'S TIMELINE ENTRY (AGL-2615).
     *
     * A message sent from a CRM record carries the org and the activity row
     * it was logged as, and the five events below are the row's delivery
     * state — the chip a rep reads beside "Email" on the timeline. Placed
     * above the campaign gates because a one-to-one email is not a campaign
     * and names none; placed below the log and the engagement rollup
     * because those are facts about the message and the person that this
     * row merely restates.
     *
     * The state comes from the NORMALIZED event, not the wire string: the
     * adapter above is the one reader of the provider's vocabulary. Both ids
     * are path components, so both are checked the way `hostId` is. Never
     * fatal — the writer reports rather than throws — and never behind the
     * replay claim: the write is monotonic, so a replay finds the row
     * already there and changes nothing.
     *=========================================*/
    const crmState = crmEmailDeliveryStateForEvent(deliveryEvents[0]?.type)
    const crmActivityId = tags[CRM_EMAIL_ACTIVITY_TAG]
    const crmOrgId = tags[CRM_EMAIL_ORG_TAG]
    if (crmState && isDocumentId(crmActivityId) && isDocumentId(crmOrgId)) {
      await recordCrmEmailDelivery(firestore, {
        orgId: crmOrgId,
        activityId: crmActivityId,
        state: crmState,
        atMs: deliveryEvents[0]?.at ?? Date.now(),
      })
    }

    /*==========================================
     * THE DELIVERY DENOMINATOR.
     *
     * `email.delivered` used to be answered `200 {ignored:true}`, which is
     * why every campaign rate had to be taken over `sent`. Sent is what the
     * PROVIDER accepted; delivered is what the receiving server accepted, and
     * the gap between them is the bounces. An open rate over `sent` therefore
     * reads lower than the same campaign measured anywhere else, and a rate
     * that only we compute differently is a rate a merchant cannot check.
     *
     * NO REPLAY CLAIM ON THIS ONE, and that is deliberate rather than an
     * omission: `firstSeen` is derived from whether the delivery log had
     * already recorded a `delivered` for this MESSAGE, so a retry, a replay
     * and a duplicate webhook all contribute zero without a claim document
     * being minted per delivered event. The counters below that DO carry a
     * claim are the ones counting events rather than messages.
     *=========================================*/
    if (type === 'email.delivered') {
      if (!campaignRef || !firstSeen) {
        return res.status(200).json({ ignored: true })
      }
      // `updateExisting` for the AGL-1768 reason the open counter carries:
      // a merge-set against a deleted campaign RE-CREATES it as a document
      // holding nothing but a `stats` map.
      await updateExisting(campaignRef, {
        'stats.delivered': FieldValue.increment(firstSeen),
      })
      return res.status(200).json({ ok: true, counted: true })
    }

    if (type === 'email.bounced' || type === 'email.complained') {
      /*
       * The campaign counter FIRST, and its failure swallowed.
       *
       * Ordered ahead of the suppression because the suppression is the write
       * that must happen — it is what stops us mailing a dead or hostile
       * address again — and `recordDeliveryFailure` owns the response. A
       * statistic must never be able to cost a suppression, so this is
       * wrapped rather than awaited into the same failure path.
       *
       * Same `firstSeen` idempotency as `delivered` above: one bounce per
       * message, however many times the provider tells us about it.
       */
      if (campaignRef && firstSeen) {
        await updateExisting(campaignRef, {
          [type === 'email.bounced' ? 'stats.bounced' : 'stats.complained']:
            FieldValue.increment(firstSeen),
        }).catch(() => undefined)
      }
      // NO `hostId` gate here since AGL-2407. It used to sit above this
      // branch, which is what made every transactional bounce a no-op: only
      // `campaign-send` stamps a `hostId` tag, so a bounce on an invite or a
      // password reset failed the gate and was dropped with `ignored: true`.
      // The failure path needs no site at all — `recordDeliveryFailure` files
      // the platform record either way and adds the per-host one when there
      // is a host to add it to.
      return await recordDeliveryFailure({
        firestore,
        hostRef,
        type,
        recipient,
        bounceType: String(data?.bounce?.type ?? ''),
        context: tags['context'] ?? '',
        res,
      })
    }

    // Opens and clicks ARE per-campaign, so this pair still needs both ids —
    // and therefore still needs the host, which the failure path above no
    // longer does.
    if (!hostRef || !isDocumentId(campaignId)) {
      return res.status(200).json({ ignored: true })
    }

    /*==========================================
     * THE REPLAY GUARD, around the counters and nothing else.
     *
     * Delivery is AT LEAST ONCE and the two writes below are
     * `FieldValue.increment(1)`, which is the combination that inflates a
     * statistic. Three things deliver the same event twice: a provider retry
     * after our function wrote and then timed out before answering, a
     * retry after any non-2xx, and a human pressing **Replay** in the
     * provider's dashboard — which is not a hypothetical, since replay is how
     * events that failed while the signing secret was unset get recovered.
     * Every one of those turns one open into two.
     *
     * The claim is keyed on the Svix message id, which is stable across all
     * three: a retry and a replay of one event carry the id the first
     * delivery carried. `kind` and `scopeId` go into the digest with it, so
     * one site's event cannot collide with another's.
     *
     * ## Why it wraps the counters rather than the whole handler
     *
     * Everything above this point is already idempotent and worth re-running.
     * The per-recipient delivery log keys by the provider's message id and
     * merges, so a replay refreshes a row rather than adding one — and a row
     * that failed to write the first time SHOULD get another chance.
     * Suppression is a set: suppressing an address twice is suppressing it
     * once. Only the increments cannot survive being repeated, so only they
     * are behind the claim.
     *
     * ⚠️ `claimAttempt` treats an EMPTY key as "no claim" and returns a
     * no-op, which would silently reopen this hole. It cannot happen here —
     * the signature check above refuses a request with no `svix-id` before
     * reaching this line — and there is a test that fails if that stops
     * being true.
     *=========================================*/
    const counted = await claimAttempt(firestore, {
      kind: 'resend-email-event',
      scopeId: hostId,
      orgId: '',
      key: svixId,
      busyMessage: 'This delivery event is already being counted.',
    })
    if ('replay' in counted) {
      return res.status(200).json({ ok: true, counted: false })
    }
    // Plain refusal (AGL-1768). A merge-set against a missing path CREATES it,
    // so an open re-created a campaign the merchant had deleted — a document
    // holding a `stats` map and nothing else: no subject, no body, no
    // audience, no status. Opens trail sends by days, so deleting it again did
    // not help. `updateExisting` rejects only that case (gRPC NOT_FOUND) and
    // rethrows everything else, so a Firestore outage stays distinguishable
    // from an open against a deleted campaign instead of being swallowed by a
    // `.catch(() => undefined)`. AGL-1760's test — does refusing discard money
    // or work that already happened? — is passed: the open count for a
    // campaign that no longer exists has no reader.
    //
    // DOTTED FIELD PATH, not a nested map. `update({ stats: { opens: … } })`
    // REPLACES the whole `stats` map, so every open would clobber `clicks`;
    // only `set({ merge: true })` merges maps at depth.
    try {
      /*
       * TWO COUNTERS PER EVENT, because they answer two questions and the
       * report has to be able to name which it is showing.
       *
       * `stats.opens` counts EVENTS: one reader opening four times is four.
       * That is the number this handler has always kept, it is the honest
       * count of what happened, and it is useless as a rate numerator — an
       * open rate built on it exceeds 100% the moment anyone reads an email
       * twice, and a percentage above 100 teaches a reader that the label is
       * lying.
       *
       * `stats.uniqueOpens` counts MESSAGES that had never been opened
       * before, which is distinct readers, which is what every open rate in
       * the industry divides. `firstSeen` comes from the delivery log's own
       * transaction, so it costs no read here.
       */
      const totals: Record<string, unknown> = {
        [type === 'email.opened' ? 'stats.opens' : 'stats.clicks']:
          FieldValue.increment(1),
      }
      if (firstSeen) {
        totals[
          type === 'email.opened' ? 'stats.uniqueOpens' : 'stats.uniqueClicks'
        ] = FieldValue.increment(firstSeen)
      }
      await updateExisting(hostRef.collection('campaigns').doc(campaignId), totals)

      /*==========================================
       * LINK-LEVEL CLICKS — the aggregate `data.click.link` never had.
       *
       * The field IS present on Resend's `email.clicked` payload and has been
       * read for a while: `normalizeResendDeliveryEvents` puts it on the
       * event and the per-recipient delivery log stores it. What did not
       * exist was a per-campaign rollup, and it could not be produced at read
       * time — that would mean querying every recipient's delivery row for
       * the campaign, which is the scan a campaign report must not do.
       *
       * ONE DOCUMENT, not a document per URL. The report then reads the whole
       * table with a single `getDoc`, and the map cannot grow without bound
       * because the transaction refuses a new key past the cap and counts the
       * click as overflow instead. `campaignLinkKey` drops the query string,
       * so a link personalised per recipient cannot mint a row per recipient
       * — see that function for why that is a correctness requirement and not
       * only a size one.
       *
       * Inside the claim, so a replayed click cannot inflate a link row any
       * more than it can inflate `stats.clicks`. Best-effort: a rollup write
       * that fails must not cost the click count above it, which is the
       * number the whole report leans on.
       *=========================================*/
      if (type === 'email.clicked') {
        await recordCampaignLinkClick({
          firestore,
          campaignRef: hostRef.collection('campaigns').doc(campaignId),
          link: campaignLinkKey(data?.click?.link),
        }).catch(() => undefined)

        /*==========================================
         * THE TOUCH REVENUE ATTRIBUTION IS TAKEN OVER.
         *
         * "Which campaign brought this buyer here" cannot be answered from
         * anything above: the delivery log holds a row per message, and
         * finding a person's most recent click would mean reading every one
         * of them. So the click writes the answer down — one field on the
         * person's own document, per site — and an order reads it with a
         * single keyed lookup.
         *
         * ONLY a click. An open would be the weaker evidence and, since Mail
         * Privacy Protection, frequently not a human at all; crediting money
         * to one would hand a campaign the orders of people who never read
         * it. `email-revenue-attribution.ts` records the full reasoning.
         *
         * The instant is the PROVIDER'S, taken from the outcome the delivery
         * log already wrote, so a delayed webhook credits the click at the
         * time it happened rather than at the time we heard about it — which
         * is the difference between inside and outside the window for a click
         * near its edge. `Date.now()` is the fallback for a click whose log
         * write failed, and it is the later of the two, so it can only narrow
         * the window rather than widen it.
         *
         * Best-effort, like the link rollup above it and for the same reason:
         * a touch that failed to write costs one order's attribution, and it
         * must not cost the click count the whole report leans on.
         *=========================================*/
        await recordEmailCampaignTouch({
          email: recipient,
          hostId,
          campaignId,
          atMs:
            outcomes.find((one) => one.type === 'clicked')?.at ?? Date.now(),
        }).catch(() => false)
      }

    // Experiment conversion (AGL-268): clicks are the signal.
    const experimentId = tags['experimentId']
    if (type === 'email.clicked' && isDocumentId(experimentId) && recipient) {
      const experimentSnapshot = await hostRef
        .collection('experiments')
        .doc(experimentId)
        .get()
      const experiment = experimentSnapshot.data() as
        | HostExperiment
        | undefined
      if (experimentSnapshot.exists && experiment) {
        const variant = assignExperimentVariant(
          experiment,
          experimentId,
          recipient,
        )
        // `variant.id` is merchant-authored — `validateExperiment` checks the
        // ids are unique and nothing about their SHAPE — and it is a path
        // component here too.
        if (variant && isDocumentId(variant.id)) {
          // Still a merge-set, and deliberately so: this one CREATES. The
          // first conversion for a variant has no stats document yet, the
          // experiment it hangs off was just proven to exist, and the click
          // is work that really happened — refusing would discard it. The
          // `.catch(() => undefined)` is gone for the same reason as above: a
          // swallowed failure here is a conversion lost silently.
          await experimentSnapshot.ref
            .collection('stats')
            .doc(variant.id)
            .set(
              {
                conversions: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            )
          }
        }
      }
    } catch (error) {
      /*
       * Give the key back, so the count this attempt did not make is still
       * makeable. Without it a failure here is permanent in a way the failure
       * itself is not: the outer handler answers 200 whatever happens (see
       * below), so the provider never retries, and a settled claim would then
       * refuse the manual replay that is the only remaining way to recover
       * the event.
       *
       * Releasing cannot itself be fatal — the original error is what is
       * worth reporting, and losing it to a secondary failure while cleaning
       * up would hide the real cause.
       */
      await counted.claim.release().catch(() => undefined)
      throw error
    }
    /*
     * Settled only after both writes landed, which is what makes the claim
     * mean "this event has been counted" rather than "this event was seen".
     */
    await counted.claim.record(200, { ok: true, counted: true })
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    // Never make Resend retry-storm.
    return res.status(200).json({ ok: true })
  }
}

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
  checkQuota,
  contactMatchesSegment,
  isEmailTopicId,
  DEFAULT_CAMPAIGN_TOPIC_ID,
  readMarketingBasis,
  resolveMarketingConsentPolicy,
  splitByMarketingConsent,
  type MarketingConsentRecord,
  createResourceUid,
  decodeStoredNodes,
  emailStarterSendBlock,
  resolveBrandingProfile,
  visibleToHost,
} from '@aglyn/aglyn/server'
import type { PluginRevocation } from '@aglyn/aglyn/server'
import {
  renderCampaignEmail,
  type EmailRenderProduct,
} from '@aglyn/plugins-email/model'
import { assignExperimentVariant, type HostExperiment } from '../model'
import { productPriceRange } from '@aglyn/plugins-commerce/model'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { hostPublicOrigin } from '@aglyn/aglyn/server'
import {
  orgDataCollectionForHost,
  orgDataQueryForHost,
  filterSendableForHost,
  filterTopicSendable,
  firebaseAdmin,
  getOrgForHost,
  meterHostEmail,
  claimOrgEmailSendBudget,
  orgCampaignEmailSendsForMonth,
  readEmailSendRateConfig,
  readEmailSendRateWindow,
  reconcileCampaignSendReservation,
  reserveCampaignEmailSends,
  type CampaignSendReservation,
  resolveHostSendingIdentity,
} from '@aglyn/tenant-data-admin'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import { createHash, createHmac } from 'crypto'
import {
  EMAIL_MAX_RECIPIENTS_PER_SEND,
  isEmailConfigured,
  rateLimitedRetryAtMs,
  sendEmail,
  sendingIdentityRefusal,
} from '@aglyn/shared-util-email'

/**
 * Recipients one send may address.
 *
 * The number lives in `send-ceilings.ts` with the other two email ceilings
 * rather than here, because it only means anything in relation to them: it has
 * to fit inside a workspace's share of the platform hour, which in turn has to
 * fit inside the platform hour. Held privately here it was a third number
 * nobody could check against the other two.
 */
const MAX_RECIPIENTS_PER_SEND = EMAIL_MAX_RECIPIENTS_PER_SEND
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** How many audience documents one Firestore round trip fetches. */
const AUDIENCE_PAGE_SIZE = 500

/**
 * The read budget for resolving one audience — a ceiling on the SCAN, not a
 * silent cap on the answer.
 *
 * It is deliberately the largest window this file already spent (`contacts`
 * and list members read 5,000), so no audience costs more to resolve than it
 * did before; `leads` and `siteMembers` read 1,000 and now share the same
 * number, which is the point — a site with 3,000 leads was told its audience
 * was 1,000.
 *
 * Reaching it does not truncate anything silently. The resolution reports
 * {@link CampaignSendResult.audienceTruncated}, `audienceSize` becomes a
 * floor rather than a total, and the composer and the History row both say so.
 * An audience that regularly exceeds this is asking for the batched send §5d
 * of `docs/specs/email-overhaul.md` proposes, not a bigger number here.
 */
const AUDIENCE_SCAN_CEILING = 5000

/**
 * Page a query to exhaustion in document-name order.
 *
 * ## Why the read has to be ordered at all
 *
 * Firestore answers a `limit()` with no `orderBy` in document-id order, and
 * these ids are generated — so the old bare `limit(1000)` / `limit(5000)`
 * picked an arbitrary slice of any audience larger than the window, and the
 * merchant was told that slice was the whole audience. A cursor needs an
 * ordering regardless; this makes the selection explicable ("the first N by
 * document name") and stable across sends instead of merely bounded.
 *
 * ## Why the document NAME and not a date
 *
 * `orderBy(field)` drops every document that lacks that field, so ordering an
 * audience newest-first would silently un-invite people. There is no field
 * every writer of these four collections sets: list members carry `addedAt`
 * only when `enrollListMember` CREATED the row, and the newsletter handler
 * that wrote the collection before it stored `{ email, name, source }` and no
 * date at all — so `orderBy('addedAt')` would drop every newsletter
 * subscriber from every list campaign. `__name__` is the one key every
 * document has, and an unfiltered collection ordered by it needs no index.
 *
 * `startAfter` takes the SNAPSHOT rather than its id, so the cursor keeps
 * working if a filter is ever added ahead of the ordering.
 *
 * @returns the documents, and whether {@link AUDIENCE_SCAN_CEILING} — rather
 *          than the end of the collection — is what stopped the sweep. The
 *          flag is settled by one extra single-document read, so "more than
 *          5,000" is never claimed of a collection holding exactly 5,000.
 */
async function sweepAudience(base: FirebaseFirestore.Query): Promise<{
  docs: FirebaseFirestore.QueryDocumentSnapshot[]
  truncated: boolean
}> {
  const ordered = base.orderBy(
    firebaseAdmin.firestore.FieldPath.documentId(),
  )
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = []
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  for (;;) {
    const page = await (cursor ? ordered.startAfter(cursor) : ordered)
      .limit(AUDIENCE_PAGE_SIZE)
      .get()
    docs.push(...page.docs)
    cursor = page.docs[page.docs.length - 1]
    if (!cursor || page.docs.length < AUDIENCE_PAGE_SIZE) {
      return { docs, truncated: false }
    }
    if (docs.length >= AUDIENCE_SCAN_CEILING) {
      const probe = await ordered.startAfter(cursor).limit(1).get()
      return { docs, truncated: probe.docs.length > 0 }
    }
  }
}

/**
 * Stable doc id for a suppression entry (emails are PII — hash them).
 *
 * A WRITER's derivation now — `email-events.ts` files bounces and complaints
 * under it. The send path reads through `emailSuppressionKey`, which hashes
 * the same trimmed, lowercased form and additionally refuses to guess an id
 * for a value that is not an address.
 */
export function suppressionId(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex')
}

/** HMAC for unsubscribe links; env-gated on the shared secret. */
export function unsubscribeSignature(
  hostId: string,
  email: string,
  secret: string,
  /**
   * The campaign the link is riding in, when there is one.
   *
   * ADDITIVE, and it has to be: every email already sitting in an inbox
   * carries a two-part signature over `hostId:email`, and those links must go
   * on working forever — an unsubscribe link that stops honouring itself is
   * the one bug in this area with a legal edge on it. So the campaign is
   * appended to the signed string only when it is present, and the verifier
   * chooses which form to check by whether the link carries a `cid`. A link
   * with no `cid` is checked exactly as before.
   *
   * SIGNED rather than passed alongside. An unsigned `cid` would be an
   * attribution anybody holding one valid link could point at any campaign
   * they liked, which is a small forgery but a completely gratuitous one —
   * the campaign is already known at the moment the link is minted.
   */
  campaignId?: string,
  /**
   * The TOPIC the message belonged to, appended on the same rule and for a
   * sharper version of the same reason.
   *
   * The topic decides which stream the preference page offers to stop and
   * which one a one-click unsubscribe is attributed to. An unsigned `tid`
   * would be editable in the URL by anybody holding a link — including the
   * recipient — so a person could arrive at the preference page having
   * silently renamed the message they are unsubscribing from, and the
   * suppression record would carry the topic they chose rather than the one
   * that was sent. The topic is known at the moment the link is minted, so
   * there is nothing to trade for leaving it unsigned.
   *
   * The verifier's rules for reading these three forms unambiguously — and
   * why a colon in either id is refused — are in the email plugin's
   * `unsubscribe-link.ts`.
   */
  topicId?: string,
): string {
  const address = email.toLowerCase()
  const subject =
    topicId && campaignId
      ? `${hostId}:${address}:${campaignId}:${topicId}`
      : campaignId
        ? `${hostId}:${address}:${campaignId}`
        : `${hostId}:${address}`
  return createHmac('sha256', secret).update(subject).digest('hex')
}

/** Send failures carry the HTTP status the API route should answer. */
export class CampaignSendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

/**
 * The platform send rate had no room for this campaign THIS HOUR (AGL-2409).
 *
 * A subclass rather than a status code the caller has to recognise, because
 * the difference it carries is not "which HTTP number" — it is **retry, do not
 * fail**. A scheduled campaign that trips the hourly ceiling must go back to
 * `scheduled` and be picked up by the next 15-minute run; marking it `failed`,
 * which is what every other `CampaignSendError` correctly does, would turn a
 * ramp into a lost campaign that a merchant has to notice and re-create.
 *
 * Thrown ONLY before anything has been sent, so a caller that retries cannot
 * double-send.
 */
export class CampaignSendDeferredError extends CampaignSendError {
  constructor(
    message: string,
    /** When the hourly window rolls. */
    public readonly retryAtMs: number,
  ) {
    super(message, 429)
  }
}

export interface CampaignSendOptions {
  hostId: string
  subject: string
  body: string
  audience: string
  segmentId?: string
  listId?: string
  /**
   * The stream this campaign belongs to, chosen in the composer.
   *
   * Resolved to {@link DEFAULT_CAMPAIGN_TOPIC_ID} when absent, so every send
   * belongs to some topic: a campaign with none would mint an unsubscribe link
   * the preference page can render but not place, offering the recipient a
   * catalog without saying which entry the message in front of them was.
   */
  topicId?: string
  /**
   * Resolve the audience and return the count WITHOUT sending anything
   * (AGL-2178). Returns before the first write, so it mints no campaign
   * id and touches no counter.
   */
  dryRun?: boolean
  emails?: string[]
  campaignId?: string
  experimentId?: string
  /**
   * Designed email template (AGL-349): screen id of a besigner email
   * document. When set, the render pipeline produces the HTML body and
   * `body` becomes the plain-text fallback.
   */
  templateScreenId?: string
  /**
   * The sender's DISPLAY NAME for this campaign, overriding the org's
   * branding default.
   *
   * A display name and nothing more: `applyFromName` keeps the verified
   * address it is applied to, so this cannot move the mail onto a domain the
   * org has not proved. The route strips control characters before it gets
   * here, because the value is merchant-typed and lands in a header.
   */
  fromName?: string
  /** Where replies go, when it is not the sending address. */
  replyTo?: string
  /**
   * The CAMPAIGN this send belongs to — `hosts/{hostId}/emailCampaigns/{id}`.
   *
   * Not the send's own id, which is what `campaignId` means here and what
   * every delivered unsubscribe link carries as `cid`. Absent on a send
   * composed outside a campaign, and on every send that predates containers;
   * the campaigns list adopts those as a campaign of one at read time rather
   * than rewriting them.
   */
  emailCampaignId?: string
  /**
   * The preview line inboxes show after the subject. Overrides a designed
   * template's own, and gives a plain-text campaign one at all.
   */
  preheader?: string
  /** Test sends (AGL-349) skip the campaign record and stats. */
  recordCampaign?: boolean
  /**
   * The requester's OWN verified address, for the composer's test send
   * (AGL-349). Exempts exactly this address from the marketing-consent rule.
   *
   * See the carve-out at the consent join for why a proof of your own draft
   * is not a marketing send, and for the two properties that keep the
   * exemption one address wide.
   */
  selfProofFor?: string
  /** Recorded as `sentBy`; the scheduler passes the scheduling user. */
  senderUid: string
}

/**
 * Loads a designed email template's nodes + referenced products for the
 * render pipeline. Throws 400 when the screen isn't an email document.
 */
async function loadEmailTemplate(hostId: string, screenId: string) {
  const firestore = firebaseAdmin.app().firestore()
  const screenRef = firestore
    .collection('hosts')
    .doc(hostId)
    .collection('screens')
    .doc(screenId)
  const screenSnapshot = await screenRef.get()
  if (!screenSnapshot.exists) {
    throw new CampaignSendError('Unknown email template', 400)
  }
  const versionId = screenSnapshot.get('versionId')
  const versionSnapshot = versionId
    ? await screenRef.collection('versions').doc(String(versionId)).get()
    : null
  /**
   * Decoded, because a `kind: 'email'` screen is a SCREEN document and its
   * versions are compressed msgpack `Bytes` from the first designer save
   * onward (AGL-1394). `createEmailScreen` writes it under
   * `hosts/{h}/screens/{id}` and the Emails list opens it in the SCREEN
   * besigner, which saves through `use-screen-version`'s converter —
   * `Bytes.fromUint8Array(compress(nodes))`. Only the very first version,
   * seeded from a JSON body through `/api/hosts/versions`, is a plain map.
   *
   * `publish-email-template.ts` reading `nodes` raw is not evidence that this
   * one may: that reads `emailTemplates`, a different collection whose
   * besigner saves with a bare `setDoc` and no converter.
   *
   * The guard below is why this was silent rather than loud. `Object.keys` of
   * a Buffer yields the byte INDICES, so a compressed version read as a
   * populated template, `Object.values` found no `emailProduct` node, and a
   * designed campaign went out to real customer inboxes with its product
   * blocks missing — discovered by the recipients. Decoding first is also what
   * makes the guard mean something: `decodeStoredNodes` returns null for an
   * undecodable payload, so the send is refused instead of mailed empty.
   */
  const nodes = (decodeStoredNodes(versionSnapshot?.get('nodes')) ??
    {}) as Record<string, any>
  if (!Object.keys(nodes).length) {
    throw new CampaignSendError('The email template is empty', 400)
  }
  /**
   * The marketplace kill switch, reaching an email somebody already installed
   * (AGL-657's copy-on-install is what makes this necessary).
   *
   * An installed starter is a copy in this site's own screens, so every other
   * marketplace lever — unpublish, takedown, a rejected version — stops at the
   * storefront and is felt by nobody who already has the design. The kill is
   * the one that has to reach a tenant who installed last week and is sending
   * today, and this is the only chokepoint every campaign passes through.
   *
   * It refuses the SEND and leaves the document alone. The tenant keeps the
   * design, keeps editing it, keeps previewing it; what they cannot do is put
   * it on the sending domain every other tenant shares. Reaching into somebody
   * else's content to enforce a decision about a third party's artifact would
   * take the wrong thing away.
   *
   * Read off the VERSION first, then the screen: the version is the document
   * these bytes came out of, and a screen whose design was later replaced
   * wholesale should be judged on what it is now. Costs one document read on a
   * design that carries no marketplace provenance at all, which is every email
   * a site wrote itself — the `listingId` guard inside `emailStarterSendBlock`
   * is what keeps that read from happening.
   */
  const installedFrom = (versionSnapshot?.get('installedFrom') ??
    screenSnapshot.get('installedFrom')) as
    | { listingId?: string | null; version?: string | null }
    | undefined
  if (installedFrom?.listingId) {
    const revocation = (
      await firestore.collection('revocations').doc(installedFrom.listingId).get()
    ).data() as PluginRevocation | undefined
    const block = emailStarterSendBlock({ installedFrom, revocation })
    if (block) throw new CampaignSendError(block.reason, 409)
  }
  // Resolve emailProduct references (by id — rename-safe, AGL-343).
  const productIds = [
    ...new Set(
      Object.values(nodes)
        .filter((node: any) => node?.componentId === 'emailProduct')
        .map((node: any) => String(node?.props?.productId ?? ''))
        // AGL-1771: a besigner node prop is merchant-authored and reaches
        // `.doc()` below, where a slash-bearing value throws and turns the
        // whole send into a 500. Dropped rather than refused: the block simply
        // resolves to no product, exactly as it does for a deleted one, and a
        // designed campaign is not worth blocking over one bad reference.
        .filter(isDocumentId),
    ),
  ].slice(0, 20)
  const products: Record<string, EmailRenderProduct> = {}
  await Promise.all(
    productIds.map(async (productId) => {
      const productSnapshot = await firestore
        .collection('hosts')
        .doc(hostId)
        .collection('products')
        .doc(productId)
        .get()
      if (!productSnapshot.exists) return
      const data = productSnapshot.data() as any
      const [minPrice] = productPriceRange(data)
      products[productId] = {
        name: String(data.name ?? productId),
        priceLabel: minPrice ? `$${minPrice}` : undefined,
        imageUrl: data.imageUrl ?? data.mediaUrls?.[0],
        url: data.slug ? `/products/${data.slug}` : undefined,
      }
    }),
  )
  return {
    nodes,
    products,
    subject: String(screenSnapshot.get('emailSubject') ?? ''),
    preheader: String(screenSnapshot.get('emailPreheader') ?? ''),
  }
}

/**
 * Campaign delivery core (AGL-161, extracted for AGL-272): resolves the
 * audience server-side, drops suppressed addresses, enforces the plan's
 * monthly send cap, personalizes merge tags per recipient, and delivers
 * through Resend with a signed unsubscribe link. Shared by the
 * authenticated send route and the scheduled-campaign processor. The
 * caller owns authorization.
 */
export interface CampaignSendResult {
  campaignId: string
  /** Addresses this send ADDRESSED — the audience after the per-send cap. */
  recipients: number
  sent: number
  /**
   * The whole audience, deduplicated and validated, BEFORE the per-send cap.
   *
   * Reported separately from `recipients` because the two differ whenever an
   * audience is larger than one send may carry, and a merchant who is only
   * shown the smaller number has no way to learn that the rest were never
   * mailed. `recipients` of 500 against an `audienceSize` of 3,000 is the
   * whole point of the field.
   *
   * Named for the SIZE because `audience` on the options and on the stored
   * campaign is the audience KIND — `'leads'`, `'list'` — and one word
   * meaning both a name and a count on the same send path is how the two get
   * read into each other.
   */
  audienceSize: number
  /**
   * `audienceSize` is a FLOOR, not a total: the resolution stopped at its
   * read ceiling with documents still unread. Absent means it is exact.
   */
  audienceTruncated?: boolean
  /**
   * Dry run only (AGL-2178): recipients that will actually be mailed —
   * after the consent join, the per-send cap and both suppression lists.
   */
  sendable?: number
  /** Dry run only: of `audienceSize`, how many carry a recorded consent basis. */
  consented?: number
  /**
   * Dry run only: of `consented`, how many hold a basis an OPERATOR asserted
   * on their behalf rather than one they gave — a backfill over seed data,
   * say. A subset of `consented` and not a fourth population.
   */
  consentedByOperator?: number
  /**
   * Dry run only: of `audienceSize`, how many are reachable only because
   * consent enforcement is not retroactive. This is the population a strict
   * policy would remove.
   */
  grandfathered?: number
  /** Dry run only: how many of `audienceSize` the consent rule refused. */
  consentWithheld?: number
  /** Dry run only: how many of `recipients` are suppressed. */
  suppressed?: number
  /** Dry run only: which sending identity this campaign would leave on. */
  identity?: string
  /** Dry run only: `'custom'` for a verified tenant domain, else `'platform'`. */
  identitySource?: 'custom' | 'platform' | null
  dryRun?: boolean
  /** Recipients the hourly governor refused mid-batch (AGL-2409). */
  deferred?: number
}

export async function performCampaignSend(
  options: CampaignSendOptions,
): Promise<CampaignSendResult> {
  const unsubscribeSecret =
    process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET
  if (!isEmailConfigured() || !unsubscribeSecret) {
    throw new CampaignSendError(
      'Campaigns are not configured (RESEND_API_KEY, USAGE_EMAIL_FROM, ' +
        'EMAIL_UNSUBSCRIBE_SECRET).',
      501,
    )
  }
  const { hostId, subject, body, audience } = options

  // AGL-1771: every optional id on `options` becomes a `.doc()` argument
  // below, and `.doc()` appends a SLASH-SEPARATED path rather than taking one
  // opaque id — so an unvalidated one names the nesting as well as the
  // document. `campaignId` is the one that matters most: it is WRITTEN at the
  // bottom of this function, so `a/b/c` filed the campaign at
  // `campaigns/a/b/c`, beneath a document that does not exist and therefore
  // invisible to the merchant's own campaigns list — and it is the same value
  // that comes back on every Resend tag days later (AGL-1768), which is why
  // tracing where an id was MINTED matters more than where it was last
  // handled. The rest are read-only, where the cost is a 500 dressed up as an
  // outage rather than a stray document; refused here so the caller is told
  // which id was wrong.
  //
  // `hostId` is deliberately NOT guarded here, and that is measured rather
  // than overlooked: both callers prove it first — the handler resolves the
  // host document and checks the caller's role on it before calling in, and
  // the scheduled processor passes `hostRef.id` off a document it just read. A
  // guard here could not fail today. A third caller would need to earn that.
  for (const [name, value] of [
    ['campaignId', options.campaignId],
    ['experimentId', options.experimentId],
    ['templateScreenId', options.templateScreenId],
    ['segmentId', options.segmentId],
    ['listId', options.listId],
  ] as const) {
    if (value && !isDocumentId(value)) {
      throw new CampaignSendError(`Invalid ${name}`, 400)
    }
  }
  /*
   * `topicId` is checked against its OWN predicate, not `isDocumentId`.
   *
   * It is a path component like the others, but it is also a colon-joined
   * component of the unsubscribe link's signed subject, and `isDocumentId`
   * permits a colon. Signing one would let a single subject string be read as
   * two different parameter tuples — see `signedSubject` in the email plugin's
   * `unsubscribe-link.ts`. Refused at the point the topic ENTERS the send, so
   * the link that leaves it is unambiguous by construction.
   */
  if (options.topicId && !isEmailTopicId(options.topicId)) {
    throw new CampaignSendError('Invalid topicId', 400)
  }
  const topicId = options.topicId || DEFAULT_CAMPAIGN_TOPIC_ID

  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    throw new CampaignSendError('Unknown site', 404)
  }

  /*
    Audience resolution. Names ride along for merge tags (AGL-272).

    ⚠️ THE FIELD NAME IS PER COLLECTION AND THEY DO NOT AGREE (AGL-2303).
    `contacts` and `leads` store `name`; `siteMembers` stores `displayName`.
    A merge tag whose source field does not exist does not error — it
    substitutes an empty string into mail that has already been sent. Whenever
    an audience is added here, check what its collection actually writes.
  */
  let recipients: string[]
  /**
   * Set when {@link AUDIENCE_SCAN_CEILING} stopped the resolution, so
   * `audience` below is a floor and every number derived from it says so.
   * A `manual` audience arrives whole in the request and can never be one.
   */
  let audienceTruncated = false
  /**
   * The list's name as it stands at the moment of the send.
   *
   * Recorded on the campaign rather than looked up when a report is read, for
   * the reason every other send-time figure is recorded: a list can be
   * renamed or deleted, and resolving the name later either rewrites the
   * history of a campaign that went out months ago or loses it entirely. The
   * campaign went to the list under this name, and that stays true.
   */
  let listName = ''
  const names = new Map<string, string>()
  /*
   * The consent facts ride out of the audience sweep with the names
   * (`docs/specs/email-overhaul.md` §3f), because paging the audience is the
   * only point in the send where the person's DOCUMENT is in hand.
   *
   * That placement is the correction §3f carries: consent is a property of
   * the PERSON, knowable while the sweep is already reading them, where
   * suppression is a per-address keyed lookup deliberately deferred until
   * after the cap. Reading consent back later would be a second pass over
   * every silo, per campaign, to recover data this loop already had.
   *
   * An audience whose members carry no consent field records an `unrecorded`
   * basis — a THIRD state, handled by the policy, and never a quiet `true`.
   */
  const consent = new Map<string, MarketingConsentRecord>()
  const collectConsent = (email: string, data: unknown) => {
    const cleaned = email.trim().toLowerCase()
    if (!cleaned) return
    consent.set(
      cleaned,
      readMarketingBasis(data as Record<string, unknown> | null | undefined),
    )
  }
  const collectName = (email: string, name: unknown) => {
    const cleaned = email.trim().toLowerCase()
    if (cleaned && typeof name === 'string' && name.trim()) {
      names.set(cleaned, name.trim())
    }
  }
  if (audience === 'leads') {
    const leads = await sweepAudience(hostRef.collection('leads'))
    audienceTruncated = leads.truncated
    recipients = leads.docs.map((doc) => {
      const email = String(doc.get('email') ?? '')
      collectName(email, doc.get('name'))
      collectConsent(email, doc.data())
      return email
    })
  } else if (audience === 'members') {
    const members = await sweepAudience(hostRef.collection('siteMembers'))
    audienceTruncated = members.truncated
    recipients = members.docs.map((doc) => {
      const email = String(doc.get('email') ?? '')
      /*==========================================
       * `displayName`, NOT `name` (AGL-2303).
       *
       * `siteMembers` has never had a `name` field — sign-up, the account
       * page and the admin password route all write `displayName`. So this
       * read matched nothing on every member campaign ever sent, `names` was
       * empty for the whole audience, and `{{contact.name}}` and
       * `{{contact.firstName}}` rendered as EMPTY STRINGS in mail that went
       * out to real people. `resolveMergeTags` substitutes rather than
       * failing, so nothing errored and nothing looked wrong here.
       *
       * `name` is kept as a fallback and read second: a lead promoted to a
       * member, or a future writer, may carry either.
       *=========================================*/
      collectName(email, doc.get('displayName') ?? doc.get('name'))
      collectConsent(email, doc.data())
      return email
    })
  } else if (audience === 'segment') {
    // Contact segments (AGL-199): resolve the saved filter against the
    // contacts collection server-side.
    const segmentId = String(options.segmentId ?? '')
    const segmentSnapshot = segmentId
      ? await (await orgDataCollectionForHost(hostId, 'contactSegments')).doc(segmentId).get()
      : null
    // A doc get cannot carry the scope filter, so check after the read
    // (AGL-1039). Reported as "unknown" rather than "forbidden": whether a
    // segment exists in another site's scope is not this caller's business.
    if (
      !segmentSnapshot?.exists ||
      !visibleToHost(segmentSnapshot.get('visibleTo'), hostId)
    ) {
      throw new CampaignSendError('Unknown segment', 400)
    }
    const segment = {
      tags: segmentSnapshot.get('tags') ?? [],
      sources: segmentSnapshot.get('sources') ?? [],
    }
    // Scoped (AGL-1039): a campaign sent from one site must not reach
    // another site's audience — the agency case is a client's campaign
    // blasting the whole org's contact list.
    /*
     * The only audience whose sweep carries a FILTER, and the reason the
     * ordering is `__name__` rather than a field: Firestore's automatic
     * single-field index for an array member is keyed on that value and the
     * document name, so `array-contains-any` plus `orderBy(__name__)` is
     * served by it. Ordering on any other field would need a composite index
     * per audience — `cloud/firebase-firestore.indexes.json` carries exactly
     * that shape for `media`, and a missing one fails the whole send.
     */
    const contacts = await sweepAudience(
      (await orgDataQueryForHost(hostId, 'contacts')).query,
    )
    /*
     * A segment's membership is decided HERE rather than by the query — the
     * tag and source rules are evaluated in `contactMatchesSegment` against
     * documents the scan already fetched — so the ceiling bounds CONTACTS
     * READ, not contacts matched. A narrow segment over a large org therefore
     * reports a small `audienceSize` with `audienceTruncated` set, reading as
     * "at least this many, we stopped counting" and not as a total.
     */
    audienceTruncated = contacts.truncated
    recipients = contacts.docs
      .filter((doc) =>
        contactMatchesSegment(
          { tags: doc.get('tags') ?? [], sources: doc.get('sources') ?? {} },
          segment,
        ),
      )
      .map((doc) => {
        const email = String(doc.get('email') ?? '')
        collectName(email, doc.get('name'))
        collectConsent(email, doc.data())
        return email
      })
  } else if (audience === 'list') {
    // Org lists (AGL-254): static audiences enrolled manually or by the
    // enrollList automation step.
    const listId = String(options.listId ?? '')
    const listRef = listId
      ? (await orgDataCollectionForHost(hostId, 'contacts')).parent
          ?.collection('lists')
          .doc(listId)
      : null
    if (!listRef) throw new CampaignSendError('Unknown list', 400)
    // One document beside a sweep that reads up to the audience ceiling, and
    // the only place the name is knowable without a second round trip later.
    listName = String((await listRef.get()).get('name') ?? '')
    const members = await sweepAudience(listRef.collection('members'))
    audienceTruncated = members.truncated
    recipients = members.docs.map((doc) => {
      const email = String(doc.get('email') ?? '')
      collectName(email, doc.get('name'))
      collectConsent(email, doc.data())
      return email
    })
  } else {
    recipients = Array.isArray(options.emails)
      ? options.emails.map((value: unknown) => String(value))
      : []
  }
  /*
   * The AUDIENCE — deduplicated and validated, and deliberately measured
   * BEFORE the per-send cap.
   *
   * The cap and the audience are two different numbers and the composer has
   * always shown only the smaller one, which is how a site with 3,000 leads
   * was told its audience was 500 and never found out the other 2,500 were
   * not being mailed. Every result from here down carries both, so a send can
   * report "reached N of M" rather than reporting N as if it were M.
   */
  const resolved = [
    ...new Set(
      recipients
        .map((email) => email.trim().toLowerCase())
        .filter((email) => EMAIL_PATTERN.test(email)),
    ),
  ]
  if (!resolved.length) {
    throw new CampaignSendError('The audience is empty', 400)
  }

  /*
   * THE CONSENT JOIN (`docs/specs/email-overhaul.md` §3f).
   *
   * `marketingConsent` had seven writers and no reader on any send path, so a
   * recorded opt-OUT reached the same inbox as a recorded opt-in.
   *
   * ## Why HERE, above the cap, and not beside suppression
   *
   * §3f used to say "after suppression and before the cap", which is not an
   * order this file has ever had — the cap runs first and suppression after
   * it. Consent belongs at the SWEEP: it is a property of the person, already
   * read into `consent` by the loop above at no extra cost, so filtering on
   * it before the cap means the 500 slots go to people who may actually be
   * mailed. Suppression stays where it is, because it is a keyed lookup per
   * address and moving it up would cost the whole audience in reads on every
   * debounced preview.
   *
   * It is also, necessarily, before the meter claim: a recipient the rule
   * withholds is never counted against the org's monthly allowance. Being
   * charged for mail that policy forbids sending would make the consent rule
   * cost the merchant money as well as reach.
   *
   * ## What it does to an audience that exists today
   *
   * NOT retroactive by default. `resolveMarketingConsentPolicy` answers
   * `mode: 'forward'` for an org that has configured nothing, which keeps
   * every address captured before the cutoff reachable and reports it as
   * grandfathered rather than mailing it silently. The one thing enforced
   * unconditionally is a STORED refusal, which no policy may mail.
   *
   * The retroactive mode can shrink an audience sharply, so it is a stored
   * per-org setting and never a default. The split below is what makes that
   * decision informed — it rides the same readout as `audienceSize`, so a
   * merchant sees which population is which before sending.
   *
   * The org is resolved here rather than at the quota block below because the
   * policy lives on it and this is the first thing that needs it; the quota
   * lines further down reuse the same read rather than taking a second one.
   */
  const orgForHost = await getOrgForHost(hostId).catch(() => null)
  const orgId = String(orgForHost?.orgId ?? '')
  const consentPolicy = resolveMarketingConsentPolicy(
    (orgForHost?.org as Record<string, unknown> | undefined)?.[
      'marketingConsentPolicy'
    ],
  )
  /*
   * THE SELF-PROOF CARVE-OUT.
   *
   * A proof delivered to the requester's own verified address is not a
   * marketing send. The recipient is the person who pressed the button, and
   * the consent rule exists to protect somebody from mail they did not ask
   * for — which is not something you can do to yourself.
   *
   * Without this the composer's test send is dead under `strict`: it delivers
   * to the caller's account address through the `manual` audience, a
   * hand-typed address is backed by no document, and `unrecorded` is withheld
   * before reaching the clause that grandfathers a record carrying no capture
   * date. Proofing your own email would be refused on consent grounds.
   *
   * ⚠️ TWO PROPERTIES KEEP THE EXEMPTION ONE ADDRESS WIDE, and both are here
   * rather than at the call site, because a caller that could widen it is
   * exactly what this must not be:
   *
   *   1. The address must ALREADY be in the resolved audience. The option can
   *      therefore only exempt a recipient, never introduce one — passing an
   *      address that is not being sent to does nothing at all.
   *   2. A stored `declined` is still refused, below. A refusal is the one
   *      thing no policy may mail, and a self-proof is not the first
   *      exception to it: an admin who declined marketing to their own site
   *      un-declines rather than being quietly overridden.
   */
  const proofFor = String(options.selfProofFor ?? '')
    .trim()
    .toLowerCase()
  const proofAddress = proofFor && resolved.includes(proofFor) ? proofFor : ''
  if (proofAddress && consent.get(proofAddress)?.basis === 'declined') {
    throw new CampaignSendError(
      'Your account address has a recorded marketing opt-out on this site, ' +
        'so the test send was not delivered. Opt back in to proof designed ' +
        'emails to yourself.',
      400,
    )
  }
  const consentSplit = splitByMarketingConsent(
    proofAddress ? resolved.filter((one) => one !== proofAddress) : resolved,
    consent,
    consentPolicy,
  )
  if (proofAddress) consentSplit.mailable.unshift(proofAddress)
  if (!consentSplit.mailable.length) {
    throw new CampaignSendError(
      'No recipient in this audience has a marketing consent record, so ' +
        'nothing has been sent. Add an opt-in checkbox to the form or sign-up ' +
        'this audience comes from, or send to an audience that has one.',
      400,
    )
  }

  /*
   * The cap takes the FIRST N of a stable order, which is what makes taking
   * some of the audience defensible at all: two sends of the same unchanged
   * audience now address the same people, and which people is answerable
   * ("the first N by document name"). It was previously whichever slice
   * Firestore happened to return.
   */
  recipients = consentSplit.mailable.slice(0, MAX_RECIPIENTS_PER_SEND)

  /*
   * BOTH suppression lists, on one derivation (D6 of
   * `docs/specs/email-overhaul.md`).
   *
   * This read used to be the site's own list alone, so an address that hard
   * bounced or reported spam on any OTHER send — another site in the org, or
   * transactional mail carrying no site tag, which is where most of the
   * platform list comes from — was mailed anyway. Every tenant's campaigns
   * leave by one sending domain under `p=reject`, so that is not one
   * merchant's deliverability, it is everyone's.
   *
   * Checked on the capped list rather than the whole audience on purpose: it
   * is a keyed lookup per address, so its cost is the size of what is being
   * mailed, and asking about people this send will not reach would buy a
   * larger read for a number nobody acts on.
   */
  const notSuppressed = await filterSendableForHost(
    hostId,
    recipients,
    firestore,
  )
  /*
   * The THIRD list, and the narrowest: who has left THIS stream.
   *
   * After the two suppression lists rather than before them, because it is the
   * weaker fact and the weaker fact should never be the one that decides. A
   * person who unticked "Promotions and offers" is still a subscriber; a
   * person on either suppression list is not, and asking about their topic
   * preferences would be a read taken on a question already answered.
   */
  const sendable = await filterTopicSendable(
    hostId,
    topicId,
    notSuppressed,
    firestore,
  )
  if (!sendable.length) {
    throw new CampaignSendError(
      'Every recipient has unsubscribed or been suppressed',
      400,
    )
  }

  // Monthly cap by the owning org's plan (dark-launch rule, AGL-238).
  //
  // A campaign is the ONLY send a quota may refuse (AGL-1438). It is
  // discretionary — the customer sees a clear message, and upgrades or waits —
  // where refusing a receipt or a password reset would convert a billing event
  // into an outage on their business. So this is measured against
  // `campaignEmailSends` and NOT against `emailSends`, which since AGL-1438
  // also carries every order confirmation, booking reminder and workflow
  // notification the site sent. Enforcing the campaign cap against that total
  // would refuse a campaign because the store had a busy week of orders.
  //
  // SINCE AGL-2267 THE COUNTER IS PER ORG AND THE CLAIM IS ATOMIC. The cap was
  // enforced against `hosts/{hostId}/counters/campaignEmailSends` — per SITE —
  // while `emailSendsPerMonth` is an ORG entitlement, so an org with N sites
  // got N × the cap it bought. And it was read here and incremented after
  // delivery, so two concurrent campaigns both passed the same reading. See
  // `email-metering.ts` for the counter, the transition, and why the existing
  // per-site counters were NOT folded in.
  const monthKey = new Date().toISOString().slice(0, 7)
  // Plan-less orgs resolve as free (AGL-247) — the cap always runs. The org
  // document is read ONCE, at the consent join above, and reused here and for
  // branding below; both used to re-fetch it.
  // The limit itself, read through the one shared resolver. `checkQuota` with
  // a usage of 0 is how a plain limit is read; the ALLOW/REFUSE decision is
  // not made here — it is made by the atomic reservation below.
  const campaignSendLimit = checkQuota(
    orgForHost?.org as any,
    'emailSendsPerMonth',
    0,
  ).limit
  const overCapError = () =>
    new CampaignSendError(
      `Monthly campaign email limit reached (${campaignSendLimit}) — upgrade ` +
        'in Billing or shrink the audience. Transactional mail — receipts, ' +
        'booking reminders, password resets — keeps sending.',
      403,
    )
  {
    // A cheap read-only pre-check, so an over-cap campaign is refused before
    // the template load, the experiment read and the campaign id — and so the
    // DRY RUN has an answer without writing anything (AGL-2178: "nothing has
    // been written above this line"). It is not the enforcement; it cannot be,
    // because a read is not a claim.
    const used = await orgCampaignEmailSendsForMonth(orgId, monthKey)
    if (used + sendable.length > campaignSendLimit) throw overCapError()
  }

  /*
   * Recipient PREVIEW (AGL-2178). The campaign composer mockup shows
   * `Recipients 1,240` beside the audience picker, and the console had no
   * count before a send at all — the number appeared afterwards, in a
   * snackbar.
   *
   * It returns from HERE rather than from a counting function of its own,
   * and that is the whole point: the figure has already been through
   * audience resolution, normalisation, de-duplication, the
   * `MAX_RECIPIENTS_PER_SEND` cap, both suppression lists and the monthly
   * quota. A second implementation would be a second set of rules to
   * drift, and the one number a merchant checks before pressing Send is
   * the worst possible place for an estimate that disagrees with what
   * happens.
   *
   * `audience` rides along so the composer can show the SHORTFALL rather
   * than only the send size. The preview is the surface a merchant reads
   * before deciding, so it is the surface on which "your audience is 3,000
   * and this send reaches 500" has to appear.
   *
   * Nothing has been written above this line — every step so far is a
   * read — so an early return here leaves no campaign document, no
   * counter and no id behind.
   */
  /*
   * THE SENDING IDENTITY, and the refusal when it is not usable.
   *
   * Resolved ABOVE the dry run on purpose. `preview` is where a merchant finds
   * out what a send will do before writing copy, so it must answer the same
   * question a real send would — both which identity the mail leaves on, and
   * whether it may leave at all. Resolving after this point would let
   * `preview` report a healthy dry run for a campaign that Send then refuses.
   *
   * The address comes from the org document by way of the host's selection,
   * never from `options`. A `From:` assembled from request input is the
   * spoofing path the verified-identity rule exists to close.
   *
   * A refusal is a 409 rather than a silent no-op because that is the whole
   * point: `USAGE_EMAIL_FROM` was empty in production for weeks and no surface
   * ever said so, since every sender treats mail as best-effort. A tenant
   * whose DNS is unfinished has to be told, by name, at the composer.
   */
  const sendingIdentity = await resolveHostSendingIdentity({
    orgId,
    selectedDomain: hostSnapshot.get('sendingDomain'),
    selectedLocalPart: hostSnapshot.get('sendingLocalPart'),
  })
  const identityRefusal = sendingIdentityRefusal(sendingIdentity)
  if (identityRefusal) {
    const missing = identityRefusal.missing?.length
      ? ` Missing: ${identityRefusal.missing.join(', ')}.`
      : ''
    throw new CampaignSendError(`${identityRefusal.message}${missing}`, 409)
  }

  if (options.dryRun) {
    return {
      campaignId: '',
      recipients: recipients.length,
      audienceSize: resolved.length,
      ...(audienceTruncated ? { audienceTruncated: true } : {}),
      sendable: sendable.length,
      suppressed: recipients.length - sendable.length,
      /*
       * The consent split, measured over the WHOLE audience and named rather
       * than netted (§3f).
       *
       * Over the whole audience, not over the capped 500, because it rides
       * the same readout as `audienceSize` and answers a question about the
       * audience: of the 3,200 people this list holds, how many asked for
       * this mail? Reporting it over the capped set would make the figures
       * move whenever the cap bit, for reasons that have nothing to do with
       * consent.
       *
       * Three numbers because one would hide the thing a merchant has to
       * decide about. `consented` is who has a basis; `grandfathered` is who
       * is reachable only because enforcement is not retroactive, and is
       * therefore exactly the population that disappears the day the org
       * turns the strict mode on; `consentWithheld` is who the rule already
       * refuses.
       *
       * `consentedByOperator` splits the first of those, because "who has a
       * basis" and "who asked" stopped being the same question once a basis
       * could be asserted on somebody's behalf. Reporting only the total
       * would present an operator backfill as that many opt-ins, which is
       * the one thing the provenance field exists to prevent.
       */
      consented: consentSplit.consented,
      consentedByOperator: consentSplit.consentedByOperator,
      grandfathered: consentSplit.grandfathered,
      consentWithheld: consentSplit.withheld,
      // Which identity this campaign would leave on, so the composer can say
      // so rather than leaving a merchant to assume.
      identity: sendingIdentity.summary,
      identitySource: sendingIdentity.source,
      sent: 0,
      dryRun: true,
    }
  }

  // `hostPublicOrigin`, not a hand-rolled apex (AGL-2195). Campaign links are
  // mailed out and clicked days later; a wrong apex sends the operator's whole
  // audience to a domain the operator does not control.
  const siteBase =
    hostPublicOrigin({
      cname: hostSnapshot.get('cname'),
      subdomain: hostSnapshot.get('subdomain'),
    }) ?? ''

  // White-label sender identity (White-Label Phase 3): a campaign sent from a
  // white-label store reads as that store's brand. Resolved once for the whole
  // batch from the owning org doc through the one shared resolver.
  const branding = resolveBrandingProfile(orgForHost?.org as never)

  const campaignId = options.campaignId || createResourceUid()

  // Designed email template (AGL-349): loaded once; rendered per
  // recipient with their merge values.
  const template = options.templateScreenId
    ? await loadEmailTemplate(hostId, options.templateScreenId)
    : null

  // Email A/B (AGL-255): each recipient deterministically lands in a
  // variant whose subject/body overrides apply; sends count as that
  // variant's exposures. A finished experiment sends the winner copy.
  const experimentId = String(options.experimentId ?? '')
  let experiment: (HostExperiment & { $id: string }) | null = null
  if (experimentId) {
    const experimentSnapshot = await hostRef
      .collection('experiments')
      .doc(experimentId)
      .get()
    const data = experimentSnapshot.data() as HostExperiment | undefined
    if (
      !experimentSnapshot.exists ||
      !data ||
      data.target !== 'email' ||
      (data.status !== 'running' && !data.winnerVariantId)
    ) {
      throw new CampaignSendError('Pick a running email experiment', 400)
    }
    experiment = { $id: experimentSnapshot.id, ...data }
  }
  /*
   * PLATFORM SEND-RATE ADMISSION CONTROL (AGL-2409).
   *
   * `sendEmail` governs every message individually and is the hard ceiling.
   * This is the admission check in front of it, and it exists for one reason:
   * without it, a campaign that does not fit in the current hour would deliver
   * to the first N addresses and stop, and a scheduled campaign in that state
   * cannot be retried without double-sending the N that already went.
   *
   * Asking for room for the WHOLE batch up front turns the ordinary case into
   * "all of it, or none of it and try again next run". A read, not a claim —
   * two campaigns can still both pass this and then contend at the per-message
   * governor, which is why the loop below also handles a mid-batch refusal
   * rather than assuming this settled it.
   */
  {
    const [config, window] = await Promise.all([
      readEmailSendRateConfig(),
      readEmailSendRateWindow(),
    ])
    if (config.enabled && window.used + sendable.length > config.perHour) {
      throw new CampaignSendDeferredError(
        `The platform is sending at its hourly limit (${config.perHour}/hour). ` +
          'This campaign has not been sent and nothing has been counted — it ' +
          'will go out automatically on the next run, or you can send it again ' +
          'after the hour rolls.',
        window.resetMs,
      )
    }

    /*
     * THIS WORKSPACE'S SHARE OF THAT HOUR.
     *
     * The check above bounds the platform; it does not bound how much of the
     * platform one tenant may take. Without this, an org with a large audience
     * occupies the whole hour and every other customer's campaigns are refused
     * by a ceiling they did nothing to reach.
     *
     * The ceiling is DERIVED from the live platform ceiling
     * (`orgHourlyCampaignCeiling`), so a staff ramp moves both together and
     * the two can never contradict each other. See `send-ceilings.ts` for the
     * arithmetic tying this to the per-send cap and the plan allowance.
     *
     * A deferral, not a refusal: the campaign stays a draft, the audience is
     * untouched, no list membership changes and no suppression or delivery
     * record is affected. A send is a flow rather than a holding, which is the
     * one place the enforce-at-the-reduction rule does not reach — refusing a
     * flow strands nobody's data.
     *
     * Taken BEFORE the monthly claim so that a workspace deferred for the hour
     * has not spent a month's allowance on a campaign that did not go.
     */
    const hourly = await claimOrgEmailSendBudget({
      orgId,
      count: sendable.length,
      platformPerHour: config.perHour,
      enabled: config.enabled,
    })
    if (!hourly.allowed) {
      throw new CampaignSendDeferredError(
        `This workspace may send ${hourly.ceiling.toLocaleString()} campaign ` +
          `emails an hour and has sent ${hourly.used.toLocaleString()} this ` +
          `hour, so there is room for ${hourly.remaining.toLocaleString()} ` +
          `and this campaign needs ${sendable.length.toLocaleString()}. ` +
          'Nothing has been sent and nothing has been counted — the campaign ' +
          'is unchanged and will go out automatically on the next run, or you ' +
          'can send it again after the hour rolls. Transactional mail — ' +
          'receipts, booking reminders, password resets — keeps sending.',
        hourly.retryAtMs,
      )
    }
  }

  /*
   * THE MONTHLY CLAIM (AGL-2267), taken here and not at the pre-check above.
   *
   * As late as possible on purpose: everything between the pre-check and this
   * line can throw (an unknown template, a stopped experiment), and a claim
   * taken before them would leak the org's allowance for the rest of the month
   * on a campaign that never existed. From here to the `finally` below there
   * is nothing that can throw before the reconcile runs.
   */
  const claim = await reserveCampaignEmailSends({
    orgId,
    month: monthKey,
    count: sendable.length,
    limit: campaignSendLimit,
  })
  if (!claim.ok) throw overCapError()
  const reservation: CampaignSendReservation = claim.reservation

  const variantSends: Record<string, number> = {}
  let sent = 0
  /** Recipients the hourly governor refused mid-batch, if any. */
  let deferred = 0
  try {
    for (const email of sendable) {
      // `cid` is what lets an unsubscribe be attributed to the campaign that
      // caused it. Without it the suppression list records that somebody left
      // and nothing about which mailing they left over, which is the one
      // question an unsubscribe rate exists to answer.
      const signature = unsubscribeSignature(
        hostId,
        email,
        unsubscribeSecret,
        campaignId,
        topicId,
      )
      const signedQuery =
        `hostId=${encodeURIComponent(hostId)}` +
        `&email=${encodeURIComponent(email)}&sig=${signature}` +
        `&cid=${encodeURIComponent(campaignId)}` +
        `&tid=${encodeURIComponent(topicId)}`
      /*
       * TWO URLS OVER ONE SIGNATURE, and which one goes where is the whole
       * RFC 8058 story.
       *
       * `oneClickUrl` is what the `List-Unsubscribe` header names. A mailbox
       * provider POSTs it with no human present and expects the act to have
       * happened when it reads the 200 — so it points at the route whose POST
       * writes immediately, and it must never point at a page of checkboxes
       * that has to be submitted by somebody.
       *
       * `unsubscribeUrl` is the link a PERSON clicks in the footer, and it
       * points at the preference center, where the topic this message
       * belonged to is one of the things they can stop instead of all of it.
       * The merge token keeps its name because designed templates in the wild
       * reference `{{unsubscribeUrl}}`, and because the page it opens is still
       * where you go to unsubscribe — with "Unsubscribe from everything" on
       * it, one button away.
       */
      const oneClickUrl = `${siteBase}/api/email/unsubscribe?${signedQuery}`
      const unsubscribeUrl = `${siteBase}/api/email/preferences?${signedQuery}`
      // Variant assignment keys on the recipient address (AGL-255) so a
      // re-send reaches the same variant.
      const variant = experiment
        ? assignExperimentVariant(experiment, experiment.$id, email)
        : null
      /*
       * THIS RECIPIENT'S MESSAGE, through the renderer the composer previews
       * with (`@aglyn/plugins-email/model`).
       *
       * Merge tags resolve after the variant override so variant copy can use
       * tags too, a designed template renders per recipient, and a plain-text
       * body gets the HTML part `sendEmail` would otherwise synthesize for it.
       * Shared rather than inlined because a preview rendered by a second
       * implementation is a preview of something else — the two defects this
       * send path has already shipped, product blocks silently dropped and
       * merge tags resolving to empty strings for a whole audience, are both
       * invisible to a preview that does not run this exact code.
       */
      const message = renderCampaignEmail({
        subject: variant?.subject?.trim() || subject,
        body: variant?.body?.trim() || body,
        preheader: options.preheader,
        template,
        recipient: { email, name: names.get(email) },
        siteBase,
        hostId,
        unsubscribeUrl,
      })
      const result = await sendEmail({
        to: email,
        subject: message.subject,
        ...(message.html ? { html: message.html } : {}),
        // The plain-text footer names what the link actually opens. "Choose
        // which emails you get" in front of "or unsubscribe" is the only place
        // a text-only reader learns that leaving one stream is an option at
        // all, and the word "unsubscribe" stays in the line because that is
        // what a recipient scans the footer for. It is written by
        // `renderCampaignEmail`, so the composer's preview shows the footer
        // that is actually mailed.
        text: message.text,
        // RFC 8058 one-click (AGL-2408). `List-Unsubscribe` alone does NOT
        // satisfy Gmail's and Yahoo's bulk-sender rules — the pair does, and
        // Gmail is where most of a merchant's list lives. A client honouring
        // the pair POSTs `List-Unsubscribe=One-Click` to the URL, which is
        // why the handler had to accept POST first: advertising one-click
        // against a GET-only handler would promise a verb nothing served.
        //
        // `oneClickUrl`, NOT the preference center. Topics narrow what a
        // person can choose on a page; they change nothing about what a
        // machine POSTing this header is promised, which is that the
        // recipient stops hearing from this site.
        headers: {
          'List-Unsubscribe': `<${oneClickUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        // The campaign's own display name where the composer set one, and the
        // org's branding default otherwise. Either way the ADDRESS is the
        // resolved identity's — `applyFromName` replaces the display name in
        // front of it and nothing else.
        fromName: options.fromName || branding.fromName,
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        // The server's answer to which verified address this leaves on. The
        // send path re-checks it, so a refusal holds even here where the
        // route has already passed one.
        sendingIdentity,
        // Event attribution (AGL-268): the opens/clicks webhook maps
        // deliveries back to the campaign (and experiment) via tags.
        tags: [
          { name: 'hostId', value: hostId },
          { name: 'campaignId', value: campaignId },
          ...(experiment
            ? [{ name: 'experimentId', value: experiment.$id }]
            : []),
        ],
        context: 'campaign',
      })
      if (result.sent) {
        sent += 1
        if (variant) {
          variantSends[variant.id] = (variantSends[variant.id] ?? 0) + 1
        }
        continue
      }
      /*
       * The hourly governor refused this message, so it will refuse every
       * message after it in this window — the counter only goes up. Stop.
       *
       * Not a throw: some of this batch has already been delivered, and a throw
       * here would lose the delivered count, skip the meters and (on the
       * scheduled path) re-queue a campaign that would double-send. The
       * remainder is reported instead, the reservation is reconciled to what
       * actually went, and the merchant sees a number that is short.
       *
       * Any OTHER failure — a rejection, a network error — is per-recipient and
       * the loop continues, exactly as before.
       */
      if (rateLimitedRetryAtMs(result) !== null) {
        deferred = sendable.length - sent
        break
      }
    }
  } finally {
    /*
     * Give back what did not go out (AGL-2267).
     *
     * In a `finally` so it runs on the throw paths too. The claim was taken
     * for the whole batch — that is what makes it a cap — and a campaign that
     * delivered 300 of 500 must not spend 500 of the org's allowance.
     * `reconcileCampaignSendReservation` never throws.
     */
    await reconcileCampaignSendReservation(reservation, sent)
  }
  // Both meters, from one call, on the DELIVERED count (AGL-1438). Ahead of
  // the `recordCampaign` early return below, because a test send is a real
  // email with a real cost even though it writes no campaign record — and
  // ahead of nothing else that writes `emailSends`, so a campaign reaches the
  // cost meter exactly once. This sender used to increment that counter
  // itself, which is how a counter named for all email came to hold campaign
  // sends alone.
  await meterHostEmail(hostId, sent, 'campaign')

  // Sends are the email variant's exposures (AGL-255).
  if (experiment && experiment.status === 'running') {
    for (const [variantId, count] of Object.entries(variantSends)) {
      // AGL-1771: `variant.id` is MERCHANT-AUTHORED — `validateExperiment`
      // checks the ids are unique and nothing about their shape — and it is a
      // path component here. The same third instance `d51e23df4` found on the
      // conversion write in `email-events.ts`, on the exposure write that
      // pairs with it. This one stays a merge-set and stays a create: the
      // first send for a variant has no stats document, the experiment was
      // just read, and the emails really went out.
      if (!isDocumentId(variantId)) continue
      await hostRef
        .collection('experiments')
        .doc(experiment.$id)
        .collection('stats')
        .doc(variantId)
        .set(
          {
            exposures: firebaseAdmin.firestore.FieldValue.increment(count),
            updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch(() => undefined)
    }
  }

  if (options.recordCampaign === false) {
    return {
      campaignId,
      recipients: sendable.length,
      audienceSize: resolved.length,
      ...(audienceTruncated ? { audienceTruncated: true } : {}),
      sent,
      ...(deferred ? { deferred } : {}),
    }
  }
  await hostRef.collection('campaigns').doc(campaignId).set(
    {
      subject,
      body,
      audience,
      /*
       * WHICH audience, not only which KIND.
       *
       * `audience` is `'list'` or `'segment'` — a kind — and on its own it
       * cannot answer "which lists has this design been sent to", because
       * every list send looks identical to every other. The scheduled branch
       * of the handler has always recorded these; the immediate send dropped
       * them, so a campaign's own document could not say where it went.
       */
      ...(options.listId ? { listId: options.listId } : {}),
      ...(listName ? { listName } : {}),
      ...(options.segmentId ? { segmentId: options.segmentId } : {}),
      // The RESOLVED topic, not `options.topicId`. Recording the default
      // explicitly is what lets the campaign report and the preference page
      // agree about which stream this send belonged to, without either of them
      // re-deriving a default that could drift from the other's.
      topicId,
      ...(options.templateScreenId
        ? { templateScreenId: options.templateScreenId }
        : {}),
      // What this send actually left as, recorded beside the copy: the report
      // is read months later, by which time the org's branding default may be
      // a different name than the one this campaign went out under.
      ...(options.fromName ? { fromName: options.fromName } : {}),
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.preheader ? { preheader: options.preheader } : {}),
      ...(options.emailCampaignId
        ? { emailCampaignId: options.emailCampaignId }
        : {}),
      ...(experiment ? { experimentId: experiment.$id } : {}),
      stats: {
        recipients: sendable.length,
        sent,
        /*
         * The audience this send was TAKEN FROM, beside what it reached.
         *
         * `audienceSize` above `recipients` is a campaign that did not go to
         * everybody, and the History row is where a merchant answers "did
         * this reach my list" months later. Recording only the reached figure
         * makes a truncated send indistinguishable from a complete one, which
         * is the same fault the deferred count below was added to close.
         *
         * `audienceSizeTruncated` marks the figure as a floor: the resolution
         * stopped at its read ceiling, so the audience is at least this and
         * the shortfall is at least the difference.
         */
        audienceSize: resolved.length,
        ...(audienceTruncated ? { audienceSizeTruncated: true } : {}),
        // Recorded, not silent (AGL-2409): a campaign that stopped at the
        // hourly ceiling delivered fewer than it resolved, and the History
        // row is the only place a merchant can find out.
        ...(deferred ? { deferred } : {}),
        ...(Object.keys(variantSends).length ? { variantSends } : {}),
        /*==========================================
         * THE POPULATIONS THIS SEND ALREADY MEASURED.
         *
         * Every one of these was computed above, returned from the DRY RUN
         * so the composer could show it before the send, and then discarded
         * the moment the send was real — so the campaign report could only
         * ever say how many were mailed, never how many were not and why.
         *
         * They are RECORDED here rather than recomputed at read time, and the
         * difference is not an optimisation. Consent records change, addresses
         * get suppressed, and a list grows: recomputing "how many were
         * withheld" next month answers a question about the list as it is
         * now, under a heading that says it describes a send that happened in
         * March. The recorded number is the only one that is true of the
         * campaign.
         *
         * Measured over two different wholes, which is why they are stored
         * separately rather than netted: the consent split runs over the whole
         * resolved audience, and `suppressed` over the capped recipient list,
         * because that is where each check actually runs.
         *=========================================*/
        consented: consentSplit.consented,
        consentedByOperator: consentSplit.consentedByOperator,
        grandfathered: consentSplit.grandfathered,
        consentWithheld: consentSplit.withheld,
        suppressed: recipients.length - sendable.length,
        /*
         * That this send's links were trackable at all.
         *
         * Click tracking rewrites links in the HTML part, so a send that
         * carried none reports zero clicks whatever recipients did — a
         * structural zero that is indistinguishable on screen from a campaign
         * nobody clicked. `sendEmail` now synthesises an HTML part for a
         * text-only send, so every send from here on carries one; recording
         * the fact is what lets the report withhold a click RATE for the
         * campaigns that predate it instead of publishing a meaningless one.
         */
        clickTracked: true,
      },
      status: 'sent',
      sentAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      sentBy: options.senderUid,
    },
    { merge: true },
  )
  return {
    campaignId,
    recipients: sendable.length,
    audienceSize: resolved.length,
    ...(audienceTruncated ? { audienceTruncated: true } : {}),
    sent,
    ...(deferred ? { deferred } : {}),
  }
}

/**
 * Campaign API (AGL-161/272): `action` picks the operation —
 * `send` (default) delivers now, `schedule` stores the campaign with a
 * `sendAtMs` for the processor, `cancel` withdraws a scheduled campaign.
 * All three require a site admin/editor.
 */
export const campaignSendHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const hostId = String(req.body?.hostId ?? '')
  const action = String(req.body?.action ?? 'send')
  const subject = String(req.body?.subject ?? '')
    .trim()
    .slice(0, 150)
  const body = String(req.body?.body ?? '')
    .trim()
    .slice(0, 20000)
  const audience = String(req.body?.audience ?? 'leads')
  const templateScreenId = String(req.body?.templateScreenId ?? '')
  /*
   * The composer's sender fields, and the one rule they all obey: a value a
   * merchant typed reaches a MIME header, so it is flattened to a single line
   * before it goes anywhere. `applyFromName` quotes the display name and
   * strips quotes from it, but nothing downstream removes a CR or an LF, and
   * a header value carrying one is the injection shape.
   */
  const headerSafe = (value: unknown, max: number): string =>
    String(value ?? '')
      .replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
      .trim()
      .slice(0, max)
  // 78 characters is the line length a display name has to live inside.
  const fromName = headerSafe(req.body?.fromName, 78)
  const replyTo = headerSafe(req.body?.replyTo, 254).toLowerCase()
  const preheader = headerSafe(req.body?.preheader, 200)
  // The campaign this send joins. Validated as a document id here because it
  // is stored and later queried as one.
  const emailCampaignId = String(req.body?.emailCampaignId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  if (emailCampaignId && !isDocumentId(emailCampaignId)) {
    return res.status(400).json({ error: 'Invalid campaign' })
  }
  if (replyTo && !EMAIL_PATTERN.test(replyTo)) {
    return res.status(400).json({ error: 'Reply-to must be an email address' })
  }
  /*
   * Designed emails carry their content in the template; plain sends still
   * need subject + body.
   *
   * THE ACTIONS THAT MAIL NOTHING ARE EXEMPT, and the composer is the reason.
   * It asks for the recipient count as soon as it mounts — before any copy
   * exists, which is the whole point of asking — so requiring copy of
   * `preview` refused every count a plain-text campaign ever asked for, and
   * the readout under the Subject field showed this message instead of the
   * audience size and the consent split. The preview branch below substitutes
   * placeholder copy precisely because it needs none: the count is a fact
   * about the audience, and no part of resolving it reads the subject or the
   * body. `renderPreview` is exempt for the same reason in the other
   * direction — it renders whatever has been typed so far, including nothing.
   */
  const mails = action !== 'cancel' && action !== 'preview' && action !== 'renderPreview'
  if (mails && !templateScreenId && (!subject || !body)) {
    return res.status(400).json({ error: 'Missing subject or body' })
  }
  if (!['leads', 'members', 'manual', 'segment', 'list'].includes(audience)) {
    return res.status(400).json({ error: 'Unknown audience' })
  }
  /*
   * The composer's topic, refused here as well as inside `performCampaignSend`.
   *
   * Both, because the SCHEDULE branch below writes the campaign document
   * without going through the send — the same asymmetry AGL-1771 found for
   * `campaignId` — so a topic that only the send validated would be stored
   * unchecked and then signed into a link a fortnight later.
   *
   * An empty value is not an error: it means "the composer did not say", which
   * `performCampaignSend` resolves to the default topic.
   */
  const topicId = String(req.body?.topicId ?? '')
  if (topicId && !isEmailTopicId(topicId)) {
    return res.status(400).json({ error: 'Unknown topic' })
  }

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not a site admin or editor' })
    }

    if (action === 'test') {
      // Test send (AGL-349): delivers to the requesting user only, with
      // no campaign record — proofing designed emails before a real send.
      const testEmail = String(decoded.email ?? '')
      if (!testEmail) {
        return res
          .status(400)
          .json({ error: 'Your account has no email address for tests' })
      }
      const result = await performCampaignSend({
        hostId,
        subject,
        body: body || 'Test send',
        audience: 'manual',
        emails: [testEmail],
        templateScreenId: templateScreenId || undefined,
        recordCampaign: false,
        senderUid: decoded.uid,
        // Not marketing: the recipient is the account making the request.
        selfProofFor: testEmail,
      })
      return res.status(200).json({ ...result, test: true })
    }

    if (action === 'renderPreview') {
      /*
       * THE MESSAGE, RENDERED, AND NOT ONE ADDRESS RESOLVED.
       *
       * Separate from `preview` because the two answer different questions at
       * different costs. `preview` sweeps the audience — up to 5,000 documents
       * — to count people, and its answer changes only when the audience does.
       * This one answers "what does my email look like", which changes on
       * every keystroke, and reads at most the template and its products.
       * Folding the render into `preview` would page the merchant's whole
       * contact list once per debounce tick, for a number that had not moved.
       *
       * Rendered through `renderCampaignEmail`, which is what the per-recipient
       * send loop calls, so this is the HTML that will be mailed and not a
       * likeness of it.
       */
      const template = templateScreenId
        ? await loadEmailTemplate(hostId, templateScreenId)
        : null
      const siteBase =
        hostPublicOrigin({
          cname: hostSnapshot.get('cname'),
          subdomain: hostSnapshot.get('subdomain'),
        }) ?? ''
      const orgForHost = await getOrgForHost(hostId)
      const branding = resolveBrandingProfile(orgForHost?.org as never)
      /*
       * Personalized for the REQUESTER, because a preview showing raw
       * `{{firstName|there}}` tells a merchant nothing about what a recipient
       * will read, and inventing a fictional contact would make a merge tag
       * that resolves to nothing look like one that works.
       */
      const rendered = renderCampaignEmail({
        subject,
        body,
        preheader,
        template,
        recipient: {
          email: String(decoded.email ?? ''),
          name: String((decoded as Record<string, unknown>)['name'] ?? ''),
        },
        siteBase,
        hostId,
        // Unsigned, and it is not a working opt-out: minting a real signature
        // here would put a live preference link for the requester's own
        // address into a page they are only reading. The footer's presence,
        // and its wording, is what the preview is showing.
        unsubscribeUrl: `${siteBase}/api/email/preferences`,
      })
      return res.status(200).json({
        ...rendered,
        preheader: preheader || template?.preheader || '',
        fromName: fromName || branding.fromName,
        ...(replyTo ? { replyTo } : {}),
      })
    }

    if (action === 'preview') {
      // Read-only, and it needs the same admin/editor role as a send: the
      // audience size of someone else's site is not public information.
      const result = await performCampaignSend({
        hostId,
        subject: subject || 'preview',
        body: body || 'preview',
        audience,
        segmentId: String(req.body?.segmentId ?? ''),
        listId: String(req.body?.listId ?? ''),
        topicId: topicId || undefined,
        emails: Array.isArray(req.body?.emails)
          ? req.body.emails.map(String)
          : undefined,
        templateScreenId: templateScreenId || undefined,
        senderUid: decoded.uid,
        dryRun: true,
      })
      return res.status(200).json(result)
    }

    if (action === 'schedule') {
      // Scheduling (AGL-272): store the full send config; the
      // process-scheduled cron delivers it through performCampaignSend.
      const sendAtMs = Number(req.body?.sendAtMs ?? 0)
      if (!Number.isFinite(sendAtMs) || sendAtMs <= Date.now()) {
        return res.status(400).json({ error: 'Pick a future send time' })
      }
      const campaignId =
        String(req.body?.campaignId ?? '') || createResourceUid()
      // AGL-1771: this branch WRITES, and it is the only campaign write that
      // does not go through `performCampaignSend`'s guard. A `campaignId` of
      // `a/b/c` scheduled the campaign at `campaigns/a/b/c` — which the
      // scheduled-campaign processor would then pick up by `collectionGroup`
      // and send, from a document the merchant can neither see in their
      // campaigns list nor cancel.
      if (!isDocumentId(campaignId)) {
        return res.status(400).json({ error: 'Invalid campaignId' })
      }
      await hostRef.collection('campaigns').doc(campaignId).set(
        {
          subject,
          body,
          audience,
          ...(req.body?.segmentId
            ? { segmentId: String(req.body.segmentId) }
            : {}),
          ...(req.body?.listId ? { listId: String(req.body.listId) } : {}),
          ...(topicId ? { topicId } : {}),
          ...(Array.isArray(req.body?.emails)
            ? { emails: req.body.emails.map(String).slice(0, 500) }
            : {}),
          ...(req.body?.experimentId
            ? { experimentId: String(req.body.experimentId) }
            : {}),
          ...(templateScreenId ? { templateScreenId } : {}),
          // The composer's sender fields ride on the stored campaign so the
          // scheduled processor mails the message that was composed rather
          // than one that reverts to the org's branding defaults.
          ...(fromName ? { fromName } : {}),
          ...(replyTo ? { replyTo } : {}),
          ...(preheader ? { preheader } : {}),
          ...(emailCampaignId ? { emailCampaignId } : {}),
          status: 'scheduled',
          sendAtMs,
          scheduledAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          scheduledBy: decoded.uid,
        },
        { merge: true },
      )
      return res.status(200).json({ campaignId, status: 'scheduled' })
    }

    if (action === 'cancel') {
      const campaignId = String(req.body?.campaignId ?? '')
      // AGL-1771: the ref used to be built one line ABOVE the `campaignId ?`
      // check below, which defeated that check — `.doc('')` throws on an empty
      // path segment, so the 400 this branch intends became a 500. Guarding
      // first is what lets the ref be built at all.
      if (!isDocumentId(campaignId)) {
        return res.status(400).json({ error: 'Not a scheduled campaign' })
      }
      const campaignRef = hostRef.collection('campaigns').doc(campaignId)
      const campaignSnapshot = await campaignRef.get()
      if (
        !campaignSnapshot?.exists ||
        campaignSnapshot.get('status') !== 'scheduled'
      ) {
        return res.status(400).json({ error: 'Not a scheduled campaign' })
      }
      await campaignRef.set(
        {
          status: 'canceled',
          canceledAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          canceledBy: decoded.uid,
        },
        { merge: true },
      )
      return res.status(200).json({ campaignId, status: 'canceled' })
    }

    const result = await performCampaignSend({
      hostId,
      subject,
      body,
      audience,
      segmentId: String(req.body?.segmentId ?? ''),
      listId: String(req.body?.listId ?? ''),
      topicId: topicId || undefined,
      emails: Array.isArray(req.body?.emails) ? req.body.emails : undefined,
      campaignId: String(req.body?.campaignId ?? ''),
      experimentId: String(req.body?.experimentId ?? ''),
      templateScreenId: templateScreenId || undefined,
      fromName,
      replyTo,
      preheader,
      emailCampaignId,
      senderUid: decoded.uid,
    })
    return res.status(200).json(result)
  } catch (error) {
    if (error instanceof CampaignSendError) {
      return res.status(error.status).json({ error: error.message })
    }
    console.error(error)
    return res.status(500).json({ error: 'Campaign send failed' })
  }
}

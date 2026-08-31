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
  consentGroupForSite,
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
/*
 * The LEAF module, not the barrel, for the reason `document-id` is imported
 * the same way: a barrel import resolves to whatever a spec's `jest.mock` of
 * `@aglyn/tenant-data-admin` happens to contain, and nearly every spec that
 * reaches this file mocks it.
 */
import {
  buildUnsubscribeUrl,
  unsubscribeSignature as sharedUnsubscribeSignature,
} from '@aglyn/tenant-data-admin/server/email-unsubscribe-link'
import { recordMarketingSends } from '@aglyn/tenant-data-admin/server/email-marketing-gate'
/*
 * The LEAF module again, and for the third reason listed above `document-id`:
 * the specs that reach this file mock the `@aglyn/tenant-data-admin` barrel,
 * and a reach helper resolved through it would be whatever their factory
 * happens to contain. The one function here that may not be wrong — the read
 * that decides who has already had this email — is the one that must come
 * from the real module.
 */
import {
  CAMPAIGN_REACH_CEILING,
  campaignReachCovers,
  campaignSettledSize,
  partitionByCampaignReach,
  readCampaignReach,
  readCampaignSettled,
  recordCampaignReach,
  recordCampaignSkipped,
} from '@aglyn/tenant-data-admin/server/email-campaign-reach'
/*
 * The LEAF module for the reputation controls too, and for the same reason
 * as the three above it: every spec that reaches this file mocks the
 * `@aglyn/tenant-data-admin` barrel, so a breaker resolved through it would
 * be whatever a factory happened to contain — which for a control that
 * REFUSES a send means a test could pass against a breaker that is not there.
 * Resolved from the module itself, the real control runs, and it fails open
 * against a harness that cannot serve it.
 */
import {
  claimOrgEmailSendDay,
  orgAgeDays,
  readSenderReputation,
  reconcileOrgEmailSendDay,
  recordCampaignAccepted,
  resolveOrgEmailRamp,
  type OrgEmailSendDayReservation,
  type SenderReputationRead,
} from '@aglyn/tenant-data-admin/server/email-sender-reputation'
import { createHash, createHmac } from 'crypto'
import {
  EMAIL_MAX_AUDIENCE_PER_SEND,
  EMAIL_MAX_RECIPIENTS_PER_SEND,
  campaignBatchPlan,
  isEmailConfigured,
  rateLimitedRetryAtMs,
  sendEmail,
  sendingIdentityRefusal,
  type EmailRampVerdict,
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
 * An audience larger than one send may carry is delivered across several
 * batches; an audience larger than THIS is one the sender cannot resolve at
 * all, and batching does not change that. It is the same number as
 * `CAMPAIGN_REACH_CEILING`, taken from the one place both are stated.
 */
const AUDIENCE_SCAN_CEILING = EMAIL_MAX_AUDIENCE_PER_SEND

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
  campaignId?: string,
  topicId?: string,
): string {
  /*
   * Delegated to the module that owns the signed subject.
   *
   * The campaign sender mints links, the unsubscribe handler verifies them,
   * and the marketing gate mints them for every other audience path — three
   * parties to one HMAC subject, which stays correct only while there is one
   * implementation of it. The name stays exported because it is this
   * module's published surface.
   */
  return sharedUnsubscribeSignature(hostId, email, secret, campaignId, topicId)
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
  /**
   * What the merchant called this email, for the record rather than for the
   * recipient.
   *
   * Never leaves the console — it is not the subject and reaches no header,
   * so it is stored as typed apart from a length cap. Absent on every send
   * composed from a campaign, where the campaign is what carries the name.
   */
  displayName?: string
  /** Test sends (AGL-349) skip the campaign record and stats. */
  recordCampaign?: boolean
  /**
   * SEND THIS EMAIL AGAIN, TO PEOPLE IT HAS NOT REACHED.
   *
   * Set with a `campaignId` naming a send that has already gone out. The send
   * is not copied and no second document is made: this send addresses the
   * same audience under the same id, minus everyone the earlier sends
   * reached, and ADDS to the counters already on the record.
   *
   * ## Why the same document, rather than a new send
   *
   * Two reasons, and both are properties a copy would break.
   *
   * The unsubscribe link is the first. Every message this email has already
   * delivered carries `cid={campaignId}` inside its own HMAC, and those
   * messages sit in inboxes forever. A follow-up under a new id would be a
   * second `cid` for one email — two opt-out scopes for one mailing, and an
   * unsubscribe rate split across two records neither of which is the answer.
   *
   * The report is the second. Opens and clicks are attributed by the
   * `campaignId` tag on the delivered message, so a copy would collect the
   * follow-up's engagement on a document whose `sent` counts only the
   * follow-up. Keeping one document keeps every rate over a denominator that
   * covers the same mail the numerator does — see the additive write at the
   * bottom of this function for the arithmetic that holds it.
   *
   * ## What it does NOT relax
   *
   * Nothing. The follow-up runs the whole of this function: the consent
   * split, both suppression lists, the topic filter, the monthly pre-check
   * and reservation, the platform and per-workspace hourly ceilings, and the
   * per-message governor. Its only additions are the subtraction below and
   * the shape of the write at the end.
   */
  followUp?: boolean
  /**
   * THE NEXT BATCH OF AN EMAIL THAT IS STILL GOING OUT.
   *
   * Set by the scheduled-campaign processor, never by a request. An audience
   * larger than {@link EMAIL_MAX_RECIPIENTS_PER_SEND} is delivered across
   * several invocations; each one addresses the people the earlier ones did
   * not, and the campaign is written back as `scheduled` until nothing is
   * left. See the batch plan at the bottom of this function.
   *
   * ## Why it is not {@link followUp}
   *
   * They share the subtraction and the additive write, and they differ on the
   * two things that matter. A follow-up is a MERCHANT's act on an email that
   * has finished — it subtracts who was reached, and somebody suppressed at
   * the time who has since been released is entitled to get it. A batch is
   * one email still in flight — it subtracts everyone the email has SETTLED,
   * reached or refused, because a refused address sitting at the head of a
   * stable order would consume a slot in every remaining batch and, in
   * enough numbers, stop the campaign dead having mailed nobody.
   *
   * They also record differently. A follow-up measures a NEW population, so
   * the audience size and the consent split add. A batch measures a slice of
   * the population the first batch already measured, so those figures are
   * left exactly as the first batch wrote them.
   */
  continuation?: boolean
  /**
   * ONE address the caller has been proved to be entitled to proof to, for
   * the composer's test send. Exempts exactly this address from the
   * marketing-consent rule.
   *
   * The route decides entitlement and this file decides what the exemption
   * can do. See {@link eligibleProofAddress} for the first half and the
   * carve-out at the consent join for the second — including the two
   * properties that keep the exemption one address wide however the caller
   * arrived at it.
   */
  proofFor?: string
  /**
   * Test send only: render every message as if it were addressed to this
   * person, while DELIVERING to the recipient resolved in the ordinary way.
   *
   * What a merge tag resolves to is the whole question a proof answers. A
   * test rendered against the tester shows `{{firstName|there}}` falling back
   * for an audience whose contacts all have names, which reports the merge
   * tags as broken when they work — and, more expensively, hides the reverse.
   *
   * It changes the RENDER and nothing else. The unsubscribe link, the
   * `List-Unsubscribe` header and the suppression key are all minted from the
   * delivery address, deliberately: a proof carrying the persona's opt-out
   * link would let the person testing the email unsubscribe a real contact by
   * clicking a link in their own inbox.
   */
  proofPersona?: { email: string; name?: string }
  /**
   * WHICH OF THE SITE'S IDENTITIES THIS SEND LEAVES ON.
   *
   * Two values and no more: empty for the site's standing selection, and
   * {@link PLATFORM_SENDING_IDENTITY} for the shared Aglyn domain. It is a
   * CHOICE BETWEEN the identities this site already has, and never a name a
   * request supplies.
   *
   * ## Why it is not a domain name
   *
   * Because a domain name in a request is the spoofing path, and it stays
   * closed. `campaignSendHandler` builds its options from the body, so any
   * field read off `options` is a field an authenticated site editor chooses.
   * A domain here would let an editor of one site in an agency org send as a
   * DIFFERENT client's verified domain — the org proved that name, so a
   * resolver checking only "is this verified for the org" would say yes.
   *
   * Which identity a site may use is the per-host half of the model, stored
   * at `hosts/{hostId}.sendingDomain` and written by an org admin. This
   * option picks between that and the shared domain; it cannot reach past it.
   *
   * ## Why `platform` is a choice rather than a fallback
   *
   * An unverified selection still REFUSES — there is no arm anywhere that
   * reaches a platform address from a domain whose DNS is unfinished. This is
   * the opposite direction: a merchant with a working custom identity saying
   * "send this one from the shared domain", which is a decision they are
   * entitled to make and which is recorded on the send.
   */
  sendingIdentity?: string
  /** Recorded as `sentBy`; the scheduler passes the scheduling user. */
  senderUid: string
}

/**
 * The value of {@link CampaignSendOptions.sendingIdentity} that names the
 * shared Aglyn domain.
 *
 * A reserved word rather than an empty string, because empty already means
 * something different and load-bearing: "the composer expressed no opinion,
 * use the site's standing selection". A merchant choosing the shared domain
 * for one send has expressed an opinion, and a site whose default is its own
 * verified domain must not have that choice read as silence.
 */
export const PLATFORM_SENDING_IDENTITY = 'platform'

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
  /**
   * Follow-up only: people in the audience this email had already reached, and
   * which this send therefore did not address.
   *
   * Reported rather than netted away, because it is the number that explains
   * the other ones. A follow-up over a 3,000-person list that addresses 40
   * people has not failed — 2,960 of them already have the email — and
   * without this figure the merchant cannot tell that from a broken audience.
   */
  alreadyReached?: number
  /** Whether this send added to an existing email rather than starting one. */
  followUp?: boolean
  /**
   * People this email has resolved and not yet addressed.
   *
   * Non-zero on a send that is still going out, and the figure that makes
   * "reached 500 of 3,000" a sentence rather than a truncation. Zero when the
   * email is finished.
   */
  remaining?: number
  /** True when another batch of this email will run on its own. */
  resuming?: boolean
  /** When the next batch may go, ms. Present only while {@link resuming}. */
  nextAtMs?: number
  /** Batches this email has run, including this one. */
  batch?: number
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
  /**
   * Whether this send ADDS to an email that already exists, rather than
   * starting one.
   *
   * True for a merchant's follow-up and for an automatic batch. The two
   * differ in what they subtract and in what they record — see
   * `CampaignSendOptions.continuation` — but they agree on the one thing this
   * flag decides: every counter on the campaign is an increment rather than a
   * replacement, so no rate can come out over a denominator that counts less
   * mail than its numerator.
   */
  const addsToExistingSend = Boolean(options.followUp || options.continuation)

  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    throw new CampaignSendError('Unknown site', 404)
  }

  /*==========================================
   * THE FOLLOW-UP'S ADMISSION CHECKS.
   *
   * Here rather than in the route, and re-run even though the route has
   * already loaded the same document to build these options: the properties
   * below are the ones that decide whether somebody gets a second copy of an
   * email, and a check a caller performs is a check the next caller forgets.
   * Two reads of one small document on a deliberate button press is what that
   * costs.
   *=========================================*/
  let reachedKeys: ReadonlySet<string> | null = null
  /**
   * Batches this email has already run, so the plan below can tell the second
   * from the twentieth. Zero on every first send.
   */
  let batchesSoFar = 0
  /*==========================================
   * THE NEXT BATCH'S ADMISSION CHECKS.
   *
   * The same two properties the follow-up checks below, read off the same
   * record and refused for the same reasons — with `skipped` folded into the
   * subtraction, which is the whole difference between the two. See
   * `CampaignSendOptions.continuation`.
   *=========================================*/
  if (options.continuation) {
    if (!options.campaignId) {
      throw new CampaignSendError(
        'A batch has to name the email it is continuing',
        400,
      )
    }
    const sendSnapshot = await hostRef
      .collection('campaigns')
      .doc(options.campaignId)
      .get()
    if (!sendSnapshot.exists) {
      throw new CampaignSendError('Unknown email', 404)
    }
    /*
     * A batch continues an email the processor has CLAIMED. `sending` is what
     * that claim writes; `scheduled` is accepted beside it so a campaign that
     * was written back by a deferral and is picked up again is not refused by
     * its own retry.
     */
    const status = String(sendSnapshot.get('status') ?? '')
    if (status !== 'sending' && status !== 'scheduled') {
      throw new CampaignSendError(
        'This email is not in the middle of being sent',
        400,
      )
    }
    /*
     * FAILS CLOSED, exactly as the follow-up does. The record of who this
     * email has already mailed is the only thing standing between a resumed
     * send and a second copy in somebody's inbox, and a batch that cannot
     * read it must not run.
     */
    const settled = await readCampaignSettled(
      hostId,
      options.campaignId,
      firestore,
    )
    const sentSoFar = Number(sendSnapshot.get('stats')?.sent ?? 0)
    if (!campaignReachCovers(settled.reached, sentSoFar)) {
      throw new CampaignSendError(
        'This email does not have a complete record of who it reached, so ' +
          'the rest of it cannot be sent without risking a second copy for ' +
          'somebody who already has it.',
        409,
      )
    }
    if (campaignSettledSize(settled) >= CAMPAIGN_REACH_CEILING) {
      throw new CampaignSendError(
        `This email has already addressed ${CAMPAIGN_REACH_CEILING.toLocaleString()} ` +
          'people, which is the most one email may reach. Compose a new ' +
          'email for the rest of the audience.',
        409,
      )
    }
    reachedKeys = new Set([...settled.reached, ...settled.skipped])
    batchesSoFar = Math.max(
      0,
      Math.floor(Number(sendSnapshot.get('resume')?.batch ?? 0)) || 0,
    )
  }
  /**
   * A batch that found nothing left to do: the email is FINISHED, not broken.
   *
   * Every "there is nobody to send to" refusal below is a 400 that tells a
   * merchant their audience is empty — which is the right answer to a send
   * they just pressed, and the wrong one to a batch of an email that has
   * already delivered two thousand messages. The processor would mark it
   * `failed`, and a campaign that reached most of its list would be filed
   * under the same word as one that never left.
   *
   * So a continuation closes the email out instead, with the counters the
   * earlier batches wrote left exactly as they are.
   */
  const finishContinuation = async (): Promise<CampaignSendResult> => {
    const sendId = String(options.campaignId ?? '')
    await hostRef
      .collection('campaigns')
      .doc(sendId)
      .set(
        {
          status: 'sent',
          resume: { remaining: 0, batch: batchesSoFar + 1, nextAtMs: 0 },
          lastSentAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    return {
      campaignId: sendId,
      recipients: 0,
      audienceSize: 0,
      sent: 0,
      remaining: 0,
      resuming: false,
      batch: batchesSoFar + 1,
    }
  }

  if (options.followUp) {
    if (!options.campaignId) {
      throw new CampaignSendError(
        'A follow-up has to name the email it is adding to',
        400,
      )
    }
    const sendSnapshot = await hostRef
      .collection('campaigns')
      .doc(options.campaignId)
      .get()
    if (!sendSnapshot.exists) {
      throw new CampaignSendError('Unknown email', 404)
    }
    /*
     * Only a SENT email has anybody to add to. A scheduled one has not gone
     * out — sending it now is what the scheduler is for, and doing it here
     * would deliver it twice; a canceled one was withdrawn on purpose.
     */
    if (sendSnapshot.get('status') !== 'sent') {
      throw new CampaignSendError(
        'Only an email that has already been sent can go to more people',
        400,
      )
    }
    /*
     * FAILS CLOSED. `readCampaignReach` throws rather than answering
     * "nobody", and that throw is deliberately not caught: the whole feature
     * rests on being able to name who already has this email, and a send that
     * cannot is a send that must not happen.
     */
    const keys = await readCampaignReach(hostId, options.campaignId, firestore)
    const sentSoFar = Number(sendSnapshot.get('stats')?.sent ?? 0)
    if (!campaignReachCovers(keys, sentSoFar)) {
      throw new CampaignSendError(
        'This email does not have a complete record of who it reached, so ' +
          'it cannot be sent to more people without risking a second copy ' +
          'for somebody who already has it. Compose a new email to the ' +
          'people you want to add.',
        409,
      )
    }
    if (keys.size >= CAMPAIGN_REACH_CEILING) {
      throw new CampaignSendError(
        `This email has already reached ${keys.size.toLocaleString()} ` +
          `people, which is the most one email may reach ` +
          `(${CAMPAIGN_REACH_CEILING.toLocaleString()}). Compose a new email ` +
          'for the rest of the audience.',
        409,
      )
    }
    reachedKeys = keys
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
  /*
   * THE CONTROLLER THIS SEND IS MADE BY — the declared group of sites that
   * are one sender, or this site alone.
   *
   * Resolved before the sweep because every consent read below is about a
   * controller and not about a site: three sites a business declared as one
   * sender share a basis, and twelve unrelated client brands in an agency's
   * account share nothing. The org read is deduped per request, so the policy
   * lookup further down pays nothing for this.
   */
  const consentGroup = await consentGroupForSite(hostId)
  const consent = new Map<string, MarketingConsentRecord>()
  const collectConsent = (email: string, data: unknown) => {
    const cleaned = email.trim().toLowerCase()
    if (!cleaned) return
    consent.set(
      cleaned,
      readMarketingBasis(
        data as Record<string, unknown> | null | undefined,
        consentGroup,
      ),
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
  const addressable = [
    ...new Set(
      recipients
        .map((email) => email.trim().toLowerCase())
        .filter((email) => EMAIL_PATTERN.test(email)),
    ),
  ]
  if (!addressable.length) {
    if (options.continuation) return finishContinuation()
    throw new CampaignSendError('The audience is empty', 400)
  }

  /*==========================================
   * THE SUBTRACTION: NOBODY GETS THIS EMAIL TWICE.
   *
   * ## Why it is HERE, above the per-send cap
   *
   * Not a preference — the only position that works. The cap a few lines
   * below takes "the FIRST N of a stable order", and that stability is what
   * makes it defensible: two sends of an unchanged audience address the same
   * people. Which means a follow-up that subtracted AFTER the cap would be
   * handed the same first 500 addresses the original send took, discover that
   * all 500 have had the email, and mail nobody — every time, forever, for
   * any audience larger than one send.
   *
   * So the subtraction runs on the whole resolved audience and the cap then
   * takes the first N of what is LEFT, which is the same rule pointed at the
   * remainder.
   *
   * ## What it costs, and why that is the right trade
   *
   * Nothing per address: the reach record is one document, read once above,
   * and the test is a hash and a set lookup. This is the one filter in the
   * send that can afford to run over the whole audience rather than the
   * capped list, which is why suppression stays where it is.
   *
   * ## What `resolved` means from here down
   *
   * The people this send may address — so on a follow-up it is the NEW part
   * of the audience, and every figure derived from it (the consent split,
   * `audienceSize`) describes that part. The write at the bottom adds those
   * figures to the ones already recorded, so the totals on the email cover
   * both sends over two populations that cannot overlap.
   *=========================================*/
  const partitioned = reachedKeys
    ? partitionByCampaignReach(addressable, reachedKeys)
    : { unreached: addressable, alreadyReached: 0 }
  const alreadyReached = partitioned.alreadyReached
  const resolved = partitioned.unreached
  if (!resolved.length) {
    if (options.continuation) return finishContinuation()
    throw new CampaignSendError(
      'Everyone in this audience has already had this email, so nothing has ' +
        'been sent.',
      400,
    )
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
   * THE PROOF CARVE-OUT.
   *
   * A proof delivered to an account holder on this workspace is not a
   * marketing send. The recipient is the person who pressed the button, or a
   * colleague of theirs who already receives this workspace's console mail,
   * and the consent rule exists to protect somebody from mail they did not
   * ask for — which is not what proofing a draft to your own team is.
   *
   * Without this the composer's test send is dead under `strict`: it delivers
   * through the `manual` audience, a hand-typed address is backed by no
   * document, and `unrecorded` is withheld before reaching the clause that
   * grandfathers a record carrying no capture date. Proofing your own email
   * would be refused on consent grounds.
   *
   * ⚠️ TWO PROPERTIES KEEP THE EXEMPTION ONE ADDRESS WIDE, and both are here
   * rather than at the call site, because a caller that could widen it is
   * exactly what this must not be:
   *
   *   1. The address must ALREADY be in the resolved audience. The option can
   *      therefore only exempt a recipient, never introduce one — passing an
   *      address that is not being sent to does nothing at all.
   *   2. A stored `declined` is still refused, below. A refusal is the one
   *      thing no policy may mail, and a proof is not the first exception to
   *      it: somebody who declined marketing on this site un-declines rather
   *      than being quietly overridden.
   *
   * Neither of them is what stops a merchant proofing to a stranger. That is
   * {@link eligibleProofAddress}, at the route, because it is a question
   * about WHO an address belongs to and this function has no way to ask it.
   * The two here are what hold when that check is wrong.
   */
  const proofFor = String(options.proofFor ?? '')
    .trim()
    .toLowerCase()
  const proofAddress = proofFor && resolved.includes(proofFor) ? proofFor : ''
  /*
   * THE ONE READ THAT MAKES THE `declined` GUARANTEE TRUE.
   *
   * A proof is delivered through the `manual` audience, and a manual audience
   * is a list of ADDRESSES — no documents are swept, so `consent` is empty
   * and every proof address arrives as `unrecorded`. The refusal below was
   * therefore unreachable on the only path that can reach it: the carve-out
   * promised that a stored opt-out still refuses, and nothing ever looked one
   * up.
   *
   * Keyed on the single address and only when a proof is in flight, so the
   * cost is one small lookup on an explicit click rather than anything on the
   * campaign path.
   */
  if (proofAddress && !consent.has(proofAddress)) {
    const stored = await readStoredConsent(hostId, proofAddress)
    if (stored) {
      consent.set(proofAddress, readMarketingBasis(stored, consentGroup))
    }
  }
  if (proofAddress && consent.get(proofAddress)?.basis === 'declined') {
    throw new CampaignSendError(
      `${proofAddress} has a recorded marketing opt-out on this site, so the ` +
        'test send was not delivered. Proof to an address that has not opted ' +
        'out, or opt that one back in.',
      400,
    )
  }
  const consentSplit = splitByMarketingConsent(
    proofAddress ? resolved.filter((one) => one !== proofAddress) : resolved,
    consent,
    consentPolicy,
    consentGroup,
  )
  if (proofAddress) consentSplit.mailable.unshift(proofAddress)
  if (!consentSplit.mailable.length) {
    if (options.continuation) return finishContinuation()
    throw new CampaignSendError(
      'No recipient in this audience has a marketing consent record, so ' +
        'nothing has been sent. Add an opt-in checkbox to the form or sign-up ' +
        'this audience comes from, or send to an audience that has one.',
      400,
    )
  }

  /*==========================================
   * THE TWO PLATFORM CONTROLS THAT SIZE THIS BATCH.
   *
   * Both read the same seven-day window, so they are resolved together and
   * the window is read once. Both are campaign-only by construction — this
   * function is the only caller, and transactional mail cannot reach it.
   *
   * A TEST SEND is exempt from both. It delivers one message to the address
   * of the person who pressed the button, it writes no campaign record, and
   * refusing it would leave a merchant whose list has a problem unable to
   * even look at the email they are trying to fix.
   *=========================================*/
  const platformRate = await readEmailSendRateConfig()
  const proofOnly = options.recordCampaign === false
  /**
   * How many people this batch may address.
   *
   * The per-send cap unless the new-sender ramp is lower, in which case the
   * ramp is what the batch takes and the rest of the audience goes out on the
   * following days. Shrinking rather than deferring is the only shape that
   * works: a workspace on a 200-a-day step would defer a 500-recipient batch
   * every single day and never send anything at all.
   */
  let batchCap = MAX_RECIPIENTS_PER_SEND
  /** Today's ramp, resolved once and claimed against below. */
  let ramp: EmailRampVerdict | null = null
  if (!proofOnly) {
    /** This workspace's seven-day grade, and the window both controls read. */
    const reputation: SenderReputationRead = await readSenderReputation({
      orgId,
      policy: (orgForHost?.org as Record<string, unknown> | undefined)?.[
        'emailReputationPolicy'
      ],
      reinstatedUntilMs: (
        orgForHost?.org as Record<string, unknown> | undefined
      )?.['emailReputationReinstatedUntilMs'],
    })
    /*
     * THE CIRCUIT BREAKER.
     *
     * A 409 rather than a deferral, and that difference is the point. A
     * deferral says "not this hour" and retries itself; this says "not until
     * something changes", and the thing that has to change is the list. A
     * campaign that rescheduled itself against a tripped breaker would mail
     * the same bad addresses on a timer.
     *
     * NOTHING IS REMOVED. No contact is deleted, no audience is trimmed,
     * nobody is unsubscribed and no list membership moves — the refusal is on
     * the SEND, which is a flow, and refusing a flow strands nobody's data.
     * That is the enforce-at-the-reduction rule (`over-limit.ts`) applied to
     * the one control in this file that could be tempted to break it.
     *
     * The message carries the numbers and what to do about them, because a
     * merchant who cannot send and cannot find out why will open a ticket
     * that says the product is broken.
     */
    if (reputation.blocked) {
      throw new CampaignSendError(reputation.reason, 409)
    }
    /*
     * THE NEW-SENDER RAMP.
     *
     * A workspace created today may not put its whole first import onto the
     * domain every other tenant's receipts leave on. The step it is on is
     * earned by clean volume as well as reached by age, and a workspace past
     * its first week — which is every existing customer, and every org whose
     * record predates the creation timestamp — is not ramped at all.
     */
    ramp = resolveOrgEmailRamp({
      ageDays: orgAgeDays(
        (orgForHost?.org as Record<string, unknown> | undefined)?.['createdAt'],
      ),
      deliveredLifetime: reputation.window.accepted,
      platformPerHour: platformRate.perHour,
    })
    if (!ramp.graduated && platformRate.enabled) {
      const dayRemaining = Math.max(
        0,
        ramp.perDay - reputation.window.claimedToday,
      )
      if (dayRemaining <= 0) {
        throw new CampaignSendDeferredError(
          `${ramp.detail} It has already sent ` +
            `${reputation.window.claimedToday.toLocaleString()} today, so ` +
            'this campaign has not been sent and nothing has been counted — ' +
            'it goes out automatically tomorrow. Transactional mail — ' +
            'receipts, booking reminders, password resets — keeps sending.',
          Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_400_000,
        )
      }
      batchCap = Math.min(batchCap, dayRemaining)
    }
  }

  /*
   * The cap takes the FIRST N of a stable order, which is what makes taking
   * some of the audience defensible at all: two sends of the same unchanged
   * audience now address the same people, and which people is answerable
   * ("the first N by document name"). It was previously whichever slice
   * Firestore happened to return.
   *
   * What is left over is not lost. The plan at the bottom of this function
   * writes the email back as `scheduled` with a record of how far it got, and
   * the next run addresses the first N of the REMAINDER — the same rule
   * pointed at what is left, which is the same move the follow-up's
   * subtraction makes one block above.
   */
  recipients = consentSplit.mailable.slice(0, batchCap)

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
  /*
   * NOBODY IN THIS BATCH, BUT SOMEBODY AFTER IT.
   *
   * A send whose whole audience is suppressed is a 400 a merchant needs to
   * see. A BATCH whose five hundred are all suppressed is not — there are
   * two and a half thousand people behind them, and refusing here would end
   * the campaign at the first block of bad addresses in the list.
   *
   * The batch falls through instead: it addresses nobody, records the
   * addresses it refused so the next batch does not spend its slots on them
   * again, and the plan at the bottom schedules the remainder.
   */
  if (!sendable.length && consentSplit.mailable.length <= recipients.length) {
    if (options.continuation) return finishContinuation()
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
  /*
   * The site's standing selection, or nothing at all when this send chose the
   * shared domain.
   *
   * The ONLY thing an option can do here is drop the selection. It cannot
   * introduce one, which is what keeps a request from naming a domain to send
   * as — the address is assembled from the host document in both arms, and
   * resolved through the same function on the same terms either way.
   */
  const sendingIdentity = await resolveHostSendingIdentity({
    orgId,
    selectedDomain:
      String(options.sendingIdentity ?? '').trim() === PLATFORM_SENDING_IDENTITY
        ? ''
        : hostSnapshot.get('sendingDomain'),
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
      ...(options.followUp ? { followUp: true, alreadyReached } : {}),
      sendable: sendable.length,
      suppressed: recipients.length - sendable.length,
      /*
       * What this send will NOT reach on its first pass, so the composer can
       * say "3,000 people, 500 in the first batch, the rest over the next few
       * runs" instead of showing 500 beside an audience of 3,000 and leaving
       * a merchant to guess which number is the promise.
       */
      remaining: Math.max(0, consentSplit.mailable.length - recipients.length),
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
  /*
   * Whether this send MINTS the record or writes onto one that already
   * exists.
   *
   * A caller naming a `campaignId` is addressing a record somebody else
   * created — a draft being sent now, a sent email taking a follow-up — and
   * that record already carries its own creation stamp. Re-stamping it would
   * move an email's creation date forward every time it was sent again, and
   * the emails list orders drafts on exactly that field.
   */
  const mintsRecord = !options.campaignId

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
    // The configuration was read above, where it sized this batch against the
    // new-sender ramp. One read, two controls: a second one here could answer
    // differently inside one send, which would let a campaign be sized
    // against one ceiling and admitted against another.
    const config = platformRate
    const window = await readEmailSendRateWindow()
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
   * THE DAY'S RAMP, CLAIMED.
   *
   * Between the hourly claim and the monthly reservation, and the ordering is
   * the same argument both of its neighbours make. AFTER the hourly one, so a
   * workspace deferred for the hour has not spent a day's budget. BEFORE the
   * monthly one, because an unreconciled claim costs whatever its window is
   * and a day is cheaper to leak than a month.
   *
   * A graduated workspace claims nothing and pays no read; see
   * `claimOrgEmailSendDay`.
   */
  const dayClaim = await claimOrgEmailSendDay({
    orgId,
    count: sendable.length,
    ramp:
      ramp ??
      resolveOrgEmailRamp({
        ageDays: null,
        deliveredLifetime: 0,
        platformPerHour: platformRate.perHour,
      }),
    enabled: platformRate.enabled,
  })
  if (!dayClaim.allowed) {
    throw new CampaignSendDeferredError(
      `This workspace may send ${dayClaim.ceiling.toLocaleString()} campaign ` +
        `emails a day while it establishes a sending history, and has sent ` +
        `${dayClaim.used.toLocaleString()} today. Nothing has been sent and ` +
        'nothing has been counted — the rest goes out automatically ' +
        'tomorrow. Transactional mail — receipts, booking reminders, ' +
        'password resets — keeps sending.',
      dayClaim.retryAtMs,
    )
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
  if (!claim.ok) {
    // The day's claim was taken a few lines above and this campaign is not
    // going out, so it is given back before the throw. The `finally` below
    // has not been entered yet, which is exactly why this cannot be left to
    // it.
    await reconcileOrgEmailSendDay(dayClaim.reservation, 0)
    throw overCapError()
  }
  const reservation: CampaignSendReservation = claim.reservation
  const dayReservation: OrgEmailSendDayReservation | null = dayClaim.reservation

  const variantSends: Record<string, number> = {}
  /**
   * Who this campaign actually reached, for the marketing frequency window.
   *
   * A campaign is exempt from the frequency REFUSAL — it is a merchant's
   * reviewed, one-shot act with a recipient count on screen before they press
   * Send, and a cap that silently removed people from it would make that
   * number a lie — but it is most of the mail a person receives from a site,
   * so a ceiling that did not count it would describe nothing. Collected here
   * and written once below rather than per recipient, because this loop is
   * already one awaited HTTP POST per person.
   */
  const reached: string[] = []
  /**
   * WHO THIS BATCH CONSIDERED AND WILL NOT MAIL, so the next one does not
   * consider them again.
   *
   * Two populations, and the reason they belong together is what the next
   * batch does with them. The suppression and topic filters above removed
   * people from `sendable`; the loop below removes any address the provider
   * would not take. Both stay at the head of a stable order, so a batch that
   * did not record them would re-select them, spend a slot on each, and — at
   * enough of them — address five hundred people it cannot mail and make no
   * progress at all.
   *
   * A message that failed for a transient reason is settled out with the
   * rest. That is not a new loss: before batching, a failed recipient was
   * never retried either, because there was no second pass. What it buys is
   * that one unreachable address cannot stall the two thousand behind it.
   */
  const sendableSet = new Set(sendable)
  const settledOut: string[] = recipients.filter(
    (email) => !sendableSet.has(email),
  )
  let sent = 0
  /** Recipients the hourly governor refused mid-batch, if any. */
  let deferred = 0
  try {
    for (let index = 0; index < sendable.length; index += 1) {
      const email = sendable[index]
      // `cid` is what lets an unsubscribe be attributed to the campaign that
      // caused it. Without it the suppression list records that somebody left
      // and nothing about which mailing they left over, which is the one
      // question an unsubscribe rate exists to answer.
      const link = {
        siteBase,
        hostId,
        email,
        campaignId,
        topicId,
        secret: unsubscribeSecret,
      }
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
      const oneClickUrl = buildUnsubscribeUrl({ ...link, surface: 'one-click' })
      const unsubscribeUrl = buildUnsubscribeUrl({
        ...link,
        surface: 'preferences',
      })
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
        /*
         * The persona where a proof named one, and the actual recipient
         * everywhere else.
         *
         * Only the RENDER moves. `email` above still decides who the message
         * is delivered to, which unsubscribe link is signed, and which
         * address a suppression would be recorded against — so a proof shows
         * a real contact's merge values without putting that contact's
         * opt-out link in somebody else's inbox.
         */
        recipient: options.proofPersona ?? { email, name: names.get(email) },
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
        reached.push(email)
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
        /*
         * Everything from HERE ON is untouched and retryable, which is what
         * makes it the remainder rather than a loss: the campaign schedules
         * itself for the next window and addresses these people then.
         * Counted from the index rather than from `sent`, so a rejection
         * earlier in the batch is not counted twice — once as settled and
         * again as deferred.
         */
        deferred = sendable.length - index
        break
      }
      /*
       * The provider would not take this address. Settled rather than left
       * for the next batch — see `settledOut` above for why an address that
       * keeps failing must not keep consuming a slot.
       */
      settledOut.push(email)
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
    /*
     * And the day's, for the same reason one line up. The hourly claim is
     * deliberately NOT reconciled — its window is an hour — but a day is long
     * enough that a failed batch would cost a new workspace the rest of it.
     */
    await reconcileOrgEmailSendDay(dayReservation, sent)
  }
  // Both meters, from one call, on the DELIVERED count (AGL-1438). Ahead of
  // the `recordCampaign` early return below, because a test send is a real
  // email with a real cost even though it writes no campaign record — and
  // ahead of nothing else that writes `emailSends`, so a campaign reaches the
  // cost meter exactly once. This sender used to increment that counter
  // itself, which is how a counter named for all email came to hold campaign
  // sends alone.
  // The frequency window, for the messages that left. After the reservation
  // reconcile and never in front of it: this is a deliverability counter and
  // the reconcile is a merchant's allowance, so the allowance is settled
  // first. `recordMarketingSends` never throws.
  await recordMarketingSends(hostId, reached)
  await meterHostEmail(hostId, sent, 'campaign')
  /*
   * The DENOMINATOR every per-tenant rate divides by.
   *
   * Recorded on the DELIVERED count and not on what was attempted, so a
   * bounce rate is bounces over messages that actually left. It is also the
   * volume the new-sender ramp reads to decide which step a workspace has
   * earned, which is why it is written from the send rather than inferred
   * from the delivery webhook: a ramp that only moved when a provider
   * reported back would stall a new tenant on the day the webhook was slow.
   *
   * Never throws, like both meters above it.
   */
  await recordCampaignAccepted(orgId, sent)

  /*
   * WHO THIS EMAIL HAS NOW REACHED, so a later send can subtract them.
   *
   * Written for every real send and not only for follow-ups, because the
   * record has to exist BEFORE anybody asks for one — an email whose first
   * send kept no account of itself can never be sent to more people, which is
   * exactly what `campaignReachCovers` refuses above.
   *
   * A test send is excluded with the campaign record it also skips: it
   * delivers to the requester's own address under an id nothing will ever
   * follow up, and counting it would file a real person's address against a
   * mailing that does not exist.
   *
   * Ahead of the campaign write below rather than after it, so a failure
   * between the two leaves an email whose reach record is AHEAD of its
   * recorded `sent`. `campaignReachCovers` reads that as covered, which is
   * the safe direction: a follow-up subtracts more people than it strictly
   * has to. The other order would leave the record short and refuse the
   * follow-up, which is also safe but loses the feature over a transient.
   */
  if (options.recordCampaign !== false) {
    await recordCampaignReach(hostId, campaignId, reached, firestore)
    /*
     * And who it decided NOT to mail, under a field of its own.
     *
     * Written for every real send rather than only for a batched one, for the
     * reason the reach record itself is: the record has to exist before
     * anybody asks for one, and the batch that asks is the NEXT invocation of
     * this function, which will have no way to know that these five hundred
     * addresses were already considered.
     */
    await recordCampaignSkipped(hostId, campaignId, settledOut, firestore)
  }

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

  /*==========================================
   * WHAT HAPPENS TO THE REST OF THE AUDIENCE.
   *
   * The cap took the first N of the people this send may mail. Everyone past
   * it, plus anybody an hourly cut left untouched, is the REMAINDER — and
   * until now the remainder was simply not mailed, and a merchant with three
   * thousand contacts pressed Send six times to reach them.
   *
   * The plan is pure and lives in `send-ceilings.ts` with the numbers it
   * reasons about. It answers two things: how many are left, and whether
   * another batch runs. The second is the one that matters, because a job
   * that reschedules itself has exactly one interesting failure — doing it
   * forever — and there are three ways this one stops: nothing left, the
   * batch guard, and a batch that settled nobody.
   *=========================================*/
  const plan = campaignBatchPlan({
    mailable: consentSplit.mailable.length,
    addressed: recipients.length,
    retryable: deferred,
    settled: sent + settledOut.length,
    batchesSoFar,
  })
  /**
   * When the next batch may go.
   *
   * Now, in the ordinary case: the scheduled-campaign processor claims
   * anything `scheduled` and due, and its next run is what continues this
   * email. A window the send was paced by moves it out — but a send paced by
   * the hour or the day THREW rather than reaching here, so the only reason
   * this is not immediate is a batch that ran to the end of its own cap.
   */
  const nextAtMs = plan.resuming ? Date.now() : 0

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
  /*==========================================
   * ADDING TO A COUNTER, AS AGAINST REPLACING IT.
   *
   * `set(..., {merge: true})` merges a nested map FIELD BY FIELD, so a
   * follow-up writing a plain `stats.recipients` would overwrite the original
   * send's figure with its own — and every rate on the report divides by
   * `sent` or by `delivered`. `delivered`, `opens`, `bounced` and the rest are
   * incremented by the delivery webhook keyed on this same `campaignId`, so
   * they already cover BOTH sends. Replacing `sent` with the follow-up's
   * smaller number would leave a numerator counting two sends over a
   * denominator counting one, and a delivery rate of 300%.
   *
   * So every send-recorded counter goes through here: a plain number the
   * first time, an increment on a follow-up. The two populations a follow-up
   * measures are disjoint by construction — it addressed nobody the earlier
   * sends reached — so the sums are totals rather than double counts.
   *=========================================*/
  const additive = (value: number) =>
    addsToExistingSend
      ? (firebaseAdmin.firestore.FieldValue.increment(value) as never)
      : value
  /**
   * The figures a BATCH must not add to, because it did not measure a second
   * population — it measured a slice of the one the first batch already
   * counted.
   *
   * `audienceSize` is the arithmetic that makes this concrete. A first batch
   * over three thousand people records 3,000; a second batch sees the 2,500
   * that are left and, adding, would record 5,500 — an audience that does not
   * exist, under every rate on the report. The same holds for the consent
   * split, which is measured over the whole remaining audience rather than
   * over the capped slice.
   *
   * So a continuation omits them entirely and the first batch's figures
   * stand, which is the same "recorded, not recomputed" rule the populations
   * below are stored under: they are true of the send that happened.
   */
  const measuresTheAudience = !options.continuation
  await hostRef.collection('campaigns').doc(campaignId).set(
    {
      subject,
      body,
      audience,
      /*
       * The one date every message carries — see `email-record.ts`. Written
       * only where this send mints the document, because a record addressed
       * by id was created by whoever minted it and keeps that date.
       */
      ...(mintsRecord ? { createdAtMs: Date.now() } : {}),
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
      // Which identity it left on, for the same reason the display name is
      // recorded: the site's standing selection can move, and a report read
      // months later has to say what THIS send went out as.
      ...(options.sendingIdentity
        ? { sendingIdentity: options.sendingIdentity }
        : {}),
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.preheader ? { preheader: options.preheader } : {}),
      ...(options.displayName ? { displayName: options.displayName } : {}),
      ...(options.emailCampaignId
        ? { emailCampaignId: options.emailCampaignId }
        : {}),
      ...(experiment ? { experimentId: experiment.$id } : {}),
      stats: {
        recipients: additive(sendable.length),
        sent: additive(sent),
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
        ...(measuresTheAudience
          ? {
              audienceSize: additive(resolved.length),
              ...(audienceTruncated ? { audienceSizeTruncated: true } : {}),
            }
          : {}),
        /*
         * WHAT THIS EMAIL ENDED UP NOT DELIVERING.
         *
         * Written only once the email has STOPPED, and as an absolute figure
         * rather than an increment, because a shortfall is a state and not a
         * sum. A batch that was cut short by the hourly ceiling has not
         * fallen short of anything — the people it did not reach are in
         * `resume.remaining` and the next run addresses them — and recording
         * a shortfall there would leave the report carrying "held back by the
         * hourly limit" about recipients who got the mail twenty minutes
         * later.
         */
        ...(!plan.resuming && plan.remaining > 0
          ? { deferred: plan.remaining }
          : {}),
        ...(Object.keys(variantSends).length
          ? {
              variantSends: Object.fromEntries(
                Object.entries(variantSends).map(([variantId, count]) => [
                  variantId,
                  additive(count),
                ]),
              ),
            }
          : {}),
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
        ...(measuresTheAudience
          ? {
              consented: additive(consentSplit.consented),
              consentedByOperator: additive(consentSplit.consentedByOperator),
              grandfathered: additive(consentSplit.grandfathered),
              consentWithheld: additive(consentSplit.withheld),
            }
          : {}),
        suppressed: additive(recipients.length - sendable.length),
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
      /*
       * `scheduled` WHILE AN EMAIL IS STILL GOING OUT, and it is a real
       * state rather than a convenience.
       *
       * The scheduled-campaign processor claims anything `scheduled` and due,
       * and that claim is the resume beat — including for a send a merchant
       * pressed by hand, which has no beat of its own. Reusing the state also
       * means the existing collection-group index serves it and that Cancel
       * already works: a merchant who decides mid-campaign that the copy is
       * wrong can stop the rest of it, which is a thing they could not do
       * before because there was no rest.
       *
       * ⚠️ IT READS AS "NOT SENT YET" UNLESS A SURFACE SAYS OTHERWISE. The
       * `resume` map below is what makes the row honest — "reached 500 of
       * 3,000, sending" rather than a scheduled email that has in fact
       * already delivered five hundred messages. `campaignSendProgress` in
       * `@aglyn/plugins-email/model` derives that sentence from these fields
       * and is the one place it is composed.
       */
      status: plan.resuming ? 'scheduled' : 'sent',
      ...(plan.resuming ? { sendAtMs: nextAtMs } : {}),
      /*
       * HOW FAR THIS EMAIL HAS GOT, written absolutely on every batch.
       *
       * Not part of `stats`, because `stats` is what the email DID and this
       * is where it currently is. A finished email keeps the record — batches
       * of 6, remaining 0 — so "this went out over six runs" is answerable
       * afterwards rather than only while it is happening.
       */
      resume: {
        remaining: plan.remaining,
        batch: plan.batch,
        nextAtMs,
        ...(plan.stop ? { stop: plan.stop } : {}),
      },
      /*
       * `sentAt` is WHEN THIS EMAIL WENT OUT, and a follow-up does not change
       * that. The emails list orders on it and the campaign rollup takes its
       * `lastSentAtMs` from it, so moving it would restate an email that went
       * out in March as one that went out today — the same rewriting-history
       * fault the recorded populations above exist to avoid.
       *
       * When the LAST send happened is a different fact and gets a field of
       * its own, beside a count of how many sends this email has had. Both
       * are what the detail page needs to say "sent twice, most recently on
       * the 14th" instead of presenting one date for two mailings.
       */
      ...(addsToExistingSend
        ? {
            lastSentAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            lastSentBy: options.senderUid,
          }
        : {
            sentAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            sentBy: options.senderUid,
          }),
      /*
       * How many times a PERSON sent this email, which is not how many
       * batches it took. A merchant who pressed Send once and watched it go
       * out over six runs sent it once; counting the batches would put "sent
       * 6 times" on the detail page of a campaign nobody re-sent.
       */
      ...(options.continuation ? {} : { sendCount: additive(1) }),
    },
    { merge: true },
  )
  return {
    campaignId,
    recipients: sendable.length,
    audienceSize: resolved.length,
    ...(audienceTruncated ? { audienceTruncated: true } : {}),
    ...(options.followUp ? { followUp: true, alreadyReached } : {}),
    sent,
    ...(deferred ? { deferred } : {}),
    remaining: plan.remaining,
    resuming: plan.resuming,
    batch: plan.batch,
    ...(plan.resuming ? { nextAtMs } : {}),
  }
}

/**
 * The stored configuration of a send, as the options that would mail it.
 *
 * Every field comes off the RECORD and none of it off the request — the
 * caller names a site and an email id and nothing else. That is not tidiness:
 * `campaignId` addresses an existing document, so a caller who could also
 * supply the body and the audience could put arbitrary copy on somebody
 * else's send id, keep its `cid` and its report, and mail it.
 *
 * Both callers rest on that. A follow-up mails the email that is already
 * there; `sendNow` mails a draft or a scheduled email ahead of its time, and
 * the copy it delivers has to be the copy that was composed and previewed
 * rather than whatever a request body happens to carry.
 *
 * Refuses a send carrying neither a template nor a body, which has no message
 * whichever caller asked.
 */
/*==========================================
  Who a proof may reach, and whose data fills it
==========================================*/

/** One address a test send is allowed to be delivered to. */
export interface ProofRecipient {
  email: string
  /** A person's name where the membership record carries one. */
  label: string
  /** True for the caller's own account address. */
  self: boolean
}

/**
 * THE ADDRESSES A TEST SEND MAY BE DELIVERED TO.
 *
 * The caller's own account address, plus every account holder on the org that
 * owns this site. Exported because the composer has to OFFER this set — a
 * free-text box beside a rule enforced on the server is a box whose every
 * wrong answer is a refusal the person could not have predicted.
 *
 * ## Why membership, and not "any address the merchant types"
 *
 * A test send is exempt from the marketing-consent rule (see the proof
 * carve-out in `performCampaignSend`). An exemption that could be pointed at
 * any address would not be a test-send feature, it would be a way to mail
 * anybody without consent and call it a test. Membership is the narrowest
 * boundary that still answers what the button is for: proofing a draft to the
 * people who work on it.
 *
 * ## What is NOT here
 *
 * `siteMembers`, `leads` and contacts. They are the tenant's audience, and
 * the audience is precisely the population the consent rule protects. A
 * contact can be chosen as the PERSONA a proof renders as — see
 * {@link resolveProofPersona} — which reaches nobody.
 *
 * ## What this does not relax
 *
 * Everything else. The send still runs both suppression lists, so an address
 * that bounced or complained is refused however senior its owner; and a
 * stored `declined` on the address still refuses, because a refusal is the
 * one thing no policy may mail.
 */
export async function proofRecipientsForHost(options: {
  hostId: string
  callerEmail: string
}): Promise<ProofRecipient[]> {
  const callerEmail = String(options?.callerEmail ?? '')
    .trim()
    .toLowerCase()
  const found = new Map<string, ProofRecipient>()
  if (callerEmail) {
    found.set(callerEmail, { email: callerEmail, label: 'You', self: true })
  }

  const orgForHost = await getOrgForHost(options?.hostId).catch(() => null)
  const orgId = String(orgForHost?.orgId ?? '')
  if (!orgId) return [...found.values()]

  const members = await firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    /*
     * A ceiling rather than the whole roster, because this feeds a picker and
     * a picker of two thousand names is not a picker. It is ordered by
     * document id so the page is stable across calls — a `limit` with no
     * order is a random sample, and a person who saw a colleague in the list
     * yesterday must not find them missing today.
     */
    .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
    .limit(200)
    .get()
    .catch(() => null)

  for (const doc of members?.docs ?? []) {
    const email = String(doc.get('email') ?? '')
      .trim()
      .toLowerCase()
    if (!email || found.has(email)) continue
    found.set(email, {
      email,
      label: String(doc.get('displayName') ?? '').trim() || email,
      self: false,
    })
  }
  return [...found.values()]
}

/**
 * Whether one address may receive a proof of this site's mail.
 *
 * Asked as a membership question rather than by scanning
 * {@link proofRecipientsForHost}'s ceilinged page: the picker is allowed to
 * show the first two hundred colleagues, and the gate is not allowed to
 * refuse the two hundred and first.
 */
async function eligibleProofAddress(options: {
  hostId: string
  callerEmail: string
  address: string
}): Promise<boolean> {
  const address = String(options?.address ?? '')
    .trim()
    .toLowerCase()
  if (!address) return false
  if (address === String(options?.callerEmail ?? '').trim().toLowerCase()) {
    return true
  }

  const orgForHost = await getOrgForHost(options?.hostId).catch(() => null)
  const orgId = String(orgForHost?.orgId ?? '')
  if (!orgId) return false

  const match = await firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .where('email', '==', address)
    .limit(1)
    .get()
    .catch(() => null)
  return Boolean(match && !match.empty)
}

/** One person a proof can be rendered as. Reaches nobody. */
export interface ProofPersona {
  email: string
  name: string
  /** Which audience the record came from, so the drawer can say. */
  source: 'lead' | 'member' | 'contact'
}

/** How many of each source the persona picker offers. */
const PROOF_PERSONA_SAMPLE = 20

/**
 * A SAMPLE of the people this site's mail is addressed to, for the picker.
 *
 * A sample and not a search: the question the drawer asks is "show me this
 * email as somebody real", and twenty names from each source answers it for
 * the cost of three small reads. A contact picker with a query behind it is a
 * different feature, and it would put a text input in front of the org's
 * whole contact list on a surface whose job is to prove one email.
 *
 * Ordered by document id in every source, because a `limit` with no `orderBy`
 * is a random sample in doc-id order that a client `sort` then makes LOOK
 * newest-first. Naming the order keeps the picker stable between openings —
 * and on the org path it is also the order the automatic index for the scope
 * filter can actually serve.
 */
export async function proofPersonasForHost(
  hostId: string,
): Promise<ProofPersona[]> {
  const byId = firebaseAdmin.firestore.FieldPath.documentId()
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
  const found = new Map<string, ProofPersona>()

  const collect = (
    docs: FirebaseFirestore.QueryDocumentSnapshot[] | undefined,
    source: ProofPersona['source'],
    nameFields: readonly string[],
  ) => {
    for (const doc of docs ?? []) {
      const email = String(doc.get('email') ?? '')
        .trim()
        .toLowerCase()
      if (!email || found.has(email)) continue
      const name = nameFields
        .map((field) => String(doc.get(field) ?? '').trim())
        .find(Boolean)
      found.set(email, { email, name: name ?? '', source })
    }
  }

  const [leads, members, contacts] = await Promise.all([
    hostRef
      .collection('leads')
      .orderBy(byId)
      .limit(PROOF_PERSONA_SAMPLE)
      .get()
      .catch(() => null),
    hostRef
      .collection('siteMembers')
      .orderBy(byId)
      .limit(PROOF_PERSONA_SAMPLE)
      .get()
      .catch(() => null),
    orgDataQueryForHost(hostId, 'contacts')
      .then(({ query }) => query.orderBy(byId).limit(PROOF_PERSONA_SAMPLE).get())
      .catch(() => null),
  ])

  collect(leads?.docs, 'lead', ['name'])
  // `displayName` first, and `name` only as a fallback: `siteMembers` has
  // never had a `name` field, so reading it alone renders every member
  // persona nameless — which is the exact defect that made merge tags resolve
  // to empty strings for whole audiences.
  collect(members?.docs, 'member', ['displayName', 'name'])
  collect(contacts?.docs, 'contact', ['name', 'firstName'])
  return [...found.values()]
}

/**
 * THE DOCUMENT ONE ADDRESS HAS ON THIS SITE, wherever it lives, or null.
 *
 * ONE lookup for both of the questions a proof asks about a person — what is
 * their name, and did they opt out — because the two must not disagree about
 * WHO the address is. A persona resolved from the contact record beside a
 * consent basis resolved from a lead record would be two different people
 * wearing one address.
 *
 * The three sources are the three an audience is built from, tried in the
 * order a small site grows them. Nothing here is taken from the request.
 *
 * The org `contacts` lookup runs against the UNSCOPED collection and checks
 * `visibleTo` after the read. A scoped query carries `array-contains-any` on
 * `visibleTo`, and pairing that with an equality on `email` would need a
 * composite index for a lookup that happens on one click. This is the same
 * shape the segment branch above uses, for the same reason, and the scope
 * check is not skipped — it is moved.
 */
async function findAudienceDocument(
  hostId: string,
  email: string,
): Promise<{ data: Record<string, unknown>; nameFields: readonly string[] } | null> {
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
  for (const [collection, nameFields] of [
    ['leads', ['name']],
    // `displayName` first: `siteMembers` has never had a `name` field, and
    // reading only that is how merge tags came to render empty for a whole
    // audience.
    ['siteMembers', ['displayName', 'name']],
  ] as const) {
    const snapshot = await hostRef
      .collection(collection)
      .where('email', '==', email)
      .limit(1)
      .get()
      .catch(() => null)
    const doc = snapshot?.docs?.[0]
    if (doc) {
      return { data: (doc.data() ?? {}) as Record<string, unknown>, nameFields }
    }
  }

  const contacts = await orgDataCollectionForHost(hostId, 'contacts').catch(
    () => null,
  )
  const matches = contacts
    ? await contacts
        .where('email', '==', email)
        // More than one, because a name can exist in several scopes within one
        // org and only the ones this site may see are answers.
        .limit(5)
        .get()
        .catch(() => null)
    : null
  for (const doc of matches?.docs ?? []) {
    if (!visibleToHost(doc.get('visibleTo'), hostId)) continue
    return {
      data: (doc.data() ?? {}) as Record<string, unknown>,
      nameFields: ['name', 'firstName'],
    }
  }
  return null
}

/**
 * The stored marketing-consent fields for one address, or null when this site
 * holds no document for it at all.
 *
 * Null and an opted-out record are different answers and the caller treats
 * them differently: an address we have never seen keeps whatever basis the
 * policy assigns an unrecorded person, and one that said no is refused.
 */
async function readStoredConsent(
  hostId: string,
  email: string,
): Promise<Record<string, unknown> | null> {
  if (!email || !EMAIL_PATTERN.test(email)) return null
  const found = await findAudienceDocument(hostId, email).catch(() => null)
  return found?.data ?? null
}

/**
 * The person whose stored data a proof renders as, or null.
 *
 * Read from the audience documents rather than taken from the request, so a
 * proof demonstrates what the MERGE will do to real data.
 */
async function resolveProofPersona(
  hostId: string,
  rawEmail: string,
): Promise<{ email: string; name?: string } | null> {
  const email = String(rawEmail ?? '')
    .trim()
    .toLowerCase()
  if (!email || !EMAIL_PATTERN.test(email)) return null

  const found = await findAudienceDocument(hostId, email).catch(() => null)
  const name = (found?.nameFields ?? [])
    .map((field) => String(found?.data?.[field] ?? '').trim())
    .find(Boolean)

  /*
   * An address that matches nobody still renders, as itself with no name.
   *
   * Refusing would be worse: the merchant asked to see what the email looks
   * like addressed to this person, and "we could not find them" is an answer
   * about our storage rather than about their email. The drawer says which
   * record a persona came from, so a proof that fell through to this reads as
   * the address it is.
   */
  return name ? { email, name } : { email }
}

function storedSendOptionsFrom(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  hostId: string,
  senderUid: string,
  followUp: boolean,
): CampaignSendOptions {
  const audience = String(snapshot.get('audience') ?? '')
  /*
   * A `manual` audience is stored on a scheduled or drafted email and is not
   * stored on one that has already gone out, so the same audience kind is
   * repeatable for one caller and not the other.
   *
   * `emails` is written by the branches that store a send for later. An
   * immediate send takes its addresses from the request and keeps none of
   * them, which is what leaves a follow-up with nothing to re-resolve.
   */
  const emails = Array.isArray(snapshot.get('emails'))
    ? (snapshot.get('emails') as unknown[]).map(String)
    : undefined
  if (audience === 'manual' && (followUp || !emails?.length)) {
    throw new CampaignSendError(
      followUp
        ? 'This email went to addresses typed into the composer, which are ' +
          'not kept, so there is no audience to add anybody from. Compose a ' +
          'new email to the people you want to reach.'
        : 'This email is addressed to typed-in recipients but records none, ' +
          'so there is nobody to send it to.',
      400,
    )
  }
  const templateScreenId = String(snapshot.get('templateScreenId') ?? '')
  const body = String(snapshot.get('body') ?? '')
  if (!templateScreenId && !body) {
    throw new CampaignSendError('This email has no message to send', 400)
  }
  const optional = (field: string) => {
    const value = String(snapshot.get(field) ?? '')
    return value ? { [field]: value } : {}
  }
  return {
    hostId,
    campaignId: snapshot.id,
    ...(followUp ? { followUp: true } : {}),
    senderUid,
    subject: String(snapshot.get('subject') ?? ''),
    body,
    audience,
    ...(emails?.length ? { emails } : {}),
    ...(templateScreenId ? { templateScreenId } : {}),
    ...optional('segmentId'),
    ...optional('listId'),
    ...optional('topicId'),
    ...optional('fromName'),
    // A scheduled or resumed send leaves on the identity it was composed
    // under. Without this it would silently revert to the site's standing
    // selection between the compose and the send, which is the same class of
    // defect as reverting the from name — except that it changes the domain
    // in front of the recipient rather than the words.
    ...optional('sendingIdentity'),
    ...optional('replyTo'),
    ...optional('preheader'),
    ...optional('displayName'),
    ...optional('emailCampaignId'),
    /*
     * The experiment is deliberately NOT carried over on a follow-up.
     *
     * `performCampaignSend` refuses an experiment that is neither running nor
     * decided, so a finished one would fail the whole follow-up — and a
     * running one would take the new recipients as fresh exposures on an
     * experiment whose result the first send has already influenced. So the
     * follow-up mails the subject and body the record holds, which is the
     * campaign's own copy rather than any variant's override.
     *
     * A first send is the opposite case: the email has not run anywhere yet,
     * so the experiment it was composed under is the one it is supposed to
     * go out under, and dropping it here would silently mail the control.
     */
    ...(followUp ? {} : optional('experimentId')),
  }
}

/**
 * Campaign API (AGL-161/272): `action` picks the operation.
 *
 * Every one of them requires a site admin or editor.
 *
 * ## The ones that mail something
 *
 * `send` (the default) delivers copy carried in the request. `sendNow` mails
 * a draft or a scheduled email ahead of its time, and `followUp` mails an
 * already-sent one to the people it has not reached; both of those take every
 * field off the RECORD rather than the request. `test` delivers to the caller
 * alone and records nothing.
 *
 * ## The ones that only write
 *
 * `draft` stores an email that has not been sent, `schedule` stores one with
 * a `sendAtMs` for the processor to deliver, `update` corrects the merchant's
 * own name for an email at any point in its life, and `cancel` withdraws a
 * scheduled one. None of them reserves allowance or moves a meter.
 *
 * ## The ones that answer a question
 *
 * `preview` resolves the audience and reports the counts, `renderPreview`
 * renders the composed message. Neither writes.
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
      /*
       * The control characters are the POINT of this class rather than an
       * accident in it: CR and LF inside a header value ARE the injection
       * shape, and `no-control-regex` cannot tell a pattern that matches
       * them in order to remove them from one that matches them by mistake.
       */
      // eslint-disable-next-line no-control-regex
      .replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
      .trim()
      .slice(0, max)
  // 78 characters is the line length a display name has to live inside.
  const fromName = headerSafe(req.body?.fromName, 78)
  const replyTo = headerSafe(req.body?.replyTo, 254).toLowerCase()
  const preheader = headerSafe(req.body?.preheader, 200)
  /*
   * The email's own name, which is console-only. Flattened to a single line
   * with the header fields beside it even though it reaches no header: it is
   * rendered into a table and a page title, and a value carrying control
   * characters is worth normalizing wherever it is going.
   */
  const displayName = headerSafe(req.body?.displayName, 60)
  /*
   * WHICH OF THE SITE'S IDENTITIES THIS SEND LEAVES ON.
   *
   * Reduced to the one reserved word or to nothing AT THE EDGE, so nothing
   * downstream ever holds a domain name that came out of a request. A body
   * naming `acme.com` here is not an error and is not honored — it is not a
   * value this field has, and it resolves to the site's standing selection
   * exactly as an absent field does.
   */
  const sendingIdentity =
    String(req.body?.sendingIdentity ?? '').trim() === PLATFORM_SENDING_IDENTITY
      ? PLATFORM_SENDING_IDENTITY
      : ''
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
  /*
   * `followUp` and `sendNow` join the exempt actions, and for a stricter
   * reason than the other three: they do not merely need no copy, they must
   * be given none. The message they mail is the one already on the record —
   * see `storedSendOptionsFrom` — so a subject and body in the request would
   * be fields the route silently discards, and a required field that is
   * discarded is the shape that teaches a caller it was used.
   *
   * `draft` is exempt for the opposite reason. A draft is an email that has
   * not been written yet: requiring a subject and a body of it would mean
   * there is no way to create one, which is the whole state.
   *
   * `update` is exempt because it edits neither — it carries a name and
   * nothing else.
   */
  /*
   * `proofOptions` joins them for the plainest of the reasons: it answers who
   * a test may be sent to and whose data could fill it, which is a question
   * about the workspace and not about the message. The composer asks it when
   * the test drawer opens, which is routinely before a subject exists.
   */
  const mails =
    action !== 'cancel' &&
    action !== 'preview' &&
    action !== 'proofOptions' &&
    action !== 'renderPreview' &&
    action !== 'followUp' &&
    action !== 'sendNow' &&
    action !== 'draft' &&
    action !== 'update'
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

    if (action === 'proofOptions') {
      /*
       * THE TWO LISTS THE TEST DRAWER IS BUILT FROM, and they are different
       * kinds of thing.
       *
       * `recipients` is a RULE made visible: these are the only addresses a
       * test may be delivered to, so the drawer offers them instead of a text
       * box whose every other answer is a refusal nobody could have predicted.
       *
       * `personas` is a CONVENIENCE: whose stored data a proof renders as.
       * Choosing one mails that person nothing, which the drawer says in as
       * many words — the two controls sit next to each other and the whole
       * risk of the feature is somebody reading the second as the first.
       */
      const [recipients, personas] = await Promise.all([
        proofRecipientsForHost({ hostId, callerEmail: String(decoded.email ?? '') }),
        proofPersonasForHost(hostId),
      ])
      return res.status(200).json({ recipients, personas })
    }

    if (action === 'test') {
      /*
       * PROOF ONE EMAIL: as somebody, to somebody, from an identity — and
       * still no campaign record and no counter.
       *
       * The three choices are independent and only one of them decides who
       * receives mail. `personaEmail` changes what the merge tags RESOLVE to
       * and reaches nobody; `to` is the only address anything is delivered
       * to; `sendingIdentity` is which of the site's identities it leaves on.
       */
      const ownEmail = String(decoded.email ?? '')
        .trim()
        .toLowerCase()
      const requestedTo = String(req.body?.to ?? '')
        .trim()
        .toLowerCase()
      const testEmail = requestedTo || ownEmail
      if (!testEmail) {
        return res
          .status(400)
          .json({ error: 'Your account has no email address for tests' })
      }
      if (!EMAIL_PATTERN.test(testEmail)) {
        return res
          .status(400)
          .json({ error: 'Enter a valid address to send the test to' })
      }
      /*
       * WHO A TEST SEND MAY REACH, decided here because it is the only layer
       * that can ask whose address this is.
       *
       * A proof may go to the caller's own account address or to another
       * ACCOUNT HOLDER on the owning workspace, and to nobody else. The two
       * populations a merchant could otherwise reach through this button are
       * exactly the two that must not be reachable: a contact or lead, who is
       * subject to the consent rule this send is exempt from, and a stranger,
       * who has no relationship with the workspace at all.
       *
       * `siteMembers` are deliberately NOT eligible. They are the tenant's
       * customers — the audience — and an audience member reached by a
       * "test" is an audience member who has been mailed.
       */
      const eligible = await eligibleProofAddress({
        hostId,
        callerEmail: ownEmail,
        address: testEmail,
      })
      if (!eligible) {
        return res.status(403).json({
          error:
            `A test can only be sent to you or to someone with an account on ` +
            `this workspace, and ${testEmail} is neither. Add them to the ` +
            `workspace first, or send the test to yourself and forward it.`,
        })
      }
      /*
       * The person whose data fills the merge tags. Looked up rather than
       * taken from the request, so what a proof shows is what the audience
       * document actually holds — a persona assembled from a request would
       * demonstrate the composer's own typing rather than the merge.
       */
      const persona = await resolveProofPersona(
        hostId,
        String(req.body?.personaEmail ?? ''),
      )
      const result = await performCampaignSend({
        hostId,
        subject,
        body: body || 'Test send',
        audience: 'manual',
        emails: [testEmail],
        templateScreenId: templateScreenId || undefined,
        fromName,
        replyTo,
        preheader,
        ...(sendingIdentity ? { sendingIdentity } : {}),
        ...(persona ? { proofPersona: persona } : {}),
        recordCampaign: false,
        senderUid: decoded.uid,
        // Not marketing: the recipient holds an account on this workspace.
        proofFor: testEmail,
      })
      return res.status(200).json({
        ...result,
        test: true,
        to: testEmail,
        ...(persona ? { personaEmail: persona.email } : {}),
      })
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
        /*
         * The composer's identity choice rides the preview, which is what
         * makes the refusal arrive BEFORE the Send button rather than from
         * it. The dry run resolves the identity on the same terms a send
         * does and throws the same 409, so picking a domain whose DNS is
         * unfinished says so the moment it is picked.
         */
        ...(sendingIdentity ? { sendingIdentity } : {}),
        senderUid: decoded.uid,
        dryRun: true,
      })
      return res.status(200).json(result)
    }

    if (action === 'followUp') {
      /*
       * SEND AN EMAIL THAT HAS ALREADY GONE OUT TO THE PEOPLE IT HAS NOT
       * REACHED.
       *
       * The request names a site and an email and carries nothing else that
       * is read. Everything the send needs comes back off the record, and
       * `performCampaignSend` re-checks the admission rules this branch does
       * not check at all — it is the same authorization, the same consent
       * split, the same two suppression lists, the same monthly reservation
       * and the same hourly ceilings, because it is the same function.
       *
       * `dryRun` rides through so the console can ask how many people are
       * left before offering the button, and the answer comes from the code
       * that would do the sending rather than from a count of its own.
       */
      const followUpId = String(req.body?.campaignId ?? '')
      if (!isDocumentId(followUpId)) {
        return res.status(400).json({ error: 'Invalid campaignId' })
      }
      const sendSnapshot = await hostRef
        .collection('campaigns')
        .doc(followUpId)
        .get()
      if (!sendSnapshot.exists) {
        return res.status(404).json({ error: 'Unknown email' })
      }
      const result = await performCampaignSend({
        ...storedSendOptionsFrom(sendSnapshot, hostId, decoded.uid, true),
        ...(req.body?.dryRun ? { dryRun: true } : {}),
      })
      return res.status(200).json(result)
    }

    /*==========================================
     * AN EMAIL THAT EXISTS BEFORE IT IS SENT.
     *
     * `draft` is the same write the `schedule` branch below makes, minus the
     * send time — a record in the same collection, under the same id it will
     * keep forever, carrying the copy composed so far and `status: 'draft'`.
     *
     * ## Why a state on the record rather than a collection of its own
     *
     * The id is the reason. `performCampaignSend` adopts a `campaignId` it is
     * given, so a draft becomes the sent email AT ITS OWN ID — which is what
     * makes `/marketing/campaigns/{sendId}` resolve from the moment the email is
     * created, and what keeps the `cid=` inside every delivered unsubscribe
     * HMAC pointing at the record it was minted for. A draft in a second
     * collection would have to be copied to a new id at send time, and the
     * URL a merchant had open would stop being the email's URL.
     *
     * ## What a draft costs
     *
     * Nothing. This branch reserves no monthly allowance, claims no hourly
     * budget and moves no meter — it writes one document, exactly as
     * `schedule` always has. The scheduled processor queries
     * `status == 'scheduled'`, so a draft is never picked up and cannot
     * escape on its own; `performCampaignSend` is the only thing that mails
     * it, and only when somebody asks.
     *=========================================*/
    if (action === 'draft' || action === 'schedule' || action === 'update') {
      const scheduling = action === 'schedule'
      const sendAtMs = Number(req.body?.sendAtMs ?? 0)
      if (scheduling && (!Number.isFinite(sendAtMs) || sendAtMs <= Date.now())) {
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
      const targetRef = hostRef.collection('campaigns').doc(campaignId)
      const targetSnapshot = await targetRef.get()
      const targetState = targetSnapshot.exists
        ? String(targetSnapshot.get('status') ?? '')
        : ''

      /*==========================================
       * WHAT IS ALREADY IN AN INBOX IS NOT EDITABLE.
       *
       * These branches address an EXISTING document by id, so without this
       * check `schedule` would happily merge a new subject and body onto an
       * email that went out last March and set its status back to
       * `scheduled` — rewriting the record of what was delivered, and handing
       * the processor a message to mail a second time under a `cid` whose
       * unsubscribe links are already in inboxes.
       *
       * So copy may only be written while the email is still unsent. `update`
       * is the deliberate exception and is why it is in this branch at all:
       * it writes the merchant's own NAME for the email and nothing else —
       * see the write below — which is console-only text that reached no
       * recipient and therefore contradicts no delivered mail.
       *=========================================*/
      const rewritable = !targetSnapshot.exists ||
        targetState === 'draft' ||
        targetState === 'scheduled'
      if (action !== 'update' && !rewritable) {
        return res.status(409).json({
          error:
            targetState === 'sent'
              ? 'This email has already been sent, so its message and ' +
                'audience can no longer be changed. Compose a new email.'
              : 'This email was canceled, so it can no longer be scheduled. ' +
                'Compose a new email.',
        })
      }
      if (action === 'update') {
        /*
         * The one field a sent email still owns. It is the friendly name the
         * create drawer captures — never the subject, which describes mail
         * that is already in inboxes — so it can be corrected at any point in
         * an email's life without making the record disagree with what was
         * delivered.
         */
        if (!targetSnapshot.exists) {
          return res.status(404).json({ error: 'Unknown email' })
        }
        await targetRef.set({ displayName }, { merge: true })
        return res.status(200).json({ campaignId, displayName })
      }
      await targetRef.set(
        {
          subject,
          body,
          audience,
          /*
           * The one date every message carries — see `email-record.ts`.
           * Stamped only where this write CREATES the record: a draft saved
           * over and over is the same email, and re-stamping it would walk
           * its creation date forward on every keystroke's save. The
           * existence read above is the one this branch already does.
           */
          ...(targetSnapshot.exists ? {} : { createdAtMs: Date.now() }),
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
          ...(sendingIdentity ? { sendingIdentity } : {}),
          ...(replyTo ? { replyTo } : {}),
          ...(preheader ? { preheader } : {}),
          ...(displayName ? { displayName } : {}),
          ...(emailCampaignId ? { emailCampaignId } : {}),
          ...(scheduling
            ? {
                status: 'scheduled',
                sendAtMs,
                scheduledAt:
                  firebaseAdmin.firestore.FieldValue.serverTimestamp(),
                scheduledBy: decoded.uid,
              }
            : {
                status: 'draft',
                /*
                 * The send time is CLEARED rather than left standing.
                 *
                 * Saving a scheduled email back to a draft is how a merchant
                 * takes it off the clock, and `merge: true` leaves any field
                 * this write does not name — so a `sendAtMs` left behind
                 * would sit on a draft as a due date nothing acts on, and the
                 * emails list orders on exactly that field.
                 */
                sendAtMs: firebaseAdmin.firestore.FieldValue.delete(),
                draftedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
                draftedBy: decoded.uid,
              }),
        },
        { merge: true },
      )
      return res
        .status(200)
        .json({ campaignId, status: scheduling ? 'scheduled' : 'draft' })
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

    if (action === 'sendNow') {
      /*==========================================
       * MAIL A DRAFTED OR SCHEDULED EMAIL, NOW.
       *
       * The request names a site and an email and carries nothing else that
       * is read. Everything comes off the record through
       * `storedSendOptionsFrom`, for the reason documented there: this branch
       * addresses an existing document by id, and a caller who could also
       * supply the copy could put arbitrary text on somebody else's send id
       * and mail it under that id's `cid`.
       *
       * It is not a second send path. `performCampaignSend` runs whole — the
       * same authorization, the same consent split, the same two suppression
       * lists, the same topic filtering, the same monthly reservation and the
       * same hourly governor — because it is the same function the scheduled
       * processor and the composer both call.
       *=========================================*/
      const sendNowId = String(req.body?.campaignId ?? '')
      if (!isDocumentId(sendNowId)) {
        return res.status(400).json({ error: 'Invalid campaignId' })
      }
      const sendNowRef = hostRef.collection('campaigns').doc(sendNowId)
      const sendNowSnapshot = await sendNowRef.get()
      if (!sendNowSnapshot.exists) {
        return res.status(404).json({ error: 'Unknown email' })
      }
      const sendNowState = String(sendNowSnapshot.get('status') ?? '')
      /*
       * Only an email that has not gone out yet. A sent one would be mailed a
       * second time to the whole audience under the same id — which is what
       * `followUp` exists to do safely, minus everyone already reached — and
       * a canceled one was withdrawn on purpose.
       */
      if (sendNowState !== 'draft' && sendNowState !== 'scheduled') {
        return res.status(400).json({
          error:
            sendNowState === 'sent'
              ? 'This email has already been sent. Use "Send to more ' +
                'recipients" to reach the people it has not.'
              : 'Only a draft or a scheduled email can be sent now',
        })
      }
      /*==========================================
       * A CAMPAIGN BETWEEN BATCHES IS `scheduled`, AND MUST NOT RESTART.
       *
       * An audience larger than one send goes out over several runs, and
       * between them the email is stored as `scheduled` — the state the
       * processor claims to continue it. So the check above admits it, and
       * this branch would then call `performCampaignSend` with no
       * `continuation`: the whole audience resolved again, nobody subtracted,
       * and a second copy delivered to everybody the earlier batches already
       * reached, under the same `cid` whose unsubscribe links are in their
       * inboxes.
       *
       * Refused rather than quietly turned into a continuation. The rest of
       * this campaign is already due — the processor picks it up on its next
       * beat — so there is nothing for a merchant to ask for here, and
       * "Send now" on a send already in flight is a request made under a
       * misunderstanding the answer should correct.
       *=========================================*/
      const resumeRemaining = Math.floor(
        Number(sendNowSnapshot.get('resume')?.remaining ?? 0),
      )
      if (Number.isFinite(resumeRemaining) && resumeRemaining > 0) {
        return res.status(409).json({
          error:
            'This email is already being sent, and the rest of it goes out ' +
            'on its own. Sending it now would mail a second copy to ' +
            'everyone it has already reached.',
        })
      }
      /*
       * CLAIMED BEFORE IT IS MAILED, exactly as the scheduled processor
       * claims one.
       *
       * A scheduled email whose time arrives mid-send would otherwise be
       * picked up by the processor's `status == 'scheduled'` query while this
       * request is still resolving its audience, and mailed twice. Moving it
       * to `sending` first is the same claim under the same transaction the
       * processor uses, so whichever gets there first is the only one that
       * sends.
       */
      const claimed = await firestore.runTransaction(async (transaction) => {
        const fresh = await transaction.get(sendNowRef)
        if (String(fresh.get('status') ?? '') !== sendNowState) return false
        transaction.update(sendNowRef, { status: 'sending' })
        return true
      })
      if (!claimed) {
        return res
          .status(409)
          .json({ error: 'This email is already being sent' })
      }
      try {
        const result = await performCampaignSend({
          ...storedSendOptionsFrom(sendNowSnapshot, hostId, decoded.uid, false),
          ...(req.body?.dryRun ? { dryRun: true } : {}),
        })
        /*
         * A dry run writes nothing, so the claim above is the only change it
         * made and it has to be put back — otherwise asking how many people
         * an email would reach would leave it stuck in `sending`.
         */
        if (req.body?.dryRun) {
          await sendNowRef.set({ status: sendNowState }, { merge: true })
        }
        return res.status(200).json(result)
      } catch (error) {
        // The claim is released on every failure. `performCampaignSend`
        // writes `status: 'sent'` itself on the way out, so nothing here
        // needs to set it — but a refusal that left the email in `sending`
        // would be an email the merchant can neither send nor cancel.
        await sendNowRef.set({ status: sendNowState }, { merge: true })
        throw error
      }
    }

    /*==========================================
     * AN IMMEDIATE SEND MAY NAME AN EMAIL, BUT ONLY AN UNSENT ONE.
     *
     * This branch takes its copy from the REQUEST, which is what the composer
     * needs — it is sending the message being typed. But it also accepts a
     * `campaignId`, and `performCampaignSend` adopts it, so without this check
     * a request naming a send that already went out would write new copy over
     * the record of what was delivered, replace its counters with this send's
     * own, and mail the whole audience a second copy under a `cid` whose
     * unsubscribe links are already in inboxes.
     *
     * Reaching the people an existing email has NOT reached is `followUp`,
     * which takes no copy from the request at all and subtracts everyone the
     * earlier sends recorded.
     *=========================================*/
    const sendId = String(req.body?.campaignId ?? '')
    if (sendId) {
      if (!isDocumentId(sendId)) {
        return res.status(400).json({ error: 'Invalid campaignId' })
      }
      const existing = await hostRef.collection('campaigns').doc(sendId).get()
      const existingState = existing.exists
        ? String(existing.get('status') ?? '')
        : ''
      if (existing.exists && existingState !== 'draft' && existingState !== 'scheduled') {
        return res.status(409).json({
          error:
            existingState === 'sent'
              ? 'This email has already been sent. Use "Send to more ' +
                'recipients" to reach the people it has not.'
              : 'This email was canceled, so it cannot be sent. Compose a ' +
                'new email.',
        })
      }
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
      campaignId: sendId,
      experimentId: String(req.body?.experimentId ?? ''),
      templateScreenId: templateScreenId || undefined,
      fromName,
      ...(sendingIdentity ? { sendingIdentity } : {}),
      replyTo,
      preheader,
      displayName,
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

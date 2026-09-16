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
 * TAKING SOMETHING AWAY: a campaign container, and an abandoned draft.
 *
 * Both are removals, and neither may take a delivered message with it. That
 * is the whole reason this file is small and the comments are long.
 *
 * ## Why these two are not client writes
 *
 * The console creates and edits a campaign CONTAINER with the client SDK —
 * `hosts/{hostId}/emailCampaigns` is deliberately outside the rules'
 * server-only exclusion list, because a container holds no counter, no
 * consent record and no entitlement input.
 *
 * The SEND collection is the opposite: `hosts/{hostId}/campaigns` is excluded
 * from client create, update AND delete, because each document is the record
 * of what a merchant mailed and to whom they were allowed to mail it. Both
 * operations here have to touch it — one to detach sends from the container
 * being removed, the other to remove a draft outright — so both run on the
 * Admin SDK behind the same site-role check the send route uses.
 *
 * ## What deleting a campaign MEANS
 *
 * The container goes; every email inside it stays, and reads afterwards as a
 * single send.
 *
 * It cannot mean anything else. A send id is cited by mail already delivered
 * — every unsubscribe footer carries `cid={sendId}` inside its own HMAC, and
 * `/marketing/campaigns/{sendId}` is a URL merchants paste into their own
 * messages — so deleting a container that destroyed its sends would break
 * opt-out links that must go on resolving forever, which is a compliance
 * failure rather than a broken page.
 *
 * Nor may the sends simply be left pointing at a container that is gone.
 * `campaignListRows` groups sends by the container they name and draws one
 * row per container; a send naming a container that no longer exists is in
 * neither half of that — not a container row, and not an orphan the list
 * adopts — so it would vanish from the campaigns table while remaining
 * perfectly deliverable. Detaching is what puts it back in the list, as the
 * "Single send" the product already models and the table already draws.
 *
 * Deleting a campaign is therefore NOT a way to stop its mail. A scheduled
 * email inside it keeps its send time and still goes out, because a
 * container is a grouping and cancelling somebody's mail is `cancel`'s job.
 * The console says so before it asks.
 *
 * ## The same rule for everything else the campaign held
 *
 * A campaign also groups forms, screens and contacts, each of which names it
 * from its OWN document. They are detached on exactly the argument the sends
 * are: a form left naming a container nobody can read has not been freed, it
 * has been made unreadable — its page draws a dead id where a campaign name
 * belongs, and the campaigns table can no longer find it. The record itself
 * is never touched. Deleting a campaign deletes a campaign.
 */

/*
 * The MODULE, not the barrel. `@aglyn/tenant-data-admin`'s index reaches
 * `render-cache`, which imports `next/cache` and therefore the whole Next
 * server pipeline — everything this file needs from the admin SDK is one
 * default export, and taking it from the leaf keeps that pipeline out of the
 * graph.
 */
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import { logResourceDuplicated } from '@aglyn/tenant-data-admin/server/duplicate-activity'
import {
  DUPLICATE_BUSY_MESSAGE,
  duplicateDisplayName,
  uniqueDuplicateName,
} from '@aglyn/aglyn/app-utils/duplicate-resource'
import { claimAttempt, createResourceUid } from '@aglyn/aglyn/server'
/*
 * The MODULES again, for the same reason: `consentGroupForSite` and
 * `orgDataCollectionForHost` are what the contact pass needs, and taking them
 * from `@aglyn/tenant-data-admin`'s index would pull the whole Next server
 * pipeline back into this file's graph.
 */
import {
  consentGroupForSite,
  orgDataCollectionForHost,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin/server/organizations'
import {
  CAMPAIGN_MEMBER_HOST_COLLECTIONS,
  CAMPAIGN_MEMBERSHIP_FIELD,
  contactCampaignFieldPath,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  CAMPAIGN_SEND_CONTAINER_FIELD,
} from '@aglyn/shared-ui-email-campaigns/model'
import { SCREEN_KIND_EMAIL } from '@aglyn/aglyn/app-utils/screen-route'
import {
  registerPluginResourceDraftWriter,
  type PluginDraftRecord,
  type PluginDraftRefusal,
  type PluginDraftWrite,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'

/**
 * Sends detached in one write.
 *
 * Under Firestore's 500-operation batch limit with room to spare rather than
 * at it: a batch that is refused for being one over has done nothing, and the
 * margin costs one extra round trip on a campaign of exactly this size.
 */
const DETACH_BATCH = 400

/**
 * How many batches one request will run.
 *
 * A ceiling on the REQUEST, not on the campaign. The loop below terminates on
 * its own — each pass clears the very field it queries on, so a detached send
 * is not returned again — but a request that runs unbounded is a request that
 * eventually exceeds the platform's own timeout with no idea how far it got.
 *
 * Stopping early is safe and is why this is a ceiling rather than a refusal
 * up front: detaching is idempotent and partial progress is a consistent
 * state — the sends already detached read as single sends, the rest still
 * read under the campaign — so the answer to hitting it is to ask again.
 */
const DETACH_PASSES = 25

/** What one `campaigns/manage` call answered with. */
interface ManageResult {
  status: number
  body: Record<string, unknown>
}

/**
 * Clears {@link CAMPAIGN_SEND_CONTAINER_FIELD} from every send in a campaign.
 *
 * Equality on one field with a `limit` — no `orderBy` — which Firestore's
 * automatic single-field index serves. Ordering would need a composite index
 * for a walk whose order does not matter: every match is being written, so
 * which order they come back in cannot change the outcome.
 *
 * @returns how many were detached, and whether any were left.
 */
async function detachSends(
  hostRef: FirebaseFirestore.DocumentReference,
  campaignId: string,
): Promise<{ detached: number; remaining: boolean }> {
  const firestore = hostRef.firestore
  let detached = 0
  for (let pass = 0; pass < DETACH_PASSES; pass += 1) {
    const page = await hostRef
      .collection('campaigns')
      .where(CAMPAIGN_SEND_CONTAINER_FIELD, '==', campaignId)
      .limit(DETACH_BATCH)
      .get()
    if (page.empty) return { detached, remaining: false }
    const batch = firestore.batch()
    for (const send of page.docs) {
      /*
       * The FIELD is removed, not set to an empty string. `campaignListRows`
       * adopts a send whose container id is falsy, so an empty string would
       * work by accident today — but the field is also what the campaign
       * detail page's `where` clause matches, and an equality query on `''`
       * is a different query from the absence the pre-container sends have.
       * One shape for "belongs to no campaign" is what keeps those two
       * readers agreeing.
       */
      batch.update(send.ref, {
        [CAMPAIGN_SEND_CONTAINER_FIELD]:
          firebaseAdmin.firestore.FieldValue.delete(),
      })
    }
    await batch.commit()
    detached += page.size
    if (page.size < DETACH_BATCH) return { detached, remaining: false }
  }
  return { detached, remaining: true }
}

/**
 * Clears one campaign id out of a membership array, wherever it is held.
 *
 * The same walk {@link detachSends} makes, over an ARRAY field rather than a
 * scalar one: `array-contains` matches on Firestore's automatic single-field
 * index, and `arrayRemove` takes out the one id without touching the other
 * campaigns a form or a screen is in. That is the whole reason the membership
 * is an array here and a `FieldValue.delete()` on a send — a send is in one
 * campaign and a landing page is in several, so removing one must not be
 * removing all of them.
 *
 * `query` rather than a collection ref, because the contact pass hands in a
 * path this file cannot build for itself.
 *
 * @returns how many were detached, and whether any were left.
 */
async function detachMembership(
  firestore: FirebaseFirestore.Firestore,
  collectionRef: FirebaseFirestore.CollectionReference,
  fieldPath: string,
  campaignId: string,
): Promise<{ detached: number; remaining: boolean }> {
  let detached = 0
  for (let pass = 0; pass < DETACH_PASSES; pass += 1) {
    const page = await collectionRef
      .where(fieldPath, 'array-contains', campaignId)
      .limit(DETACH_BATCH)
      .get()
    if (page.empty) return { detached, remaining: false }
    const batch = firestore.batch()
    for (const member of page.docs) {
      batch.update(member.ref, {
        [fieldPath]: firebaseAdmin.firestore.FieldValue.arrayRemove(campaignId),
      })
    }
    await batch.commit()
    detached += page.size
    if (page.size < DETACH_BATCH) return { detached, remaining: false }
  }
  return { detached, remaining: true }
}

/**
 * Clears the campaign off every form, screen and contact holding it.
 *
 * ## Why the campaign is not simply deleted over the top of them
 *
 * A campaign that went away leaving members naming it is the same failure the
 * send detach exists to prevent, one collection over: the campaign's own page
 * finds its forms and screens with `array-contains`, and a form still naming
 * a container nobody can read is in neither half of that — not a member of
 * any campaign the console can draw, and not free of one either. Its own page
 * would render the dead id as a chip with no name.
 *
 * ## The contacts are reached by a different path, on purpose
 *
 * A contact lives on the ORG (`orgs/{orgId}/contacts`) and is shared by every
 * site in it, so the membership sits inside this site's consent-group facet
 * rather than at the top of the document. The field PATH is therefore the
 * scope: only rows this group filed under the campaign match it, and no other
 * holder's filing is touched. The unscoped collection ref is what the walk
 * runs on precisely because the path already carries the boundary — the
 * `visibleTo` filter `orgDataQueryForHost` adds would spend the query's one
 * array-contains slot and leave none for the membership.
 *
 * A group that cannot be resolved answers as the site alone, which is
 * {@link consentGroupForSite}'s documented failure direction and the safe one
 * here too: the pass then clears the site's own facet and no other.
 */
async function detachMembers(
  hostId: string,
  hostRef: FirebaseFirestore.DocumentReference,
  campaignId: string,
): Promise<{ detached: number; remaining: boolean }> {
  const firestore = hostRef.firestore
  let detached = 0
  let remaining = false
  for (const collectionName of CAMPAIGN_MEMBER_HOST_COLLECTIONS) {
    const pass = await detachMembership(
      firestore,
      hostRef.collection(collectionName),
      CAMPAIGN_MEMBERSHIP_FIELD,
      campaignId,
    )
    detached += pass.detached
    remaining = remaining || pass.remaining
  }
  /*
   * NO ORG, NO ORG CONTACTS — and that is a skip rather than a failure.
   *
   * Contacts live at `orgs/{orgId}/contacts`, so a site whose `hostIndex`
   * entry names no org holds none of them and there is nothing here to
   * detach. Resolving it first is what separates that from a read that FAILED:
   * `orgDataCollectionForHost` throws for both, and swallowing both would let
   * a transient Firestore error delete the campaign with contacts still
   * naming it. A thrown read reaches the handler's 500 and the container
   * survives, which is the direction a failure here has to fall.
   */
  const orgId = await resolveOrgIdForHost(hostId)
  if (!orgId) return { detached, remaining }
  const group = await consentGroupForSite(hostId)
  const contacts = await orgDataCollectionForHost(hostId, 'contacts')
  const contactPass = await detachMembership(
    firestore,
    contacts,
    contactCampaignFieldPath(group.groupId),
    campaignId,
  )
  return {
    detached: detached + contactPass.detached,
    remaining: remaining || contactPass.remaining,
  }
}

/**
 * Removes a campaign container, leaving its emails standing.
 *
 * Detach first, delete second, and the order is the point: stopping between
 * them leaves a container whose emails are already single sends, which the
 * list draws correctly and a second run finishes. Deleting first would leave
 * sends naming a container nobody can read, which is the state that loses
 * them from the table.
 */
async function deleteCampaign(
  hostId: string,
  hostRef: FirebaseFirestore.DocumentReference,
  campaignId: string,
): Promise<ManageResult> {
  const ref = hostRef.collection('emailCampaigns').doc(campaignId)
  const snapshot = await ref.get()
  /*
   * A 404 rather than a silent success. The id in a campaign URL may name a
   * container OR a single send — that ambiguity is what keeps every link
   * minted before containers existed resolving — so "no container here" is
   * very often "this is a send", and answering it as a completed deletion
   * would tell the console it had removed something it never touched.
   */
  if (!snapshot.exists) {
    return { status: 404, body: { error: 'Unknown campaign' } }
  }
  const { detached, remaining } = await detachSends(hostRef, campaignId)
  if (remaining) {
    return {
      status: 409,
      body: {
        detached,
        error:
          `This campaign holds more emails than one request can detach. ` +
          `${detached.toLocaleString()} of them now read as single sends and ` +
          'the campaign is still here — run the delete again to finish it.',
      },
    }
  }
  /*
   * The MEMBERS come off before the container does, for the reason the sends
   * do: a partial run leaves records that are already out of the campaign,
   * which every surface draws correctly, while deleting first would leave
   * forms, screens and contacts naming an id nothing can resolve.
   *
   * Their own 409 rather than a shared one. "More emails than one request can
   * detach" is a sentence about the campaign's mail, and a merchant reading
   * it about a campaign of two emails and four thousand contacts would go
   * looking for emails that are not the problem.
   */
  const members = await detachMembers(hostId, hostRef, campaignId)
  if (members.remaining) {
    return {
      status: 409,
      body: {
        detached,
        detachedMembers: members.detached,
        error:
          'This campaign is on more records than one request can clear. ' +
          `${members.detached.toLocaleString()} of them are already out of ` +
          'it and the campaign is still here — run the delete again to ' +
          'finish it.',
      },
    }
  }
  await ref.delete()
  return {
    status: 200,
    body: {
      campaignId,
      detached,
      detachedMembers: members.detached,
      deleted: true,
    },
  }
}

/**
 * Discards a DRAFT email, and refuses anything else.
 *
 * The state check is inside the transaction as well as being the reason for
 * it. `sendNow` claims a draft by moving it to `sending` in a transaction of
 * its own, so a check made against an earlier read could delete a record
 * while the send path was mailing from it — the merchant would receive a
 * report for an email that no longer exists, and its `cid` would stop
 * resolving with the message already in inboxes.
 *
 * Only `draft`. A scheduled email is withdrawn with `cancel`, which leaves
 * the record and its report standing; a sent one has reached people, and
 * nothing on this surface may remove the evidence of that.
 */
async function discardDraft(
  hostRef: FirebaseFirestore.DocumentReference,
  emailId: string,
): Promise<ManageResult> {
  const ref = hostRef.collection('campaigns').doc(emailId)
  const firestore = hostRef.firestore
  const refusal = (state: string): string => {
    if (state === 'sent') {
      return 'This email has already been sent, so it cannot be discarded. ' +
        'Its report and its unsubscribe links have to go on resolving.'
    }
    if (state === 'scheduled') {
      return 'This email is scheduled. Cancel the send first — cancelling ' +
        'keeps the email and takes it off the clock.'
    }
    if (state === 'sending') {
      return 'This email is being sent right now.'
    }
    return 'Only a draft can be discarded.'
  }
  const outcome = await firestore.runTransaction(
    async (transaction): Promise<ManageResult> => {
      const fresh = await transaction.get(ref)
      if (!fresh.exists) {
        return { status: 404, body: { error: 'Unknown email' } }
      }
      const state = String(fresh.get('status') ?? '')
      if (state !== 'draft') {
        return { status: 409, body: { error: refusal(state) } }
      }
      /*
       * A plain delete, with nothing recursive under it. The one
       * subcollection a message grows is `reports/links`, written by the
       * delivery webhook — an email that has never been sent has no
       * deliveries, so there is nothing beneath a draft to leave behind.
       */
      transaction.delete(ref)
      return { status: 200, body: { emailId, discarded: true } }
    },
  )
  return outcome
}

/**
 * Campaign management API: removing a campaign, and discarding a draft.
 *
 * Separate from `campaigns/send` because nothing here sends, reserves
 * allowance or moves a meter, and because both operations are about a record
 * ceasing to exist — which is the one class of change that has to be read
 * against what a merchant has already mailed. Same authorization as the send
 * route: a site admin or editor, proven by a Firebase ID token.
 *
 * Editing a campaign is deliberately NOT here. The container is client-
 * writable by the same roles, its create already runs on the client SDK, and
 * a second door to the same document would be a second place for the two to
 * disagree about what a campaign may hold.
 */
/**
 * The fields a copy of a message carries (AGL-2936): what was written and
 * how it is sent — never who it goes to or when. The audience, list,
 * segment, addresses, schedule and experiment are the decisions a person
 * makes about THIS send, and a copy that inherited them would be one click
 * from mailing the same people twice.
 */
const DUPLICATED_MESSAGE_FIELDS = [
  'subject',
  'body',
  'fromName',
  'replyTo',
  'senderId',
  'templateScreenId',
  'plainText',
  'plainTextVersionId',
  'topicId',
  CAMPAIGN_SEND_CONTAINER_FIELD,
] as const

/**
 * Copies a message as a new draft (AGL-2936). Any status can be copied —
 * a sent email is the usual source — and the copy is always `draft`, with
 * the name the person gave it made unique among the site's messages.
 */
async function duplicateMessage(
  hostId: string,
  hostRef: FirebaseFirestore.DocumentReference,
  emailId: string,
  requestedName: string,
  actor: { uid: string; email: string | null; orgId: string },
): Promise<ManageResult> {
  const messages = hostRef.collection('campaigns')
  const firestore = hostRef.firestore
  const id = createResourceUid()
  const outcome = await firestore.runTransaction(
    async (transaction): Promise<ManageResult & { name?: string; sourceName?: string }> => {
      const [source, siblings] = await Promise.all([
        transaction.get(messages.doc(emailId)),
        transaction.get(messages.select('displayName', 'subject')),
      ])
      if (!source.exists) {
        return { status: 404, body: { error: 'Unknown email' } }
      }
      const data = (source.data() ?? {}) as Record<string, unknown>
      const sourceName = String(data['displayName'] ?? data['subject'] ?? '').trim()
      const name = uniqueDuplicateName(
        requestedName.trim() || duplicateDisplayName(sourceName),
        siblings.docs.map((row) => String(row.get('displayName') ?? row.get('subject') ?? '')),
      )
      const copy: Record<string, unknown> = {}
      for (const field of DUPLICATED_MESSAGE_FIELDS) {
        if (data[field] !== undefined && data[field] !== null) copy[field] = data[field]
      }
      const nowMs = Date.now()
      transaction.create(messages.doc(id), {
        ...copy,
        displayName: name,
        status: 'draft',
        createdAtMs: nowMs,
        draftedAt: new Date(nowMs),
        draftedBy: actor.uid,
      })
      return { status: 200, body: { emailId: id, name }, name, sourceName }
    },
  )
  if (outcome.status === 200) {
    await logResourceDuplicated(
      'campaign',
      { uid: actor.uid, email: actor.email },
      {
        orgId: actor.orgId,
        hostId,
        source: { id: emailId, name: outcome.sourceName ?? '' },
        target: { id, name: outcome.name ?? '' },
      },
    )
  }
  return { status: outcome.status, body: outcome.body }
}

/*==========================================
 * A CAMPAIGN THAT EXISTS BEFORE ANYBODY CHOSE WHO GETS IT (AGL-2912).
 *
 * The draft writer this plugin registers for the `campaign` resource on the
 * core's resource-drafts seam. Another plugin that produces a campaign — a
 * generator working from a brief, an importer bringing campaigns over from
 * another tool — asks for it by name, and gets exactly two documents:
 *
 *  - the CONTAINER at `emailCampaigns/{id}`, written as the campaigns list's
 *    create drawer writes one, aimed at no list;
 *  - ONE EMAIL inside it at `campaigns/{id}-email`, `status: 'draft'`, naming
 *    the email design it sends and holding its subject, preheader and the
 *    alternatives to them.
 *
 * ## What a drafted email never holds
 *
 * An audience, a list, a segment, addresses, a topic, a sender, a send time or
 * an experiment. Those are the decisions a person makes about a send — the
 * duplicate above strips the same ones for the same reason — and a draft that
 * arrived holding any of them would be one click from mailing people nobody
 * chose. So the writer has no field for them to arrive in.
 *
 * ## Why a draft cannot escape
 *
 * Nothing here reserves an allowance, claims a budget or calls the send path,
 * and the scheduled processor queries `status == 'scheduled'`, which a draft
 * never is. `performCampaignSend` is the only thing that mails a draft, behind
 * the send route's own authorization, when a member asks.
 *
 * The id of the email is derived from the campaign's rather than minted, so a
 * write asked again finds the email it made — and differs from it, because a
 * campaign URL names a container OR a send, and one id naming both would read
 * as either.
 *=========================================*/

/** The resource name the campaign draft writer is registered under. */
export const CAMPAIGN_DRAFT_RESOURCE = 'campaign'

/** The id `plugins.config.json` registers this plugin under. */
const MARKETING_PLUGIN_ID = 'marketing'

/** A drafted campaign's name when the caller asks for none. */
export const CAMPAIGN_DRAFT_DEFAULT_NAME = 'Untitled campaign'

/** The longest subject or preheader a drafted email stores: the send route's header cap. */
export const CAMPAIGN_DRAFT_HEADER_MAX_CHARS = 200

/** The most alternative subject lines or preheaders a drafted email keeps. */
export const CAMPAIGN_DRAFT_MAX_VARIANTS = 10

/** The site roles that may compose this site's mail. */
export const CAMPAIGN_DRAFT_ROLES = ['admin', 'editor'] as const
/** The send route's refusal for a member who may not compose this site's mail. */
export const CAMPAIGN_DRAFT_ROLE_REFUSAL = 'Not a site admin or editor'

/** The id of the one email inside a drafted campaign. */
export function campaignDraftEmailId(campaignId: string): string {
  return `${campaignId}-email`
}

/** Every field a drafted email is written with, and so every field it can hold. */
export const CAMPAIGN_DRAFT_EMAIL_FIELDS = [
  'subject',
  'preheader',
  'templateScreenId',
  'subjectVariants',
  'preheaderVariants',
  CAMPAIGN_SEND_CONTAINER_FIELD,
  'status',
  'createdAtMs',
  'draftedAt',
  'draftedBy',
] as const

/** What a caller sends as `content`. */
export interface CampaignDraftContent {
  /** The email design the email sends: a `kind: 'email'` screen on the site. */
  templateScreenId: string
  subject: string
  preheader: string
  subjectVariants: string[]
  preheaderVariants: string[]
}

/** A header value on one line: controls and runs of space folded to one space. */
function draftHeaderLine(value: unknown): string {
  return String(value ?? '').replace(/[\p{Cc}\s]+/gu, ' ').trim()
}

function draftVariants(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const lines: string[] = []
  for (const raw of value) {
    const line = draftHeaderLine(raw)
    if (!line || seen.has(line.toLowerCase())) continue
    seen.add(line.toLowerCase())
    lines.push(line)
  }
  return lines.slice(0, CAMPAIGN_DRAFT_MAX_VARIANTS)
}

export function readCampaignDraftContent(
  content: Readonly<Record<string, unknown>>,
): { ok: true; value: CampaignDraftContent } | { ok: false; problems: string[] } {
  const value: CampaignDraftContent = {
    templateScreenId: String(content['templateScreenId'] ?? ''),
    subject: draftHeaderLine(content['subject']),
    preheader: draftHeaderLine(content['preheader']),
    subjectVariants: draftVariants(content['subjectVariants']),
    preheaderVariants: draftVariants(content['preheaderVariants']),
  }
  const problems: string[] = []
  if (!isDocumentId(value.templateScreenId)) {
    problems.push('A drafted campaign needs the email design it sends')
  }
  if (!value.subject) problems.push('A drafted campaign needs a subject line')
  const long = (lines: string[]) =>
    lines.some((line) => line.length > CAMPAIGN_DRAFT_HEADER_MAX_CHARS)
  if (long([value.subject, ...value.subjectVariants])) {
    problems.push(`A subject line is longer than ${CAMPAIGN_DRAFT_HEADER_MAX_CHARS} characters`)
  }
  if (long([value.preheader, ...value.preheaderVariants])) {
    problems.push(`A preheader is longer than ${CAMPAIGN_DRAFT_HEADER_MAX_CHARS} characters`)
  }
  return problems.length ? { ok: false, problems } : { ok: true, value }
}

function campaignDraftRoleRefusal(
  host: FirebaseFirestore.DocumentSnapshot,
  uid: string,
): PluginDraftRefusal | null {
  const role = (host.get('memberRoles') ?? {})[uid]
  return CAMPAIGN_DRAFT_ROLES.includes(role)
    ? null
    : { status: 403, error: CAMPAIGN_DRAFT_ROLE_REFUSAL }
}

function campaignDraftRecord(campaign: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord {
  return {
    id: campaign.id,
    name: String(campaign.get('name') ?? ''),
    versionId: null,
    facts: { emailId: campaignDraftEmailId(campaign.id) },
  }
}

export interface CampaignDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => FirebaseFirestore.Firestore
}

export function createCampaignDraftWriter(
  deps: CampaignDraftWriterDeps = {},
): PluginResourceDraftWriter {
  const firestore =
    deps.firestore ??
    (() => firebaseAdmin.app().firestore() as unknown as FirebaseFirestore.Firestore)
  return {
    refusal: async ({ hostId, uid }) => {
      const host = await firestore().collection('hosts').doc(hostId).get()
      if (!host.exists) return { status: 404, error: 'Unknown site' }
      return campaignDraftRoleRefusal(host, uid)
    },

    check: (content) => {
      const read = readCampaignDraftContent(content)
      return read.ok === false
        ? read
        : { ok: true, facts: { fields: [...CAMPAIGN_DRAFT_EMAIL_FIELDS] } }
    },

    read: async ({ hostId, id }) => {
      if (!isDocumentId(id)) return null
      const campaign = await firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('emailCampaigns')
        .doc(id)
        .get()
      return campaign.exists ? campaignDraftRecord(campaign) : null
    },

    write: async (request): Promise<PluginDraftWrite> => {
      const read = readCampaignDraftContent(request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      if (!isDocumentId(request.id)) return { ok: false, status: 400, error: 'Invalid campaignId' }
      const db = firestore()
      const hostRef = db.collection('hosts').doc(request.hostId)
      const campaignRef = hostRef.collection('emailCampaigns').doc(request.id)
      const emailId = campaignDraftEmailId(request.id)
      const emailRef = hostRef.collection('campaigns').doc(emailId)
      const designRef = hostRef.collection('screens').doc(read.value.templateScreenId)
      return db.runTransaction(async (transaction): Promise<PluginDraftWrite> => {
        const [host, campaign, email, design] = await Promise.all([
          transaction.get(hostRef),
          transaction.get(campaignRef),
          transaction.get(emailRef),
          transaction.get(designRef),
        ])
        if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
        if (campaign.exists) {
          return { ok: true, replayed: true, ...campaignDraftRecord(campaign) }
        }
        const refusal = campaignDraftRoleRefusal(host, request.uid)
        if (refusal) return { ok: false, ...refusal }
        if (
          !design.exists ||
          design.get('deletedAt') != null ||
          design.get('kind') !== SCREEN_KIND_EMAIL
        ) {
          return { ok: false, status: 400, error: 'Unknown email design' }
        }
        if (email.exists) return { ok: false, status: 409, error: 'That email already exists' }
        const name = draftHeaderLine(request.name) || CAMPAIGN_DRAFT_DEFAULT_NAME
        const nowMs = request.now.getTime()
        // The create drawer's own document: a name, no dates, no lists.
        transaction.create(campaignRef, {
          name,
          listIds: [],
          createdAtMs: nowMs,
          createdBy: request.uid,
        })
        const { value } = read
        transaction.create(emailRef, {
          subject: value.subject,
          ...(value.preheader ? { preheader: value.preheader } : {}),
          templateScreenId: value.templateScreenId,
          ...(value.subjectVariants.length ? { subjectVariants: value.subjectVariants } : {}),
          ...(value.preheaderVariants.length ? { preheaderVariants: value.preheaderVariants } : {}),
          [CAMPAIGN_SEND_CONTAINER_FIELD]: request.id,
          status: 'draft',
          createdAtMs: nowMs,
          draftedAt: request.now,
          draftedBy: request.uid,
        })
        return {
          ok: true,
          replayed: false,
          id: request.id,
          name,
          versionId: null,
          facts: { emailId },
        }
      })
    },
  }
}

export const campaignDraftWriter = createCampaignDraftWriter()

/** Registers the writer; both server surfaces call it, and the second replaces the first. */
export function registerCampaignDraftWriter(): void {
  registerPluginResourceDraftWriter(CAMPAIGN_DRAFT_RESOURCE, campaignDraftWriter, {
    pluginId: MARKETING_PLUGIN_ID,
  })
}

export const campaignManageHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const action = String(req.body?.action ?? '')
  const targetId = String(req.body?.campaignId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  if (!isDocumentId(targetId)) {
    return res.status(400).json({ error: 'Invalid campaignId' })
  }
  if (
    action !== 'deleteCampaign' &&
    action !== 'discardEmail' &&
    action !== 'duplicate'
  ) {
    return res.status(400).json({ error: 'Unknown action' })
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

    if (action === 'duplicate') {
      // One attempt key, one copy (AGL-2936): a double click on Duplicate
      // replays the first answer rather than drafting the message twice.
      const attemptKey = String(req.body?.attemptKey ?? '').trim().slice(0, 200)
      const orgId = (await resolveOrgIdForHost(hostId)) ?? ''
      const claimed = attemptKey
        ? await claimAttempt(firestore as never, {
            kind: 'duplicate-campaign',
            scopeId: `${hostId}:${targetId}`,
            orgId,
            key: attemptKey,
            busyMessage: DUPLICATE_BUSY_MESSAGE,
          })
        : null
      if (claimed && 'replay' in claimed) {
        return res.status(claimed.replay.status).json(claimed.replay.body)
      }
      const claim = claimed && 'claim' in claimed ? claimed.claim : null
      const copied = await duplicateMessage(
        hostId,
        hostRef,
        targetId,
        String(req.body?.name ?? ''),
        { uid: decoded.uid, email: decoded.email ?? null, orgId },
      )
      if (copied.status === 200) await claim?.record(copied.status, copied.body)
      else await claim?.release()
      return res.status(copied.status).json(copied.body)
    }
    const result =
      action === 'deleteCampaign'
        ? await deleteCampaign(hostId, hostRef, targetId)
        : await discardDraft(hostRef, targetId)
    return res.status(result.status).json(result.body)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'The request could not be completed' })
  }
}

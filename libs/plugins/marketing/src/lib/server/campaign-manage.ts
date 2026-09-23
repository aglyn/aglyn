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
 * `orgs/{orgId}/emailCampaigns` is client-writable, because a container holds
 * no counter, no consent record and no entitlement input. It is not
 * client-DELETABLE: removing one has to detach everything that names it
 * first, across every site in the organization, which no rule can express.
 *
 * The SEND collection is the opposite: `orgs/{orgId}/campaigns` is excluded
 * from client create, update AND delete, because each document is the record
 * of what a merchant mailed and to whom they were allowed to mail it. Both
 * operations here have to touch it — one to detach sends from the container
 * being removed, the other to remove a draft outright — so both run on the
 * Admin SDK behind a role check.
 *
 * ## Two doors: a site, and the organization
 *
 * A campaign belongs to the organization and may be placed on several of its
 * sites. A request from a SITE hub names the site (`hostId`) and is
 * authorized by the caller's role there, as the send route is — and it acts
 * only on what that site holds: a send sent as another site, or a campaign
 * not placed on this one, answers as if it did not exist. A request from the
 * ORGANIZATION hub names the org (`orgId`) and no site, and is authorized by
 * the caller's org-wide membership; for an email it acts in the name of the
 * site the email is sent as.
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
 * The MODULES again, for the same reason: the org and membership reads here
 * are what the contact pass and the organization door need, and taking them
 * from `@aglyn/tenant-data-admin`'s index would pull the whole Next server
 * pipeline back into this file's graph.
 */
import {
  consentGroupForSite,
  getOrgDoc,
  resolveOrgIdForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin/server/organizations'
import {
  CAMPAIGN_MEMBER_HOST_COLLECTIONS,
  CAMPAIGN_MEMBERSHIP_FIELD,
  contactCampaignFieldPath,
  isOrgWideMember,
  type AglynOrgMember,
  type PluginApiHandler,
  type PluginApiRequestSubject,
} from '@aglyn/aglyn/server'
import {
  CAMPAIGN_SEND_CONTAINER_FIELD,
  CAMPAIGN_SEND_HOST_FIELD,
  campaignPlacedOnHost,
  campaignSiteIds,
  campaignVisibleTo,
} from '@aglyn/shared-ui-email-campaigns/model'
import {
  campaignSendSiteStamp,
  orgCampaignSends,
  orgEmailCampaigns,
  sendHostId,
  sendIsOnHost,
} from './campaign-org-refs'
import { SCREEN_KIND_EMAIL } from '@aglyn/aglyn/app-utils/screen-route'
import {
  registerPluginResourceDraftWriter,
  type PluginDraftRecord,
  type PluginDraftRefusal,
  type PluginDraftWrite,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { runPluginMembershipDetachers } from '@aglyn/aglyn/plugin-manager/plugin-membership-detach'
import { isPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'

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

/**
 * The most sites one deletion walks for members.
 *
 * A campaign is the organization's, so its forms, screens and consent-group
 * facets may be on any of its sites. An organization past this has more
 * sites than one request should sweep, and the deletion refuses rather than
 * removing a container some sites' records would still name.
 */
const ORG_SITES_MAX = 200

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
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  campaignId: string,
): Promise<{ detached: number; remaining: boolean }> {
  let detached = 0
  for (let pass = 0; pass < DETACH_PASSES; pass += 1) {
    const page = await orgCampaignSends(firestore, orgId)
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
 * Every site of the organization, by id — the sites a campaign's members may
 * be on. One equality on the `hostIndex` mirror, the same document
 * `resolveOrgIdForHost` reads to put a site in an org.
 *
 * @returns the ids, and whether the org has more than {@link ORG_SITES_MAX}.
 */
async function orgSiteIds(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<{ hostIds: string[]; truncated: boolean }> {
  const page = await firestore
    .collection('hostIndex')
    .where('orgId', '==', orgId)
    .limit(ORG_SITES_MAX + 1)
    .get()
  const hostIds = page.docs.map((doc) => String(doc.id))
  return {
    hostIds: hostIds.slice(0, ORG_SITES_MAX),
    truncated: hostIds.length > ORG_SITES_MAX,
  }
}

/**
 * Clears the campaign off every form, screen, lead and contact holding it,
 * on every site of the organization, and then off every record a plugin
 * keeps about it (AGL-3254).
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
 * ## Every site, not the one that asked
 *
 * The campaign is the organization's, and a site it has since been taken off
 * may still hold forms and screens filed under it. So the walk covers every
 * site in the org regardless of which door the deletion came through.
 *
 * ## Leads and contacts are reached on the organization
 *
 * A lead lives at `orgs/{orgId}/leads` and carries the field at the top of
 * its document, like a form. The site `leads` collection is walked as well,
 * as part of each site's own collections: records captured before leads
 * moved to the org are still read there.
 *
 * A contact lives at `orgs/{orgId}/contacts` and is shared by every site, so
 * the membership sits inside a consent group's facet rather than at the top
 * of the document. The field PATH is therefore the scope, and the walk runs
 * once per distinct group of the org's sites — two sites declared as one
 * sender share a facet, and clearing it twice would find nothing the second
 * time. The unscoped collection ref is what the walk runs on precisely
 * because the path already carries the boundary — a `visibleTo` filter would
 * spend the query's one array-contains slot and leave none for the
 * membership.
 *
 * ## A plugin's members are the plugin's to clear
 *
 * A sequence and its enrollments name the campaign from documents under the
 * org, in collections this plugin does not know (AGL-3254). Every plugin
 * with a membership detacher registered on the core's seam is asked, once
 * per site, with the campaign's id and the field it is held in, and a
 * detacher that reports records remaining — or threw, which is reported as
 * `null` — holds the container exactly as this pass's own `remaining` does.
 * A plugin that failed is a plugin whose records may still name the
 * campaign, and the deletion has no way to tell that apart from one that has
 * more than a request clears.
 */
async function detachMembers(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  campaignId: string,
): Promise<{ detached: number; remaining: boolean }> {
  let detached = 0
  let remaining = false
  const take = (pass: { detached: number; remaining: boolean }) => {
    detached += pass.detached
    remaining = remaining || pass.remaining
  }
  const { hostIds, truncated } = await orgSiteIds(firestore, orgId)
  if (truncated) remaining = true
  for (const hostId of hostIds) {
    const hostRef = firestore.collection('hosts').doc(hostId)
    for (const collectionName of CAMPAIGN_MEMBER_HOST_COLLECTIONS) {
      take(
        await detachMembership(
          firestore,
          hostRef.collection(collectionName),
          CAMPAIGN_MEMBERSHIP_FIELD,
          campaignId,
        ),
      )
    }
  }
  const orgRef = firestore.collection('orgs').doc(orgId)
  take(
    await detachMembership(
      firestore,
      orgRef.collection('leads'),
      CAMPAIGN_MEMBERSHIP_FIELD,
      campaignId,
    ),
  )
  /*
   * An org with no sites still has plugins that may hold the campaign, so
   * the seam is asked once with no site rather than not at all.
   */
  for (const hostId of hostIds.length ? hostIds : ['']) {
    const plugins = await runPluginMembershipDetachers({
      hostId,
      orgId,
      field: CAMPAIGN_MEMBERSHIP_FIELD,
      id: campaignId,
    })
    for (const report of Object.values(plugins)) {
      detached += report?.detached ?? 0
      remaining = remaining || report === null || report.remaining
    }
  }
  /*
   * One read of the org document serves every site's group: with it in
   * hand, `consentGroupForSite` resolves from the declaration without a
   * lookup per site. A missing document answers every site as a group of
   * one, which is `consentGroupForSite`'s documented failure direction and
   * the safe one here — each site's own facet is cleared, and no other.
   */
  const org = ((await getOrgDoc(orgId)) ?? {}) as Record<string, unknown>
  const groupIds = new Set<string>()
  for (const hostId of hostIds) {
    groupIds.add((await consentGroupForSite(hostId, org)).groupId)
  }
  const contacts = orgRef.collection('contacts')
  for (const groupId of groupIds) {
    take(
      await detachMembership(
        firestore,
        contacts,
        contactCampaignFieldPath(groupId),
        campaignId,
      ),
    )
  }
  return { detached, remaining }
}

/** Who is deleting, and through which door. */
interface DeleteAccess {
  /** The site hub the request came from, or `''` from the organization hub. */
  hostId: string
  /** The caller, for the site door's reach check. */
  uid: string
}

/**
 * Removes a campaign container, leaving its emails standing.
 *
 * Detach first, delete second, and the order is the point: stopping between
 * them leaves a container whose emails are already single sends, which the
 * list draws correctly and a second run finishes. Deleting first would leave
 * sends naming a container nobody can read, which is the state that loses
 * them from the table.
 *
 * ## What a site hub may delete
 *
 * A campaign placed on this site and on no other — the one a site hub
 * creates. A campaign that is not placed here is not this site's to see, so
 * it answers 404 as a missing one would. A campaign also placed on other
 * sites is refused unless the caller is an org-wide member: deleting it
 * takes it off those sites too, which is the same reach change the rules
 * reserve for org-wide members when a campaign is edited.
 */
async function deleteCampaign(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  campaignId: string,
  access: DeleteAccess,
): Promise<ManageResult> {
  const ref = orgEmailCampaigns(firestore, orgId).doc(campaignId)
  const snapshot = await ref.get()
  /*
   * A 404 rather than a silent success. The id in a campaign URL may name a
   * container OR a single send — that ambiguity is what keeps every link
   * minted before containers existed resolving — so "no container here" is
   * very often "this is a send", and answering it as a completed deletion
   * would tell the console it had removed something it never touched.
   */
  const placement = {
    visibleTo: snapshot.exists
      ? (snapshot.get('visibleTo') as string[] | undefined)
      : undefined,
  }
  if (
    !snapshot.exists ||
    (access.hostId && !campaignPlacedOnHost(placement, access.hostId))
  ) {
    return { status: 404, body: { error: 'Unknown campaign' } }
  }
  if (access.hostId) {
    const sites = campaignSiteIds(placement)
    const onlyHere = sites !== null && sites.every((id) => id === access.hostId)
    if (!onlyHere) {
      const membership = await resolveOrgMembership(access.uid, orgId)
      if (!isOrgWideMember(membership?.member)) {
        return {
          status: 403,
          body: {
            error:
              'This campaign is on other sites too, so deleting it would take ' +
              'it off them as well. An organization admin can delete it from ' +
              'the organization’s campaigns.',
          },
        }
      }
    }
  }
  const { detached, remaining } = await detachSends(firestore, orgId, campaignId)
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
  const members = await detachMembers(firestore, orgId, campaignId)
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
 *
 * `hostId` is the site hub the request came from, and a draft sent as a
 * different site is refused as unknown; from the organization hub it is
 * `''` and any site's draft may be discarded.
 */
async function discardDraft(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  emailId: string,
  hostId: string,
): Promise<ManageResult> {
  const ref = orgCampaignSends(firestore, orgId).doc(emailId)
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
      if (!fresh.exists || (hostId && !sendIsOnHost(fresh, hostId))) {
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
 * the name the person gave it made unique among its site's messages.
 *
 * The copy is sent as the same site as its source: the sender, the design
 * and the consent it would mail under are all that site's. From a site hub
 * that is the requesting site, and a source sent as another site is refused
 * as unknown; from the organization hub (`hostId` `''`) it is whichever site
 * the source records, and a source that records none cannot be copied,
 * because the copy would be an email that can never be sent.
 */
async function duplicateMessage(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  hostId: string,
  emailId: string,
  requestedName: string,
  actor: { uid: string; email: string | null },
): Promise<ManageResult> {
  const messages = orgCampaignSends(firestore, orgId)
  const id = createResourceUid()
  /*
   * The source is read once outside the transaction to learn its site, which
   * decides which siblings the name must be unique among; the transaction
   * reads it again, so a source changed in between is copied as it stands.
   */
  const peek = await messages.doc(emailId).get()
  if (!peek.exists || (hostId && !sendIsOnHost(peek, hostId))) {
    return { status: 404, body: { error: 'Unknown email' } }
  }
  const siteId = hostId || sendHostId(peek)
  if (!siteId) {
    return {
      status: 409,
      body: {
        error:
          'This email does not record which site it is sent from, so it ' +
          'cannot be copied from here. Open it from its site instead.',
      },
    }
  }
  const outcome = await firestore.runTransaction(
    async (transaction): Promise<ManageResult & { name?: string; sourceName?: string }> => {
      const [source, siblings] = await Promise.all([
        transaction.get(messages.doc(emailId)),
        transaction.get(
          messages
            .select('displayName', 'subject')
            .where(CAMPAIGN_SEND_HOST_FIELD, '==', siteId),
        ),
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
        ...campaignSendSiteStamp(siteId),
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
        orgId,
        hostId: siteId,
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
 *  - the CONTAINER at `orgs/{orgId}/emailCampaigns/{id}`, written as a site
 *    hub's create drawer writes one: aimed at no list, placed on the site
 *    the draft was asked for;
 *  - ONE EMAIL inside it at `orgs/{orgId}/campaigns/{id}-email`,
 *    `status: 'draft'`, sent as that site, naming the email design it sends
 *    and holding its subject, preheader and the alternatives to them.
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
  CAMPAIGN_SEND_HOST_FIELD,
  'visibleTo',
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
  /** The site's organization, or null; specs hand in a double. */
  resolveOrgId?: (hostId: string) => Promise<string | null>
}

export function createCampaignDraftWriter(
  deps: CampaignDraftWriterDeps = {},
): PluginResourceDraftWriter {
  const firestore =
    deps.firestore ??
    (() => firebaseAdmin.app().firestore() as unknown as FirebaseFirestore.Firestore)
  /*
   * The org is resolved from the SITE rather than taken from the request's
   * context: the site is what the role check reads, so the campaign lands in
   * the organization that site belongs to and no other.
   */
  const resolveOrgId = deps.resolveOrgId ?? resolveOrgIdForHost
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
      const orgId = await resolveOrgId(hostId)
      if (!orgId) return null
      const campaign = await orgEmailCampaigns(firestore(), orgId).doc(id).get()
      return campaign.exists &&
        campaignPlacedOnHost(
          { visibleTo: campaign.get('visibleTo') as string[] | undefined },
          hostId,
        )
        ? campaignDraftRecord(campaign)
        : null
    },

    write: async (request): Promise<PluginDraftWrite> => {
      const read = readCampaignDraftContent(request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      if (!isDocumentId(request.id)) return { ok: false, status: 400, error: 'Invalid campaignId' }
      const db = firestore()
      const orgId = await resolveOrgId(request.hostId)
      if (!orgId) {
        return { ok: false, status: 409, error: 'This site is not part of an organization' }
      }
      const hostRef = db.collection('hosts').doc(request.hostId)
      const campaignRef = orgEmailCampaigns(db, orgId).doc(request.id)
      const emailId = campaignDraftEmailId(request.id)
      const emailRef = orgCampaignSends(db, orgId).doc(emailId)
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
          /*
           * A replay answers only for a campaign this site can see: the id
           * space is the organization's, and one placed on a sibling site is
           * not this request's to report or to write over.
           */
          if (
            !campaignPlacedOnHost(
              { visibleTo: campaign.get('visibleTo') as string[] | undefined },
              request.hostId,
            )
          ) {
            return { ok: false, status: 409, error: 'That campaign already exists' }
          }
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
        // A site hub's create drawer's own document: a name, no dates, no
        // lists, placed on the site it was drafted for.
        transaction.create(campaignRef, {
          name,
          listIds: [],
          visibleTo: campaignVisibleTo([request.hostId]),
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
          ...campaignSendSiteStamp(request.hostId),
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

/**
 * Registers the writer; the console surface calls it, since only the console
 * runs AI jobs (AGL-3026). Idempotent: a second call replaces the first.
 */
export function registerCampaignDraftWriter(): void {
  registerPluginResourceDraftWriter(CAMPAIGN_DRAFT_RESOURCE, campaignDraftWriter, {
    pluginId: MARKETING_PLUGIN_ID,
  })
}

/** The org roles that may manage campaigns from the organization hub. */
const ORG_MANAGE_ROLES = ['owner', 'admin', 'editor'] as const

/**
 * The organization a `campaigns/manage` request from the organization hub is
 * for, read off its JSON body, so the dispatcher's release gate asks about the
 * right organization. Only consulted for a request that names no site.
 * Unverified, exactly as a `hostId` is: the handler refuses anyone who is not
 * an org-wide member of it.
 */
export async function campaignManageSubject(
  request: Request,
): Promise<PluginApiRequestSubject | null> {
  if (request.method !== 'POST') return null
  const body = (await request.json().catch(() => null)) as { orgId?: unknown } | null
  const orgId = typeof body?.orgId === 'string' ? body.orgId : ''
  return isDocumentId(orgId) ? { orgId } : null
}

/**
 * Campaign management API: removing a campaign, discarding a draft, and
 * copying an email.
 *
 * Separate from `campaigns/send` because nothing here sends, reserves
 * allowance or moves a meter, and because the removals are about a record
 * ceasing to exist — which is the one class of change that has to be read
 * against what a merchant has already mailed.
 *
 * Reached through two doors — see the header. A site request carries
 * `hostId` and is authorized by the caller's admin or editor role on that
 * site; an organization request carries `orgId` and no `hostId`, and is
 * authorized by an org-wide membership as owner, admin or editor.
 *
 * Editing a campaign is deliberately NOT here. The container is client-
 * writable, its create already runs on the client SDK, and a second door to
 * the same document would be a second place for the two to disagree about
 * what a campaign may hold.
 */
export const campaignManageHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const requestedOrgId = String(req.body?.orgId ?? '')
  const action = String(req.body?.action ?? '')
  const targetId = String(req.body?.campaignId ?? '')
  if (!hostId && !requestedOrgId) {
    return res.status(400).json({ error: 'Missing hostId' })
  }
  if (hostId && !isDocumentId(hostId)) {
    return res.status(400).json({ error: 'Invalid hostId' })
  }
  if (requestedOrgId && !isDocumentId(requestedOrgId)) {
    return res.status(400).json({ error: 'Invalid orgId' })
  }
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
    let orgId: string
    if (hostId) {
      const hostRef = firestore.collection('hosts').doc(hostId)
      const hostSnapshot = await hostRef.get()
      if (!hostSnapshot.exists) {
        return res.status(404).json({ error: 'Unknown site' })
      }
      const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
      if (memberRole !== 'admin' && memberRole !== 'editor') {
        return res.status(403).json({ error: 'Not a site admin or editor' })
      }
      orgId = (await resolveOrgIdForHost(hostId)) ?? ''
      if (!orgId) {
        return res.status(409).json({
          error: 'This site is not part of an organization, so it holds no campaigns.',
        })
      }
      /*
       * A request naming both is answered for the site, and only when the
       * two agree: an org id the site does not belong to is a confused
       * caller, and acting on the site's own org instead would be a guess.
       */
      if (requestedOrgId && requestedOrgId !== orgId) {
        return res.status(400).json({ error: 'That site is not in this organization' })
      }
    } else {
      const membership = await resolveOrgMembership(decoded.uid, requestedOrgId)
      const member = membership?.member as Partial<AglynOrgMember> | undefined
      if (
        !member ||
        !isOrgWideMember(member) ||
        !(ORG_MANAGE_ROLES as readonly string[]).includes(String(member.role ?? ''))
      ) {
        return res
          .status(403)
          .json({ error: 'Not an organization owner, admin or editor' })
      }
      /*
       * The site door is refused by the dispatcher when Marketing is off for
       * the site; a request naming no site reaches here past only the release
       * gate, so the organization's own switch is asked here.
       */
      if (!isPluginEnabled(await getOrgDoc(requestedOrgId), MARKETING_PLUGIN_ID)) {
        return res.status(404).json({ error: 'Not found' })
      }
      orgId = requestedOrgId
    }

    if (action === 'duplicate') {
      // One attempt key, one copy (AGL-2936): a double click on Duplicate
      // replays the first answer rather than drafting the message twice.
      const attemptKey = String(req.body?.attemptKey ?? '').trim().slice(0, 200)
      const claimed = attemptKey
        ? await claimAttempt(firestore as never, {
            kind: 'duplicate-campaign',
            scopeId: `${hostId || `org:${orgId}`}:${targetId}`,
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
        firestore,
        orgId,
        hostId,
        targetId,
        String(req.body?.name ?? ''),
        { uid: decoded.uid, email: decoded.email ?? null },
      )
      if (copied.status === 200) await claim?.record(copied.status, copied.body)
      else await claim?.release()
      return res.status(copied.status).json(copied.body)
    }
    const result =
      action === 'deleteCampaign'
        ? await deleteCampaign(firestore, orgId, targetId, {
            hostId,
            uid: decoded.uid,
          })
        : await discardDraft(firestore, orgId, targetId, hostId)
    return res.status(result.status).json(result.body)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'The request could not be completed' })
  }
}

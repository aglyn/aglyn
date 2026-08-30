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
 * `/emails/campaigns/{sendId}` is a URL merchants paste into their own
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
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { CAMPAIGN_SEND_CONTAINER_FIELD } from '@aglyn/plugins-email/model'

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
 * Removes a campaign container, leaving its emails standing.
 *
 * Detach first, delete second, and the order is the point: stopping between
 * them leaves a container whose emails are already single sends, which the
 * list draws correctly and a second run finishes. Deleting first would leave
 * sends naming a container nobody can read, which is the state that loses
 * them from the table.
 */
async function deleteCampaign(
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
  await ref.delete()
  return { status: 200, body: { campaignId, detached, deleted: true } }
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
  if (action !== 'deleteCampaign' && action !== 'discardEmail') {
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

    const result =
      action === 'deleteCampaign'
        ? await deleteCampaign(hostRef, targetId)
        : await discardDraft(hostRef, targetId)
    return res.status(result.status).json(result.body)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'The request could not be completed' })
  }
}

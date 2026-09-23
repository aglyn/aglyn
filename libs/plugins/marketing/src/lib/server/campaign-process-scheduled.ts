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

import { writeCronBeat, type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  CampaignSendDeferredError,
  CampaignSendError,
  performCampaignSend,
  type CampaignSendResult,
} from './campaign-send'

/** The most sends one run delivers. */
const PROCESS_BATCH = 10

/**
 * How many due sends one run reads to find {@link PROCESS_BATCH} it may
 * deliver.
 *
 * Wider than the batch because the collection-group query cannot be narrowed
 * to one parent without a composite index, and it also returns sends still
 * at the site path that are waiting for the migration (see
 * {@link scheduledSendSite}). Those are skipped, so without the margin ten
 * of them would crowd every organization's sends out of every run until the
 * migration reached them.
 */
const PROCESS_READ = 30

/**
 * Which site a due send is sent as, or why it is not this run's to send.
 *
 * `collectionGroup('campaigns')` matches every collection of that name, so
 * the answer depends on where the document is:
 *
 * - `orgs/{orgId}/campaigns/{id}` — a send, whose site is its own
 *   `hostId` field. One that records none cannot be delivered, because the
 *   sender, the consent group and the unsubscribe signature are all the
 *   site's; it is skipped and logged rather than guessed at.
 * - `hosts/{hostId}/campaigns/{id}` — a send the migration has not moved
 *   yet. NOT delivered and NOT claimed: the send core records every send
 *   under the org, so delivering this one would split it across two
 *   documents, the counters on one and the copy on the other. It stays
 *   `scheduled`, and the migration moves it with its site stamped, after
 *   which the next run delivers it.
 * - anything else — some other collection named `campaigns`, never ours.
 */
export function scheduledSendSite(
  ref: { path: string },
  data: Record<string, unknown>,
):
  | { kind: 'send'; hostId: string }
  | { kind: 'legacy' }
  | { kind: 'unsited' }
  | { kind: 'foreign' } {
  const segments = String(ref?.path ?? '').split('/')
  const ownerCollection = segments.length === 4 ? segments[0] : ''
  if (ownerCollection === 'orgs') {
    const hostId = data['hostId']
    return typeof hostId === 'string' && hostId && !hostId.includes('/')
      ? { kind: 'send', hostId }
      : { kind: 'unsited' }
  }
  if (ownerCollection === 'hosts') return { kind: 'legacy' }
  return { kind: 'foreign' }
}

/**
 * Scheduled-campaign processor (AGL-272): scheduler-invoked (Cloud
 * Scheduler / cron, x-cron-secret like report-usage), it claims due
 * `status: 'scheduled'` sends across every organization and delivers them
 * through the shared send core. A transaction flips scheduled → sending
 * so overlapping runs never double-send; failures mark the send
 * `failed` with the reason instead of retrying forever.
 */
export const campaignProcessScheduledHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res
      .status(501)
      .json({ error: 'Scheduling is not configured (CRON_SECRET).' })
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthenticated' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    // AGL-1955 — the mark `/api/health/crons` reads to notice this job going
    // AWAY. This is the one route in the set that has already been sold,
    // wired and completely inert once (AGL-2134): the composer wrote
    // `status: 'scheduled'` and nothing ever POSTed here, so a customer's
    // campaign sat in the collection until somebody cancelled it. Nothing
    // downstream ages when this stops — a fortnight with no due campaign
    // produces exactly the same silence as a deleted schedule — so the
    // invocation itself is the only honest thing to watch.
    await writeCronBeat(firestore, 'campaigns-process-scheduled')
    const due = await firestore
      .collectionGroup('campaigns')
      .where('status', '==', 'scheduled')
      .where('sendAtMs', '<=', Date.now())
      .limit(PROCESS_READ)
      .get()

    const results: Array<Record<string, unknown> | CampaignSendResult> = []
    /** Due sends still at a site path, left for the migration. */
    let awaitingMigration = 0
    /** Due org sends that name no site, and so cannot be sent. */
    let unsited = 0
    let attempted = 0
    for (const campaignDoc of due.docs) {
      if (attempted >= PROCESS_BATCH) break
      const site = scheduledSendSite(
        campaignDoc.ref,
        (campaignDoc.data() ?? {}) as Record<string, unknown>,
      )
      if (site.kind === 'legacy') {
        awaitingMigration += 1
        continue
      }
      if (site.kind === 'unsited') {
        unsited += 1
        console.error(
          `[campaigns] scheduled send ${campaignDoc.ref.path} names no site and was not sent`,
        )
        continue
      }
      if (site.kind !== 'send') continue
      attempted += 1
      const claimed = await firestore.runTransaction(async (transaction) => {
        const fresh = await transaction.get(campaignDoc.ref)
        if (fresh.get('status') !== 'scheduled') return false
        transaction.update(campaignDoc.ref, { status: 'sending' })
        return true
      })
      if (!claimed) continue
      const data = campaignDoc.data()
      /*
       * IS THIS A CAMPAIGN, OR THE REST OF ONE?
       *
       * An audience larger than one send may carry goes out over several
       * runs. Each batch writes the email back as `scheduled` with a `resume`
       * map, so this query picks it up again — the same claim, the same
       * transaction, the same send core. The presence of a batch count is
       * what tells the two apart, and it is read off the record rather than
       * passed in because there is nobody to pass it: a merchant pressed Send
       * once, possibly hours ago.
       *
       * It matters more than a label. A continuation subtracts everyone the
       * email has already SETTLED and leaves the audience figures the first
       * batch recorded alone; a first send does neither. Getting this wrong
       * in the false direction mails people a second copy.
       */
      const resumingBatch =
        Math.max(0, Math.floor(Number(data['resume']?.batch ?? 0)) || 0) > 0
      try {
        const result = await performCampaignSend({
          hostId: site.hostId,
          ...(resumingBatch ? { continuation: true } : {}),
          subject: String(data['subject'] ?? ''),
          body: String(data['body'] ?? ''),
          audience: String(data['audience'] ?? 'leads'),
          segmentId: String(data['segmentId'] ?? ''),
          listId: String(data['listId'] ?? ''),
          // A scheduled campaign carries the topic it was composed under, not
          // whatever the default is on the day the cron picks it up: the
          // unsubscribe links it mints have to name the stream the author
          // chose. Absent on every campaign scheduled before topics existed,
          // which `performCampaignSend` resolves to the default.
          topicId: String(data['topicId'] ?? '') || undefined,
          emails: Array.isArray(data['emails'])
            ? data['emails'].map(String)
            : undefined,
          campaignId: campaignDoc.id,
          experimentId: String(data['experimentId'] ?? ''),
          templateScreenId: String(data['templateScreenId'] ?? '') || undefined,
          /*
           * The plain-text part the author wrote, read back with the design.
           * Regenerating one from the design at cron time would mail a text
           * half the merchant never reviewed — and a different one from what
           * the composer previewed and the test send delivered.
           */
          plainText: String(data['plainText'] ?? '') || undefined,
          // The sender fields the composer chose. Read back rather than
          // resolved fresh: a scheduled campaign must go out as the message
          // that was composed, not as whatever the org's branding says an hour
          // later.
          fromName: String(data['fromName'] ?? ''),
          replyTo: String(data['replyTo'] ?? ''),
          preheader: String(data['preheader'] ?? ''),
          emailCampaignId: String(data['emailCampaignId'] ?? ''),
          /*
           * Whoever sent it, and `scheduledBy` is not that person on a
           * campaign a merchant sent by hand — an immediate send that batches
           * has no `scheduledBy` at all. `sentBy` is what the first batch
           * recorded, so the later ones are attributed to the same person
           * rather than to the cron.
           */
          senderUid: String(
            data['scheduledBy'] ?? data['sentBy'] ?? 'scheduler',
          ),
        })
        results.push(result)
      } catch (error) {
        /*
         * DEFERRED IS NOT FAILED (AGL-2409).
         *
         * The platform send-rate governor had no room for this campaign in
         * the current hour and NOTHING WAS SENT — the admission check runs
         * before the first message and before any counter moves, which is
         * what makes this safe to retry. So the claim is released by putting
         * the row back to `scheduled`, and the next 15-minute run picks it up.
         *
         * Marking it `failed` here — which is the right answer for every
         * other `CampaignSendError`, an empty audience or a stopped
         * experiment — would turn a ramp into a lost campaign that the
         * merchant has to notice in the History list and re-create by hand.
         * That is the failure mode the ceiling exists to avoid making worse.
         */
        if (error instanceof CampaignSendDeferredError) {
          await campaignDoc.ref
            .set(
              {
                status: 'scheduled',
                deferredReason: error.message,
                deferredUntilMs: error.retryAtMs,
                /*
                 * Due when the window that deferred it rolls, rather than
                 * immediately. Without this the row stays due and every
                 * fifteen-minute run re-resolves an audience of up to five
                 * thousand documents to be told the same no — which for a
                 * workspace ramped to a day is ninety-six pointless
                 * resolutions of somebody's whole contact list.
                 */
                sendAtMs: error.retryAtMs,
              },
              { merge: true },
            )
            .catch(() => undefined)
          results.push({
            campaignId: campaignDoc.id,
            deferred: true,
            retryAtMs: error.retryAtMs,
          })
          continue
        }
        const message =
          error instanceof CampaignSendError
            ? error.message
            : 'Campaign send failed'
        if (!(error instanceof CampaignSendError)) console.error(error)
        await campaignDoc.ref
          .set(
            {
              status: 'failed',
              error: message,
              failedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
          .catch(() => undefined)
        results.push({ campaignId: campaignDoc.id, error: message })
      }
    }
    if (awaitingMigration) {
      console.warn(
        `[campaigns] ${awaitingMigration} due send(s) are still at a site path and wait for the migration`,
      )
    }
    return res.status(200).json({
      processed: results.length,
      results,
      ...(awaitingMigration ? { awaitingMigration } : {}),
      ...(unsited ? { unsited } : {}),
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Processing failed' })
  }
}

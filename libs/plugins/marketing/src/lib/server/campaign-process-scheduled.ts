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

/**
 * Scheduled-campaign processor (AGL-272): scheduler-invoked (Cloud
 * Scheduler / cron, x-cron-secret like report-usage), it claims due
 * `status: 'scheduled'` campaigns across every host and delivers them
 * through the shared send core. A transaction flips scheduled → sending
 * so overlapping runs never double-send; failures mark the campaign
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
      .limit(10)
      .get()

    const results: Array<Record<string, unknown> | CampaignSendResult> = []
    for (const campaignDoc of due.docs) {
      const hostRef = campaignDoc.ref.parent.parent
      if (!hostRef) continue
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
          hostId: hostRef.id,
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
    return res.status(200).json({ processed: results.length, results })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Processing failed' })
  }
}

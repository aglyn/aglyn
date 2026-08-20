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

    const results: Array<Record<string, unknown>> = []
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
      try {
        const result = await performCampaignSend({
          hostId: hostRef.id,
          subject: String(data['subject'] ?? ''),
          body: String(data['body'] ?? ''),
          audience: String(data['audience'] ?? 'leads'),
          segmentId: String(data['segmentId'] ?? ''),
          listId: String(data['listId'] ?? ''),
          emails: Array.isArray(data['emails'])
            ? data['emails'].map(String)
            : undefined,
          campaignId: campaignDoc.id,
          experimentId: String(data['experimentId'] ?? ''),
          templateScreenId: String(data['templateScreenId'] ?? '') || undefined,
          senderUid: String(data['scheduledBy'] ?? 'scheduler'),
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

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

import { checkEntitlement } from '@aglyn/aglyn/server'
import { evaluateAutoWinner, type HostExperiment } from './model'
import {
  registerPluginApiRoute,
  registerSitePageEnricher,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { emailEventsHandler } from './server/email-events'
import { marketingSitePageEnricher } from './server/site-page-enricher'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { campaignProcessScheduledHandler } from './server/campaign-process-scheduled'
import { listsMaterializeHandler } from './server/lists-materialize'
import { campaignSendHandler } from './server/campaign-send'
import { campaignRecipientsHandler } from './server/campaign-recipients'

/**
 * Experiment beacon (AGL-252): counts an exposure or conversion on
 * `hosts/{hostId}/experiments/{id}/stats/{variantId}`. Sampled counters —
 * fire-and-forget from the page, abTesting-gated, no visitor identity
 * stored server-side (assignment is deterministic client-side).
 */
const trackHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const experimentId = String(req.body?.experimentId ?? '')
  const variantId = String(req.body?.variantId ?? '')
  const kind = String(req.body?.kind ?? '')
  if (
    !hostId ||
    !experimentId ||
    !variantId ||
    !['exposure', 'conversion'].includes(kind)
  ) {
    return res.status(400).json({ error: 'Bad beacon' })
  }
  try {
    const org = (await getOrgForHost(hostId))?.org
    if (!checkEntitlement(org as any, 'abTesting')) {
      return res.status(200).json({ ok: true })
    }
    const experimentRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('experiments')
      .doc(experimentId)
    const experiment = await experimentRef.get()
    if (!experiment.exists || experiment.get('status') !== 'running') {
      return res.status(200).json({ ok: true })
    }
    // Ended experiments (AGL-273) stop counting: stale cached pages may
    // still beacon briefly, and post-end stats would skew the decision.
    const endAtMs = Number(experiment.get('endAtMs') ?? 0)
    if (endAtMs && Date.now() > endAtMs) {
      return res.status(200).json({ ok: true })
    }
    await experimentRef
      .collection('stats')
      .doc(variantId)
      .set(
        {
          [kind === 'exposure' ? 'exposures' : 'conversions']:
            FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    // Auto-winner (AGL-273): conversions re-evaluate the opt-in decision
    // rule; a decided experiment finishes itself and serves the winner.
    const data = experiment.data() as HostExperiment
    if (kind === 'conversion' && data.autoWinner) {
      const statsSnapshot = await experimentRef.collection('stats').get()
      const statsByVariant: Record<
        string,
        { exposures?: number; conversions?: number }
      > = {}
      for (const doc of statsSnapshot.docs) {
        statsByVariant[doc.id] = {
          exposures: Number(doc.get('exposures') ?? 0),
          conversions: Number(doc.get('conversions') ?? 0),
        }
      }
      const decision = evaluateAutoWinner(data, statsByVariant)
      if (decision) {
        await experimentRef.update({
          status: 'done',
          winnerVariantId: decision.variantId,
          autoCompleted: true,
          completedAt: FieldValue.serverTimestamp(),
        })
      }
    }
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(200).json({ ok: true }) // beacons never error the page
  }
}

/** Registers the marketing plugin's public (site-facing) API routes (AGL-396). */
export function registerMarketingApi(): void {
  registerPluginApiRoute('experiments/track', trackHandler)
  // Site-page contributions (AGL-418): overlays, automations, experiments.
  registerSitePageEnricher(marketingSitePageEnricher)
}

/** Registers the marketing plugin's console-side API routes (AGL-396). */
export function registerMarketingConsoleApi(): void {
  registerPluginApiRoute('campaigns/send', campaignSendHandler)
  // The other direction through the per-recipient delivery log: not "what did
  // we send this person" but "who did this design reach, and which of them
  // opened it". Server-side because the log is a platform-level collection no
  // security rule can scope to one site's campaigns.
  registerPluginApiRoute('campaigns/recipients', campaignRecipientsHandler)
  // Relocated console route (AGL-418): the Resend/Svix webhook keeps its
  // /api/email/events URL via the dispatcher; ownership is recorded at
  // registration so the org gate attributes it to marketing, not email.
  registerPluginApiRoute('email/events', emailEventsHandler)
  registerPluginApiRoute(
    'campaigns/process-scheduled',
    campaignProcessScheduledHandler,
  )
  // The dynamic-list sweep rides the same `*/15` fast-cron as the campaign
  // processor rather than provisioning a scheduler job of its own.
  registerPluginApiRoute('lists/materialize', listsMaterializeHandler)
}

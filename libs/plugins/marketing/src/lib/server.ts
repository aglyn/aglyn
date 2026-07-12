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
  checkEntitlement,
  evaluateAutoWinner,
  type HostExperiment,
} from '@aglyn/aglyn/server'
import { registerPluginApiRoute, type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { campaignProcessScheduledHandler } from './server/campaign-process-scheduled'
import { campaignSendHandler } from './server/campaign-send'

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
    const tenant = (await getOrgForHost(hostId))?.org
    if (!checkEntitlement(tenant as any, 'abTesting')) {
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
}

/** Registers the marketing plugin's console-side API routes (AGL-396). */
export function registerMarketingConsoleApi(): void {
  registerPluginApiRoute('campaigns/send', campaignSendHandler)
  registerPluginApiRoute(
    'campaigns/process-scheduled',
    campaignProcessScheduledHandler,
  )
}

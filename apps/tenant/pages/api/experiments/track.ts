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

import { checkEntitlement } from '@aglyn/aglyn'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Experiment beacon (AGL-252): counts an exposure or conversion on
 * `hosts/{hostId}/experiments/{id}/stats/{variantId}`. Sampled counters —
 * fire-and-forget from the page, abTesting-gated, no visitor identity
 * stored server-side (assignment is deterministic client-side).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
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
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(200).json({ ok: true }) // beacons never error the page
  }
}

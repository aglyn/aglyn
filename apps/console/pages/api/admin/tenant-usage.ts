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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Per-tenant usage drill-down (AGL-205): the last 12 monthly AGL-41
 * rollups for one tenant with month-over-month deltas, powering the
 * Usage dialog on the staff tenants page. Staff-gated, read-only.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const tenantId = String(req.query.tenantId ?? '')
  if (!tenantId) return res.status(400).json({ error: 'Missing tenantId' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded['staff']) {
      return res.status(403).json({ error: 'Staff only' })
    }
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('tenants')
      .doc(tenantId)
      .collection('usageRollups')
      .orderBy('month', 'desc')
      .limit(12)
      .get()
    const months = snapshot.docs.map((doc) => ({
      month: String(doc.get('month') ?? doc.id),
      storageGb: Number(doc.get('storageGb') ?? 0),
      pageViews: Number(doc.get('pageViews') ?? 0),
      formSubmissions: Number(doc.get('formSubmissions') ?? 0),
      costUsd: Number(doc.get('costUsd') ?? 0),
    }))
    // Month-over-month delta vs the next-older row (list is desc).
    const withDeltas = months.map((row, index) => {
      const previous = months[index + 1]
      const delta = (current: number, prior?: number) =>
        prior && prior > 0 ? (current - prior) / prior : null
      return {
        ...row,
        deltas: previous
          ? {
              pageViews: delta(row.pageViews, previous.pageViews),
              costUsd: delta(row.costUsd, previous.costUsd),
            }
          : null,
      }
    })
    return res.status(200).json({ months: withDeltas })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Usage lookup failed' })
  }
}

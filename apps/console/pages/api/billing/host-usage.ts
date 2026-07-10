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

import { ESTIMATED_PAGE_TRANSFER_BYTES } from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

/** Approximate persisted size of one version doc's node payload. */
function nodesBytes(nodes: unknown): number {
  if (nodes == null) return 0
  if (ArrayBuffer.isView(nodes)) return (nodes as Uint8Array).byteLength
  try {
    return JSON.stringify(nodes).length
  } catch {
    return 0
  }
}

/**
 * Site-size and bandwidth metering for the Billing usage meters (AGL-41
 * follow-up — these rows previously showed "not yet metered"). Site size =
 * the published content: every screen/layout's published version node
 * payload (media lives under the separate storage quota by design).
 * Bandwidth = this month's analytics views × the average page transfer.
 * Admin SDK because version node payloads aren't worth streaming to the
 * client just to measure.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query['hostId'] ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

  const authorization = req.headers.authorization ?? ''
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
    if (!memberRole) {
      return res.status(403).json({ error: 'Not a site admin' })
    }

    const month = new Date().toISOString().slice(0, 7)
    const [screens, layouts, analytics] = await Promise.all([
      hostRef.collection('screens').limit(200).get(),
      hostRef.collection('layouts').limit(50).get(),
      hostRef
        .collection('analytics')
        .where(
          firebaseAdmin.firestore.FieldPath.documentId(),
          '>=',
          `${month}-01`,
        )
        .where(
          firebaseAdmin.firestore.FieldPath.documentId(),
          '<=',
          `${month}-31`,
        )
        .get(),
    ])

    // Published version payloads only — drafts don't count against the
    // published-site-size quota.
    const versionRefs: FirebaseFirestore.DocumentReference[] = []
    for (const docSnapshot of [...screens.docs, ...layouts.docs]) {
      const versionId = docSnapshot.get('versionId')
      if (versionId) {
        versionRefs.push(
          docSnapshot.ref.collection('versions').doc(String(versionId)),
        )
      }
    }
    let siteSizeBytes = 0
    if (versionRefs.length) {
      const versions = await firestore.getAll(...versionRefs)
      for (const version of versions) {
        siteSizeBytes += nodesBytes(version.get('nodes'))
      }
    }

    const monthPageViews = analytics.docs.reduce(
      (sum, day) => sum + Number(day.get('total') ?? 0),
      0,
    )
    return res.status(200).json({
      siteSizeBytes,
      monthPageViews,
      bandwidthBytes: monthPageViews * ESTIMATED_PAGE_TRANSFER_BYTES,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Usage lookup failed' })
  }
}

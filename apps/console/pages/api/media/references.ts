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

export interface MediaReference {
  kind: 'screen' | 'layout'
  id: string
  name: string
}

/**
 * Per-asset usage scan (AGL-176): finds published screens/layouts whose
 * live version nodes reference the asset's URL in any of its forms (raw
 * storage URL or the AGL-175 CDN path). Computed on demand — a reverse
 * index maintained at publish time stays open as a later optimization;
 * at current host sizes a scan of live versions is a few dozen reads.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const mediaId = String(req.body?.mediaId ?? '')
  if (!hostId || !mediaId) {
    return res.status(400).json({ error: 'Missing hostId or mediaId' })
  }
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

    const mediaSnapshot = await hostRef
      .collection('media')
      .doc(mediaId)
      .get()
    if (!mediaSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown media' })
    }
    const needles = [
      mediaSnapshot.get('url'),
      mediaSnapshot.get('cdnPath'),
      // Any URL containing the storage object path also counts.
      `hosts/${hostId}/media/${mediaId}`,
    ].filter(Boolean) as string[]

    const references: MediaReference[] = []
    for (const kind of ['screens', 'layouts'] as const) {
      const parents = await hostRef.collection(kind).get()
      await Promise.all(
        parents.docs.map(async (parent) => {
          if (parent.get('deletedAt')) return
          const versionId = parent.get('versionId')
          if (!versionId) return
          const version = await parent.ref
            .collection('versions')
            .doc(String(versionId))
            .get()
          if (!version.exists) return
          const haystack = JSON.stringify(version.get('nodes') ?? {})
          if (needles.some((needle) => haystack.includes(needle))) {
            references.push({
              kind: kind === 'screens' ? 'screen' : 'layout',
              id: parent.id,
              name: String(parent.get('name') ?? parent.id),
            })
          }
        }),
      )
    }

    return res.status(200).json({ references })
  } catch (error) {
    console.error('media references scan failed', hostId, mediaId, error)
    return res.status(500).json({ error: 'Scan failed' })
  }
}

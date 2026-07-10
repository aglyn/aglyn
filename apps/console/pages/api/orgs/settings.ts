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

import { canManageOrg } from '@aglyn/aglyn'
import {
  firebaseAdmin,
  listOrgMembers,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Org settings mutations (AGL-236). Rename goes through the API rather
 * than a client write because the name is denormalized onto every
 * member's `users/{uid}/orgs` reverse-index entry — the switcher and
 * breadcrumbs read it from there.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const orgId = String(req.body?.orgId ?? '')
  if (!orgId) return res.status(400).json({ error: 'Missing orgId' })

  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (
      decoded['staff'] !== true &&
      !canManageOrg(membership?.member.role)
    ) {
      return res
        .status(403)
        .json({ error: 'Org settings require the admin role' })
    }

    if (req.body?.action === 'rename') {
      const name = String(req.body?.name ?? '')
        .trim()
        .slice(0, 80)
      if (!name) return res.status(400).json({ error: 'Missing name' })
      const firestore = firebaseAdmin.app().firestore()
      await firestore
        .collection('orgs')
        .doc(orgId)
        .set(
          {
            name,
            updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      const members = await listOrgMembers(orgId)
      const batch = firestore.batch()
      for (const member of members) {
        batch.set(
          firestore
            .collection('users')
            .doc(member.$id)
            .collection('orgs')
            .doc(orgId),
          { orgName: name },
          { merge: true },
        )
      }
      await batch.commit()
      return res.status(200).json({ ok: true, name })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Org settings operation failed' })
  }
}

/**
 * @license
 * Copyright 2022 Aglyn LLC
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
 * Staff user listing (AGL-204). Replaces the pre-AGL-42 handler that
 * listed every account WITHOUT a staff check — this one requires the
 * `staff` claim like the other admin APIs and returns trimmed records
 * only (no provider tokens, no raw claim payloads).
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

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded['staff']) {
      return res.status(403).json({ error: 'Staff only' })
    }
    const pageToken =
      typeof req.query.nextPageToken === 'string'
        ? req.query.nextPageToken
        : undefined
    const page = await firebaseAdmin.app().auth().listUsers(200, pageToken)
    return res.status(200).json({
      users: page.users.map((record) => ({
        uid: record.uid,
        email: record.email ?? null,
        displayName: record.displayName ?? null,
        disabled: record.disabled,
        staff: Boolean(record.customClaims?.['staff']),
        staffRole: record.customClaims?.['staffRole'] ?? null,
        createdAt: record.metadata.creationTime ?? null,
        lastSignInAt: record.metadata.lastSignInTime ?? null,
        providers: record.providerData.map((provider) => provider.providerId),
      })),
      nextPageToken: page.pageToken ?? null,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Listing failed' })
  }
}

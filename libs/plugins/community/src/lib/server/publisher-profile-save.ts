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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { isValidPublisherHandle } from '../model/community'
import {
  canActAsPublisher,
  claimPublisherHandle,
  PublisherHandleTakenError,
  PUBLISHER_PROFILES,
} from './publisher-profile'

/**
 * Save an org's publisher profile (AGL-652).
 *
 * The handle has to be claimed transactionally, and a client can't do that —
 * a read-then-write uniqueness check lets two orgs racing for the same handle
 * both succeed, and the loser silently loses its marketplace URL. So the
 * handle is server-owned here, exactly like the host subdomain (AGL-642), and
 * the rules freeze it against client writes.
 *
 * Manager-only: the profile is the org's public identity and its payout
 * anchor, so it follows the same gate as the profile rules.
 */
export const publisherProfileSaveHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const orgId = String(req.body?.orgId ?? '')
  const handle = String(req.body?.handle ?? '').trim().toLowerCase()
  const displayName = String(req.body?.displayName ?? '').trim().slice(0, 80)
  if (!orgId) return res.status(400).json({ error: 'Missing orgId' })
  if (!displayName) {
    return res.status(400).json({ error: 'A display name is required' })
  }
  if (!isValidPublisherHandle(handle)) {
    return res.status(400).json({
      error:
        'Handles are 3–30 characters: lowercase letters, numbers and ' +
        'hyphens, starting and ending alphanumeric.',
    })
  }

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    if (!(await canActAsPublisher(firestore, decoded.uid, orgId))) {
      return res.status(403).json({
        error: 'Only an organization owner or admin can edit the publisher profile',
      })
    }

    const ref = firestore.collection(PUBLISHER_PROFILES).doc(orgId)
    const previousHandle = (await ref.get()).get('handle') as string | undefined

    // Claim first: if the handle is taken there must be no profile write, or
    // the org would show a handle it doesn't actually hold.
    try {
      await claimPublisherHandle(firestore, orgId, handle, previousHandle)
    } catch (error) {
      if (error instanceof PublisherHandleTakenError) {
        return res.status(409).json({ error: 'That handle is already taken' })
      }
      throw error
    }

    const bio = String(req.body?.bio ?? '').trim().slice(0, 500)
    const website = String(req.body?.website ?? '').trim().slice(0, 200)
    const avatarUrl = String(req.body?.avatarUrl ?? '').trim().slice(0, 500)
    await ref.set(
      {
        handle,
        displayName,
        ...(bio ? { bio } : {}),
        ...(website ? { website } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return res.status(200).json({ ok: true, handle })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Could not save the profile' })
  }
}

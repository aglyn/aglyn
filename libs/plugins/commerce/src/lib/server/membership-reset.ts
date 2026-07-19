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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  hashMemberPassword,
  passwordResetTokenMemberId,
  verifyPasswordResetToken,
} from './membership'

/**
 * Password reset completion (AGL-552): verifies the recover token
 * (signature + expiry + binding to the member's CURRENT password hash —
 * so a completed reset invalidates every outstanding token) and writes the
 * new scrypt hash. No session is minted here; the client signs in through
 * the normal login route with the new password. Token guessing is a
 * non-issue (256-bit HMAC), so no extra damper beyond login's.
 */
export const membershipResetHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const token = String(req.body?.token ?? '')
  const password = String(req.body?.password ?? '')
  if (!hostId || !token) {
    return res.status(400).json({ error: 'Invalid request' })
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: 'Password must be at least 8 characters' })
  }
  const invalid = () =>
    res.status(400).json({
      error: 'That reset link is invalid or has expired — request a new one.',
    })
  // Structural pre-check only (host + expiry); the signature binds to the
  // member's current hash, which we have to load first.
  const memberId = passwordResetTokenMemberId(hostId, token)
  if (!memberId) return invalid()
  try {
    const firestore = firebaseAdmin.app().firestore()
    const memberRef = firestore
      .collection('hosts')
      .doc(hostId)
      .collection('siteMembers')
      .doc(memberId)
    const memberDoc = await memberRef.get()
    if (!memberDoc.exists) return invalid()
    if (
      !verifyPasswordResetToken(hostId, token, memberDoc.get('passwordScrypt'))
    ) {
      return invalid()
    }
    await memberRef.set(
      {
        passwordScrypt: hashMemberPassword(password),
        passwordResetAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Reset failed' })
  }
}

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
  MEMBER_SUSPENDED_ERROR,
  hashMemberPassword,
  passwordResetTokenMemberId,
  verifyPasswordResetToken,
} from './membership'
import {
  isMemberDocumentId,
  memberCredentialRef,
  retiredCredentialFields,
  storedPasswordHash,
} from './member-credentials'

/**
 * Password reset completion (AGL-552): verifies the recover token
 * (signature + expiry + binding to the member's CURRENT password hash —
 * so a completed reset invalidates every outstanding token) and writes the
 * new scrypt hash to the member's credential document (AGL-3308). No session
 * is minted here; the client signs in through the normal login route with the
 * new password. Token guessing is a non-issue (256-bit HMAC), so no extra
 * damper beyond login's.
 *
 * ONE TRANSACTION, from the token check to the write. The hash the token is
 * checked against is the hash the write replaces, so two submissions of one
 * link cannot both land — the second re-reads the new hash and fails the
 * binding — and a member removed mid-request is not recreated as a stub.
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
  if (!memberId || !isMemberDocumentId(memberId)) return invalid()
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const memberRef = hostRef.collection('siteMembers').doc(memberId)
    const credentialRef = memberCredentialRef(hostRef, memberId)
    // Hashed once, however often the body retries, and only for a link that
    // verified: ~100 ms of CPU is not spent on a stale or forged token.
    let newHash: string | undefined
    const outcome = await firestore.runTransaction(async (tx) => {
      const [memberDoc, credentialDoc] = await tx.getAll(memberRef, credentialRef)
      if (!memberDoc.exists) return 'invalid'
      if (
        !verifyPasswordResetToken(
          hostId,
          token,
          storedPasswordHash(credentialDoc, memberDoc),
        )
      ) {
        return 'invalid'
      }
      // Suspension gate (AGL-546/550): a token minted before the
      // suspension stays cryptographically valid for its hour, so reject
      // here — recovery must not rehabilitate a suspended account. Checked
      // AFTER the signature so only the mailed-link holder (who already
      // knows the account exists) can observe the suspension.
      if (memberDoc.get('suspended') === true) return 'suspended'
      newHash ??= hashMemberPassword(password)
      tx.set(
        credentialRef,
        {
          passwordScrypt: newHash,
          passwordResetAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      tx.update(memberRef, retiredCredentialFields())
      return 'reset'
    })
    if (outcome === 'invalid') return invalid()
    if (outcome === 'suspended') {
      return res.status(403).json({ error: MEMBER_SUSPENDED_ERROR })
    }
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Reset failed' })
  }
}

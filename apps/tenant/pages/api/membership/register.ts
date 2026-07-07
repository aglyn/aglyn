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
import { runEventWorkflows } from '../../../utils/run-event-workflows'
import {
  hashMemberPassword,
  mintMemberSession,
  setMemberCookie,
} from '../../../utils/membership'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Site member sign-up (AGL-109): creates the member record (scrypt hash),
 * doubles as a lead, and signs the visitor in via the session cookie.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const email = String(req.body?.email ?? '')
    .trim()
    .toLowerCase()
  const password = String(req.body?.password ?? '')
  const displayName = String(req.body?.displayName ?? '')
    .trim()
    .slice(0, 80)
  if (!hostId) return res.status(400).json({ error: 'Missing host' })
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email' })
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: 'Password must be at least 8 characters' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const membersRef = hostRef.collection('siteMembers')
    const existing = await membersRef
      .where('email', '==', email)
      .limit(1)
      .get()
    if (!existing.empty) {
      return res.status(409).json({ error: 'That email is already a member' })
    }
    const memberRef = membersRef.doc()
    await memberRef.set({
      email,
      ...(displayName ? { displayName } : {}),
      passwordScrypt: hashMemberPassword(password),
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    // Sign-ups double as leads for the site owner (AGL-109).
    await hostRef
      .collection('leads')
      .add({
        email,
        source: 'signup',
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      .catch((error) => console.error(error))
    // Event triggers (AGL-128): sign-ups double as leads here too.
    await runEventWorkflows(hostId, 'memberSignUp', { email })
    await runEventWorkflows(hostId, 'lead', { email, source: 'signup' })
    setMemberCookie(res, hostId, mintMemberSession(hostId, memberRef.id))
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Sign-up failed' })
  }
}

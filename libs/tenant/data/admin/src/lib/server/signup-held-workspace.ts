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

import { findUserByUidAcrossPools } from './auth-pools'
import firebaseAdmin from './firebase-admin'

/**
 * The server's reading of the workspace name a sign-up holds on its account
 * (AGL-4117).
 *
 * The browser claims the hold (`apps/console/utils/signup-workspace.ts`, whose
 * module note explains the hold, its window and its provider binding). When that
 * claim fails, the only thing left in the browser is a derived name, so
 * `/api/orgs/create` asks here before it uses one. The same rules apply: a typed
 * name, inside the window, written by a provider the account still holds.
 */
const FIELD = 'pendingSignUpWorkspace'
const CLAIMED_FIELD = 'signUpWorkspaceClaimedAtMs'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The typed name to use instead of a derived one, or null. Never throws: a
 * failed read costs a renameable name, never the workspace.
 */
export async function readHeldSignUpWorkspaceName(
  uid: string,
  firestore: FirebaseFirestore.Firestore = firebaseAdmin.app().firestore(),
): Promise<string | null> {
  try {
    const snapshot = await firestore.doc(`users/${uid}`).get()
    const held = snapshot.get(FIELD) as Record<string, unknown> | null | undefined
    if (!held || held['nameWasTyped'] !== true) return null
    const name = typeof held['name'] === 'string' ? held['name'].trim() : ''
    const createdAtMs = Number(held['createdAtMs'] ?? 0)
    if (!name || !createdAtMs || Date.now() - createdAtMs > MAX_AGE_MS) return null
    const provider = String(held['provider'] ?? '')
    if (!provider) return null
    const account = await findUserByUidAcrossPools(uid)
    const holdsProvider = account?.record.providerData.some(
      (entry) => entry.providerId === provider,
    )
    return holdsProvider ? name : null
  } catch (error) {
    console.error('[orgs/create] held sign-up name read failed', error)
    return null
  }
}

/** Marks the hold spent, as the browser's claim would have. Never throws. */
export async function settleHeldSignUpWorkspace(
  uid: string,
  firestore: FirebaseFirestore.Firestore = firebaseAdmin.app().firestore(),
): Promise<void> {
  try {
    await firestore
      .doc(`users/${uid}`)
      .set({ [FIELD]: null, [CLAIMED_FIELD]: Date.now() }, { merge: true })
  } catch (error) {
    console.error('[orgs/create] held sign-up name settle failed', error)
  }
}

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

import {
  deleteUser,
  getAdditionalUserInfo,
  signOut,
  type Auth,
  type User,
  type UserCredential,
} from 'firebase/auth'
import { markInteractiveSignOut } from './interactive-signin'
import type { SessionReauthIdentity } from './session-reauth'

/**
 * Re-authentication never creates an account, and never swaps one (AGL-3425).
 *
 * The session re-auth dialog runs a plain provider sign-in, popup or
 * redirect, because by the time it is up the local user is
 * usually gone and `reauthenticateWithPopup` — which the close-account card
 * uses, and which refuses a different user by itself — needs one to hold.
 * A plain sign-in is also a sign-UP: pick an unregistered Google identity in
 * the chooser and Firebase creates an account for it, with no Terms shown,
 * no consent recorded, and nobody meaning to sign up. Pick another
 * registered one and the page that was open for one account quietly carries
 * on as another.
 *
 * So the dialog checks what came back before it stands down, the way /signin
 * checks its Google button (`rejectUnconsentedNewAccount`, AGL-1497). The
 * answer differs from /signin's on purpose: that page stands a new account
 * down and routes it to /signup, because a person on the sign-in page may
 * well be signing up. Nobody in this dialog is — it was opened for a named
 * account — so an account it created is deleted outright rather than left
 * behind as an empty, unconsented record.
 */

export type ReauthRefusal = 'new-account' | 'different-account'

/**
 * Whether the credential a re-auth ceremony produced must be refused, and
 * why. `credential` is whatever the ceremony resolved with; only a real
 * `UserCredential` can say the account is new, and every factor's result
 * carries the user it signed in.
 */
export function reauthRefusal(
  expected: SessionReauthIdentity,
  credential: unknown,
  signedIn?: Pick<User, 'uid'> | null,
): ReauthRefusal | null {
  const user =
    (credential as Partial<UserCredential> | null | undefined)?.user ??
    signedIn ??
    null
  if (!user) return null
  if (isNewUser(credential)) return 'new-account'
  if (expected.uid && user.uid !== expected.uid) return 'different-account'
  return null
}

function isNewUser(credential: unknown): boolean {
  if (!credential || typeof credential !== 'object') return false
  try {
    return (
      getAdditionalUserInfo(credential as UserCredential)?.isNewUser === true
    )
  } catch {
    // Not a credential Firebase recognises (a passkey bridge's result, say):
    // nothing it produced can have created an account.
    return false
  }
}

/**
 * Undo a refused ceremony: delete the account it created, or sign out of the
 * one it swapped in. Marked as an interactive sign-out first, so the session
 * hook clears any cookie the brief sign-in minted instead of validating it.
 * Never throws — the caller's job is to say what happened, not to fail again.
 */
export async function standDownRefusedReauth(
  auth: Auth,
  refusal: ReauthRefusal,
  user: User | null | undefined,
): Promise<void> {
  markInteractiveSignOut()
  if (refusal === 'new-account' && user) {
    try {
      // Straight after its own sign-in, so the recent-login requirement is
      // met, and deleting the current user signs it out as well.
      await deleteUser(user)
      return
    } catch (error) {
      console.error('could not delete the account a re-auth created', error)
    }
  }
  await signOut(auth).catch((error) => {
    console.error('could not sign out of a refused re-auth', error)
  })
}

/** What the dialog tells the person, naming the account it was opened for. */
export function reauthRefusalText(
  refusal: ReauthRefusal,
  email: string | null,
): string {
  const account = email ? ` as ${email}` : ' with the account this page is for'
  return refusal === 'new-account'
    ? `That account isn’t registered, so nothing was created. Sign in${account}, ` +
        'or use the sign-in page to switch accounts.'
    : `That’s a different account. Sign in${account}, or use the sign-in ` +
        'page to switch accounts.'
}

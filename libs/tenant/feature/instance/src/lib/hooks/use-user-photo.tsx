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
import { doc } from 'firebase/firestore'
import { useFirestore, useUser } from './firebase/firebase-services'
import { useFirestoreDoc } from './use-firestore-doc'

/** The avatar on the Firebase Auth record, and only that. */
export function useUserPhotoUrl() {
  const { data } = useUser()
  return data?.photoURL
}

/**
 * The avatar on the signed-in user's own profile document, `users/{uid}`
 * (AGL-1961).
 *
 * `photoUrl`, lowercase `url` — that document's spelling deliberately differs
 * from the roster's `photoURL`, and reading the roster's casing here would
 * silently yield nothing forever. See `seedUserProfile`, which writes this
 * field and says the same.
 */
export function useUserProfilePhotoUrl(): string | undefined {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid
  const { data } = useFirestoreDoc<{ photoUrl?: string }>(
    // Null ref until a uid exists, so a signed-out mount opens no listen at
    // all rather than one the rules refuse.
    () => (uid ? doc(firestore, 'users', uid) : null),
    [firestore, uid],
  )
  const stored = String(data?.photoUrl ?? '').trim()
  return stored || undefined
}

/**
 * The signed-in user's own avatar URL, or nothing (AGL-1683, AGL-1961).
 *
 * This used to fall back to `gravatarUrlFromEmail(email)`, so every console
 * page that showed the account chip sent gravatar.com an MD5 of the signed-in
 * user's email address along with their IP and a `Referer` naming the console.
 * An email MD5 is not an anonymisation — a gravatar hash is *designed* to be
 * looked up by anyone who has seen the address — and Automattic is on no
 * subprocessor register of ours.
 *
 * Worse than the leak itself: `gravatar.url(undefined)` still returns a URL
 * (the MD5 of the string "undefined"), so this hook never returned a falsy
 * value and the request fired even for a user with no email resolved yet.
 * Callers that treat "no photo" as "draw the initial" were unreachable.
 *
 * Callers now render initials themselves when this is empty — see
 * `MemberAvatar` in the console, which is the shared answer for a member's
 * face. No options: there is nothing left to size.
 *
 * THE PROFILE DOCUMENT COMES FIRST, and used not to be read here at all
 * (AGL-1961). `users/{uid}.photoUrl` is what `seedUserProfile` fills from the
 * identity provider on EVERY sign-in, and what `user-profiles.ts` calls "the
 * avatar the console shows for you" — but the app bar resolved the auth
 * record's `photoURL` alone, and nothing mirrors the document onto the auth
 * record except an interactive save on Manage Account. So a customer whose
 * IdP maps a picture attribute had it stored on every sign-in and still saw a
 * drawn initial in the header, while Manage Account's own card three inches
 * below showed the photo — it already resolved `photoUrl ?? photoURL`. One
 * user, two answers.
 *
 * Blank-not-null is the join, so a photo that exists in either place wins over
 * an empty one in the other. That also heals the non-atomic save: Manage
 * Account writes the document and then calls `updateProfile`, and a failure
 * between the two used to leave the console showing no avatar for a photo it
 * had successfully stored.
 */
export function useUserPhoto(): string | undefined {
  const profilePhoto = useUserProfilePhotoUrl()
  const authPhoto = useUserPhotoUrl()
  return profilePhoto || String(authPhoto ?? '').trim() || undefined
}

export default useUserPhoto

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
import { doc } from 'firebase/firestore'
import { useFirestore, useUser } from './firebase/firebase-services'
import { useFirestoreDoc } from './use-firestore-doc'

/**
 * The signed-in user's NAME, resolved the way their photo already is
 * (AGL-2486).
 *
 * ## The defect this closes
 *
 * `user.displayName` is empty for every SSO account. Measured on production
 * against tenant `aglyn-org-y5v14`: `zach@aglyn.com` has
 * `displayName: undefined`, `photoURL: undefined`, and one provider entry for
 * `saml.aglyn-workspace`. The account menu read that field alone and fell
 * through to the email, so it rendered `zach@aglyn.com` as the person's NAME
 * and again underneath as their address, and `memberInitials` — given an
 * address with no space in it — produced the single letter `Z` while the
 * presence stack beside it showed `ZG`.
 *
 * member doc holds `displayName: "Zach Gover"`, and presence had already
 * worked around the gap by reading the ID token's IdP claims. Three surfaces,
 * three different answers to "what is this person called", and the one the
 * account menu happened to use was the only one that is blank for the
 * enterprise tier.
 *
 * ## Why here, and why this order
 *
 * `users/{uid}` is the profile the user themselves edits, so it outranks the
 * provider's copy — exactly the precedence `useUserProfilePhotoUrl` already
 * establishes for the picture, on the same document, through the same
 * listener. This is that hook's sibling and is deliberately shaped like it;
 * two hooks answering "who is signed in" should not disagree about where to
 * look.
 *
 * The auth record is the fallback rather than the lead because it is the one
 * an IdP may never populate. The email is last and is not really a name — it
 * is what the surface shows when nothing else exists, and callers that want
 * to show an address separately should keep doing so.
 */
/**
 * The resolution itself, without React (AGL-2486).
 *
 * Pure and exported so the ORDER can be pinned in a spec. The order is the
 * entire content of this hook and the only part that can be wrong — and the
 * case that matters is one no unit test can reach through the hook, because
 * it needs a real SSO session in a GCIP tenant.
 */
export function resolveUserName(sources: {
  profileFirstName?: string | null
  profileLastName?: string | null
  authDisplayName?: string | null
  email?: string | null
}): string {
  const fromProfile = [sources.profileFirstName, sources.profileLastName]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')
  if (fromProfile) return fromProfile
  const fromAuth = String(sources.authDisplayName ?? '').trim()
  if (fromAuth) return fromAuth
  return String(sources.email ?? '').trim()
}

export function useUserName(): string {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid
  const { data } = useFirestoreDoc<{
    firstName?: string
    lastName?: string
  }>(
    // Null ref until a uid exists, so a signed-out mount opens no listen at
    // all rather than one the rules refuse — same shape as the photo hook.
    () => (uid ? doc(firestore, 'users', uid) : null),
    [firestore, uid],
  )
  return resolveUserName({
    profileFirstName: data?.firstName,
    profileLastName: data?.lastName,
    authDisplayName: user?.displayName,
    email: user?.email,
  })
}

export default useUserName

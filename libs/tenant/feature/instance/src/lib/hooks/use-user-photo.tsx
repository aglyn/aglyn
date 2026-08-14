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
import { useUser } from './firebase/firebase-services'

export function useUserPhotoUrl() {
  const { data } = useUser()
  return data?.photoURL
}

/**
 * The signed-in user's own avatar URL, or nothing (AGL-1683).
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
 */
export function useUserPhoto() {
  return useUserPhotoUrl()
}

export default useUserPhoto

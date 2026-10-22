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
import { signOut, type Auth } from 'firebase/auth'
import { markInteractiveSignOut } from './interactive-signin'

/**
 * Sign this browser out of the console completely: the shared `__session`
 * cookie first, then Firebase (AGL-236, AGL-3842).
 *
 * The order is the point. Firebase's `signOut` alone leaves the shared cookie
 * alive, and `useSessionCookie` only retires it after the signed-out state has
 * rendered. Anything that navigates in that gap (a page that sends a
 * signed-out visitor to `/signin`, a person tapping "Sign in" at once) can
 * abort the retiring request, and the next page then restores the old account
 * from the cookie it left behind. That is how "Use a different account" on
 * `/auth/native` signed the same account straight back in. Waiting on the
 * DELETE before `signOut` means no later step can find a live cookie.
 *
 * The interactive-sign-out marker is set first so `useSessionCookie` reads the
 * auth-null emission as a sign-out rather than an SDK hiccup to restore from
 * (AGL-543). A failed DELETE never blocks the Firebase sign-out.
 */
export async function endConsoleSession(auth: Auth): Promise<void> {
  markInteractiveSignOut()
  await fetch('/api/auth/session', { method: 'DELETE' }).catch((): undefined => undefined)
  await signOut(auth)
}

export default endConsoleSession

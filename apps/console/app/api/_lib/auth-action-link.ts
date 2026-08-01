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

/**
 * Minting side of the Aglyn-hosted auth action links (AGL-1112).
 *
 * Split from `auth-action-url.ts` only so the URL rewriting can be tested
 * without loading the Admin SDK — importing it pulls in the whole tenancy
 * barrel and undici, which a test about string manipulation has no business
 * needing.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  authActionUrl,
  oobCodeFromLink,
  type AuthActionKind,
} from './auth-action-url'

export type { AuthActionKind }
export { authActionUrl, oobCodeFromLink }

/**
 * Mint an action link for `email` that lands on Aglyn.
 *
 * Throws if Firebase returns a link with no code rather than returning a
 * half-formed URL — a "reset your password" mail whose button goes nowhere is
 * worse than a failed send, because the failed send is visible to the caller
 * and the dead link is only visible to the person who trusted it.
 */
export async function generateAuthActionLink(
  kind: AuthActionKind,
  email: string,
  origin: string,
): Promise<string> {
  const auth = firebaseAdmin.app().auth()
  // `url` is where Firebase sends the browser AFTER its own handler runs.
  // It is irrelevant once we bypass that handler, but it must still be an
  // authorized domain or the generate call itself is rejected.
  const settings = { url: `${origin}/signin`, handleCodeInApp: false }
  const link =
    kind === 'resetPassword'
      ? await auth.generatePasswordResetLink(email, settings)
      : await auth.generateEmailVerificationLink(email, settings)

  const oobCode = oobCodeFromLink(link)
  if (!oobCode) {
    throw new Error(`Firebase returned an action link with no oobCode (${kind})`)
  }
  return authActionUrl(origin, kind, oobCode)
}

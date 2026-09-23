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

'use client'

import { readFirstTouch } from '@aglyn/shared-util-first-touch'
import { pageFirstTouchRuntime } from '@aglyn/shared-util-first-touch/first-touch-page'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/**
 * Hand the platform where this new account came from (AGL-3289).
 *
 * Called by each sign-up door right after the account exists, and AWAITED
 * before anything that can navigate: the workspace the door creates next
 * copies its creator's record at birth, so the record has to be there first,
 * and a hard navigation would tear the request down mid-flight.
 *
 * The first touch is the one this page's capture holds — the served script's
 * runtime when it booted, else whatever the device kept. The server decides
 * everything else from the verified token, including whether this is account
 * creation at all, so calling it for a returning Google account is harmless:
 * the server writes nothing.
 *
 * Best-effort by contract, like every write beside the sign-up: a record that
 * could not be written must never read as a sign-up that failed.
 */
/** The first touch this page's capture holds, for a door that sends it itself. */
export function currentFirstTouch(): unknown {
  try {
    return pageFirstTouchRuntime()?.read() ?? readFirstTouch()
  } catch {
    return null
  }
}

export async function rememberAccountAcquisition(
  user: { getIdToken: () => Promise<string> } | null | undefined,
): Promise<void> {
  if (!user) return
  try {
    const touch = currentFirstTouch()
    const response = await authorizedFetch(user, '/api/auth/acquisition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ touch }),
    })
    if (!response.ok) {
      console.error('sign-up acquisition not recorded', response.status)
    }
  } catch (error) {
    console.error('sign-up acquisition not recorded', error)
  }
}

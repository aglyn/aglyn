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
 * Signs the console WebView in (AGL-3620), with the route the console's own
 * sign-in uses: `mintConsoleSession` posts the app's ID token to
 * `/api/auth/session`, and the HttpOnly cookie lands in the store the WebView
 * reads. One mint per sign-in is enough; a failed one is retried on the next
 * open, and the WebView still opens (the console then asks to sign in).
 * Sign-out ends it with the route's DELETE.
 */

import { endConsoleSession, getMobileConfig, mintConsoleSession, onBeforeSignOut, useMobileAuth } from '@aglyn/mobile-core'
import { useCallback, useEffect, useRef } from 'react'

export function useConsoleSession(): () => Promise<void> {
  const { user } = useMobileAuth()
  const minted = useRef<string | null>(null)

  useEffect(
    () =>
      onBeforeSignOut(async () => {
        minted.current = null
        await endConsoleSession({ origin: getMobileConfig().consoleOrigin })
      }),
    [],
  )

  return useCallback(async () => {
    if (!user || minted.current === user.uid) return
    const result = await mintConsoleSession({
      origin: getMobileConfig().consoleOrigin,
      idToken: await user.getIdToken(),
    })
    if (result.ok) minted.current = user.uid
  }, [user])
}

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

import { useUser } from '@aglyn/tenant-feature-instance'
import { useEffect, useState } from 'react'

/**
 * Whether the signed-in user carries the staff claim (AGL-760).
 *
 * `null` while the token is still being read — distinct from `false`, and the
 * distinction matters: rendering a "staff only" refusal during that window
 * would flash at every staff member on every admin page load.
 *
 * This is a UI gate, not the security boundary. Firestore rules and the
 * `/api/admin/*` handlers enforce the claim server-side; this exists so a
 * page says why it is empty instead of silently failing its reads.
 */
export function useIsStaff(): boolean | null {
  const { data: user } = useUser()
  const [isStaff, setIsStaff] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void (user as { getIdTokenResult?: () => Promise<{ claims?: Record<string, unknown> }> })
      ?.getIdTokenResult?.()
      .then((result) => {
        if (active) setIsStaff(Boolean(result?.claims?.staff))
      })
      .catch(() => {
        // A token we cannot read is not a staff token.
        if (active) setIsStaff(false)
      })
    return () => {
      active = false
    }
  }, [user])

  return isStaff
}

export default useIsStaff

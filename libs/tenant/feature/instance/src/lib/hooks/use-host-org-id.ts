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

import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from './firebase/firebase-services'

/**
 * The org a host belongs to, resolved from the `hostIndex` mirror
 * (AGL-237). Host-scoped pages use this — NOT the workspace context — so
 * org-shared data stays correct when a multi-org user deep-links into a
 * host outside their selected workspace. Null while loading or for
 * pre-org hosts (callers fall back to host-scoped paths).
 */
export function useHostOrgId(hostId: string | undefined): string | null {
  const firestore = useFirestore()
  const [orgId, setOrgId] = useState<string | null>(null)

  useEffect(() => {
    if (!hostId) {
      setOrgId(null)
      return undefined
    }
    let active = true
    void getDoc(doc(firestore, 'hostIndex', hostId))
      .then((snapshot) => {
        if (active) setOrgId((snapshot.data()?.['orgId'] as string) ?? null)
      })
      .catch(() => {
        if (active) setOrgId(null)
      })
    return () => {
      active = false
    }
  }, [firestore, hostId])

  return orgId
}

export default useHostOrgId

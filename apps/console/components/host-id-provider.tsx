/**
 * @license
 * Copyright 2024 Aglyn LLC
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
import { useParams } from 'next/navigation'
import { useRouter } from 'next/router'
import { createContext, useContext, useEffect } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'

export const HostIdContext = createContext<string>(null)

export const useHostId = () => {
  return useContext(HostIdContext)
}

export function HostIdProvider({ children }) {
  const params = useParams<{ hostId: string }>()
  const hostId = params?.hostId as string
  const router = useRouter()
  const firestore = useFirestore()
  const { data: user } = useUser()

  // Host-route guard (AGL-236): the [hostId] catch-all otherwise treats
  // any unknown first segment (a typo, or a bare /org before its index
  // existed) as a host and renders a broken dashboard. Verify against
  // hostIndex and bounce phantoms to the sites list. Lookup errors
  // (signed-out, offline) don't redirect — only a definitive not-found.
  useEffect(() => {
    if (!hostId || !user) return
    let active = true
    void getDoc(doc(firestore, 'hostIndex', hostId))
      .then((snapshot) => {
        if (active && !snapshot.exists()) {
          void router.replace('/hosts')
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [firestore, hostId, user, router])

  return (
    <HostIdContext.Provider value={hostId}>{children}</HostIdContext.Provider>
  )
}
HostIdProvider.displayName = 'HostIdProvider'

export default HostIdProvider

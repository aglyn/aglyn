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

import * as Aglyn from '@aglyn/aglyn'
import { pluginInstallToPreset } from '@aglyn/plugins-ui-mui'
import { collection, limit, query } from 'firebase/firestore'
import { useEffect, useRef } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from './use-firestore-collection'

/**
 * Registers the host's installed plugins as named besigner drawer entries
 * (AGL-190): one preset per install under the Community category, dropping
 * a `communityPlugin` node with the listing id pre-pinned. Presets are
 * re-synced whenever installs change and removed on host change/unmount so
 * switching hosts never leaks another host's plugins into the drawer.
 */
export function usePluginDrawerRegistration(hostId: string): void {
  const firestore = useFirestore()
  const { data: installDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'installs'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  // Track the ids we registered so we can unregister exactly those.
  const registeredIds = useRef<string[]>([])

  useEffect(() => {
    // Clear the previous set before registering the current one.
    if (registeredIds.current.length) {
      Aglyn.components.unregisterPreset(registeredIds.current)
      registeredIds.current = []
    }
    const presets = ((installDocs as any[]) ?? [])
      .map((install) => pluginInstallToPreset(install))
      .filter((preset): preset is NonNullable<typeof preset> => Boolean(preset))
    if (presets.length) {
      Aglyn.components.registerPreset(presets)
      registeredIds.current = presets.map((preset) => preset.$id)
    }
    return () => {
      if (registeredIds.current.length) {
        Aglyn.components.unregisterPreset(registeredIds.current)
        registeredIds.current = []
      }
    }
  }, [installDocs])
}

export default usePluginDrawerRegistration

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
import { pluginInstallToPresets, setKnownPluginInstalls } from '@aglyn/aglyn'
import { collection, limit, query } from 'firebase/firestore'
import { runInAction } from 'mobx'
import { useEffect, useMemo, useRef } from 'react'
import { useFirestore, useHostOrgId } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from './use-firestore-collection'

/**
 * Registers the host's installed plugins as named besigner drawer entries
 * (AGL-190): one preset per install under the Marketplace category, dropping
 * a `marketplacePlugin` node with the listing id pre-pinned. Presets are
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
  // Org-wide pins too (AGL-1029). One org pin covers every site, so a plugin
  // installed that way is genuinely available here — but the drawer only ever
  // read the host's own installs, so those plugins had no entry, and the
  // element could not be told they were installed either.
  const orgId = useHostOrgId(hostId)
  const { data: orgInstallDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'orgs', orgId ?? '-pending-', 'installs'),
        limit(50),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )
  /**
   * Host pins shadow org pins for the same listing (AGL-656), so the host
   * entry wins — the drawer must not offer the same plugin twice, and the
   * scope reported for it has to be the one actually in force.
   */
  const installs = useMemo(() => {
    const byListing = new Map<string, any>()
    for (const install of (orgInstallDocs as any[]) ?? []) {
      const id = install?.listingId ?? install?.$id
      if (id) byListing.set(id, { ...install, scope: 'org' })
    }
    for (const install of (installDocs as any[]) ?? []) {
      const id = install?.listingId ?? install?.$id
      if (id) byListing.set(id, { ...install, scope: 'host' })
    }
    return [...byListing.values()]
  }, [installDocs, orgInstallDocs])
  // Track the ids we registered so we can unregister exactly those.
  const registeredIds = useRef<string[]>([])

  // What the canvas may claim about installation (AGL-1029). Published
  // separately from the presets because the element asks by listing id, and
  // an unknown id is only "not installed" if there is a list to be missing
  // from — on the tenant nothing publishes one.
  useEffect(() => {
    setKnownPluginInstalls(
      installs.map((install) => ({
        listingId: install.listingId ?? install.$id,
        displayName: install.displayName ?? install.manifest?.name,
        scope: install.scope,
        // The declared props (and, where a publisher supplied one, how to edit
        // them) so the attributes panel can render real fields — AGL-1049.
        capabilities: install.manifest?.capabilities,
      })),
    )
    return () => setKnownPluginInstalls(undefined)
  }, [installs])

  useEffect(() => {
    // Single mobx transaction (AGL-371): the drawer re-renders once per
    // install sync, not once for the unregister and again per preset.
    runInAction(() => {
      if (registeredIds.current.length) {
        Aglyn.components.unregisterPreset(registeredIds.current)
        registeredIds.current = []
      }
      // One preset per install PLUS one per element the pinned version
      // declares (AGL-1031). Built from the pin, so a declared element appears
      // only where the plugin is installed and leaves with a revoked version.
      const presets = installs
        .flatMap((install) => pluginInstallToPresets(install))
        .filter(
          (preset): preset is NonNullable<typeof preset> => Boolean(preset),
        )
      if (presets.length) {
        Aglyn.components.registerPreset(presets)
        registeredIds.current = presets.map((preset) => preset.$id)
      }
    })
    return () => {
      if (registeredIds.current.length) {
        Aglyn.components.unregisterPreset(registeredIds.current)
        registeredIds.current = []
      }
    }
  }, [installs])
}

export default usePluginDrawerRegistration

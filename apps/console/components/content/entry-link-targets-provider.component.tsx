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

/**
 * What an entry's markdown body can link to (AGL-3119).
 *
 * The link dialog in the entry editor offers the same targets the designer's
 * pickers do — the host's pages, its collection listings and their feeds from
 * the routing map, and its entries from the search seam — so a link written
 * in a post is a reference that survives a rename, exactly like a link placed
 * on the canvas.
 *
 * Every fact here comes from a subscription the content scope ALREADY holds
 * (the host document, its screens, its collections), so mounting this costs
 * no read; only searching for an entry does.
 */

import {
  ScreenLinkContext,
  type ScreenLinkContextValue,
} from '@aglyn/aglyn'
import { useMemo, type ReactNode } from 'react'
import useScreenLinkRoutes, {
  screenLinkLabels,
} from '../../hooks/use-screen-link-routes'
import { collectionTemplatesOf } from '../../hooks/use-collection-templates'
import LinkTargetSearchProvider from '../link-target-search-provider.component'
import { useContentScope } from './content-scope.context'

export function EntryLinkTargetsProvider({
  children,
}: {
  children?: ReactNode
}) {
  const { hostId, hostDoc, collections, screenOptions } = useContentScope()
  const templates = useMemo(
    () => collectionTemplatesOf(collections),
    [collections],
  )
  // What the SITE serves, not what publishing wrote (AGL-1998) — the same
  // corrected map the besigner's pickers resolve against.
  const routes = useScreenLinkRoutes({
    templates,
    routingMap: hostDoc?.screens,
    screens: screenOptions,
  })
  const screenLinks = useMemo<ScreenLinkContextValue>(
    () => ({
      screens: routes,
      labels: screenLinkLabels(screenOptions, templates),
      // An editing surface: a link picked here is written into the body, and
      // nothing in the console navigates it.
      suppressNavigation: true,
    }),
    [routes, screenOptions, templates],
  )
  return (
    <ScreenLinkContext.Provider value={screenLinks}>
      <LinkTargetSearchProvider
        hostId={hostId}
        collections={templates.listingTargets}
      >
        {children}
      </LinkTargetSearchProvider>
    </ScreenLinkContext.Provider>
  )
}
EntryLinkTargetsProvider.displayName = 'EntryLinkTargetsProvider'

export default EntryLinkTargetsProvider

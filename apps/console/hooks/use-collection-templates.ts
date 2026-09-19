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

import { collection } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import {
  collectCollectionTemplateRoutes,
  collectionListingTargets,
  collectionListRoutesByScreenId,
  collectionListTemplateScreenIds,
  collectionTemplateScreenIds,
  type CollectionListingTarget,
  type CollectionTemplateRoute,
  type CollectionTemplateSource,
} from '../constants/collection-templates'

export interface UseCollectionTemplatesResult {
  /** Screen ids designated as a list/entry template by any collection. */
  templateScreenIds: Set<string>
  /**
   * The subset of those that serve a collection's list page at `/{slug}`,
   * and so ARE pages of the site and DO spend the screen allowance
   * (AGL-1387).
   */
  listTemplateScreenIds: Set<string>
  /** What each of those screens renders, keyed by screen id. */
  routesByScreenId: Map<string, CollectionTemplateRoute[]>
  /**
   * Where each list template is SERVED, keyed by screen id (AGL-1998) — the
   * routing-map override every screen-link surface resolves through.
   */
  listRoutesByScreenId: Record<string, string>
  /**
   * Every content collection's listing page, keyed by collection id
   * (AGL-2799) — the targets a link picker offers beside the screens.
   */
  listingTargets: Record<string, CollectionListingTarget>
}

/**
 * Which of this host's screens are collection templates, and what they render
 * — and, from the same read, where each content collection's listing lives.
 *
 * A template screen is not a page of the site (AGL-1267) and does not spend
 * the plan's screen allowance (AGL-1173) — two questions with the same answer,
 * so they read the collections once, here, rather than each surface deriving
 * its own set. Unbounded like `countBillableScreens`: a limit here would make
 * the client's precheck disagree with what the API enforces.
 */
export function useCollectionTemplates(
  hostId: string,
): UseCollectionTemplatesResult {
  const firestore = useFirestore()
  const { data } = useFirestoreCollection<any>(
    () => collection(firestore, 'hosts', hostId, 'collections'),
    [firestore, hostId],
    { idField: '$id' },
  )
  return useMemo(() => collectionTemplatesOf(data), [data])
}

/**
 * The same answers from collection documents a surface ALREADY holds.
 *
 * The content pages read `hosts/{h}/collections` for their own list, so the
 * entry editor's link pickers derive this from that subscription instead of
 * opening a second one for the same documents (AGL-3119).
 */
export function collectionTemplatesOf(
  collections:
    | ReadonlyArray<CollectionTemplateSource | null | undefined>
    | null
    | undefined,
): UseCollectionTemplatesResult {
  return {
    templateScreenIds: collectionTemplateScreenIds(collections),
    listTemplateScreenIds: collectionListTemplateScreenIds(collections),
    routesByScreenId: collectCollectionTemplateRoutes(collections),
    listRoutesByScreenId: collectionListRoutesByScreenId(collections),
    listingTargets: collectionListingTargets(collections),
  }
}

export default useCollectionTemplates

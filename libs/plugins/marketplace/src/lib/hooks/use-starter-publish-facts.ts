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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { SITE_STARTER_MAX_SCREENS } from '@aglyn/aglyn/app-utils/site-starter'
import {
  siteStarterBuiltinThemeOf,
  type SiteStarterBuiltinReading,
} from '@aglyn/aglyn/app-utils/site-starter-theme'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  usePlanFeature,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { collection, doc, documentId, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { orgMarketplacePath } from '../model/marketplace-paths'
import {
  payoutsReady,
  starterPublishPages,
  type StarterPublishFacts,
  type StarterPublishScreen,
} from '../model/starter-publish'

/** Everything "Publish as a starter" reads before the click. */
export interface StarterPublishFactsState {
  /** The reads; the form adds the price it holds. */
  facts: Omit<StarterPublishFacts, 'priceUsd'>
  /** The site's built-in theme as a starter would carry it, or `null` when it wears none. */
  builtin: SiteStarterBuiltinReading | null
  /** The host document has arrived, so `builtin` is an answer rather than a wait. */
  hostReady: boolean
}

/**
 * What a starter publish of one site would capture and what stands in its
 * way (AGL-4049): the host (its theme and routing), the routed pages it
 * would take, the publishing org's profile, and its plan.
 *
 * The routed pages are read by id, at most one past the most a starter may
 * have, the same window the door walks: enough to count them and to say a
 * site is past the limit, never the whole screens collection.
 */
export function useStarterPublishFacts(input: {
  hostId: string | null | undefined
  orgId: string | null | undefined
}): StarterPublishFactsState {
  const { hostId, orgId } = input
  const firestore = useFirestore()
  const host = useFirestoreDoc<Record<string, unknown>>(
    () => (hostId ? doc(firestore, 'hosts', hostId) : null),
    [firestore, hostId],
  )
  const routing = host.data?.['screens']
  const routedIds = useMemo(
    () =>
      routing && typeof routing === 'object' && !Array.isArray(routing)
        ? Object.keys(routing).slice(0, SITE_STARTER_MAX_SCREENS + 1)
        : [],
    [routing],
  )
  const routedKey = routedIds.join('|')
  const screens = useFirestoreCollection<StarterPublishScreen>(
    () =>
      hostId && routedIds.length
        ? query(collection(firestore, 'hosts', hostId, 'screens'), where(documentId(), 'in', routedIds))
        : null,
    // `routedKey` stands for the ids: a new array of the same ids is the same read.
    [firestore, hostId, routedKey],
    { idField: '$id' },
  )
  const profile = useFirestoreDoc<Record<string, unknown>>(
    () => (orgId ? doc(firestore, 'publisherProfiles', orgId) : null),
    [firestore, orgId],
  )
  const plan = usePlanFeature(hostId ?? undefined, 'marketplaceSelling')
  // Asked only of a profile with no payout account: a publisher that has one
  // has nothing the answer could change, and nearly every publisher does.
  const { data: user } = useUser()
  const [sellsAsPlatform, setSellsAsPlatform] = useState(false)
  const needsStanding = Boolean(profile.data && !payoutsReady(profile.data))
  useEffect(() => {
    if (!needsStanding || !orgId || !user) return
    let current = true
    authorizedFetch(user, `/api/marketplace/publisher-standing?orgId=${encodeURIComponent(orgId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((answer: { sellsAsPlatform?: unknown } | null) => {
        if (current) setSellsAsPlatform(answer?.sellsAsPlatform === true)
      })
      // Not knowing leaves the payouts step up: the door has the last word.
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [needsStanding, orgId, user])
  const route = useConsoleHostRoute(hostId)

  const hostReady = host.status === 'success'
  const pagesReady =
    hostReady && (routedIds.length === 0 || screens.status === 'success')
  return useMemo(
    () => ({
      facts: {
        plan,
        profile:
          profile.status === 'success' ? (profile.data ?? null) : undefined,
        sellsAsPlatform,
        pages: pagesReady ? starterPublishPages(routing, screens.data) : null,
        marketplacePath: route.orgSlug ? orgMarketplacePath(route.orgSlug) : null,
        pagesPath:
          route.orgSlug && route.subdomain
            ? buildRoute(Route.HOST_SCREENS, { orgSlug: route.orgSlug, host: route.subdomain })
            : null,
      },
      builtin: hostReady ? siteStarterBuiltinThemeOf(host.data ?? null) : null,
      hostReady,
    }),
    [plan, profile.status, profile.data, sellsAsPlatform, pagesReady, routing, screens.data, route.orgSlug, route.subdomain, hostReady, host.data],
  )
}

export default useStarterPublishFacts

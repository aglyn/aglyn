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

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useHostSubdomain } from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'

/**
 * The theme editor moved under Setup → Theme (AGL-114); this route only
 * survives so old links and bookmarks keep working.
 *
 * It was passing `{ hostId }` to a route templated on `{ orgSlug, host }`,
 * which produced the literal path `/<orgSlug?>/hosts/<host?>/setup` — the
 * bookmark-compatibility route was itself a dead end (AGL-685). It only
 * compiled because `Route.HOST_SETUP` had no `RoutePayload` entry.
 */
const HostTheme: NextPageWithLayout<Record<string, never>> = () => {
  const host = useHostSubdomain()
  const orgSlug = useOrgSlug()
  const router = useRouter()

  useEffect(() => {
    if (host && orgSlug) {
      router.replace(
        `${buildRoute(Route.HOST_SETUP, { orgSlug, host })}?tab=theme`,
      )
    }
  }, [host, orgSlug, router])

  return null
}
HostTheme.displayName = 'Page:HostTheme'

export default HostTheme

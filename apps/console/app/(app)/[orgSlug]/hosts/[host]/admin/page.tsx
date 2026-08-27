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
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useHostSubdomain } from '../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'

/**
 * `/admin` is the section index and renders nothing of its own (AGL-693).
 *
 * No `?tab=` compatibility map. The sections were panels behind a query
 * parameter and are routes now; with no shipped customers there is nothing
 * holding an old link, and a map kept "just in case" is a second set of names
 * for the same eight pages that has to be maintained against them.
 *
 * `replace`, not `push`: a redirect the reader did not ask for must not become
 * a history entry their back button bounces off.
 */
const HostAdmin: NextPageWithLayout<Record<string, never>> = () => {
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  useEffect(() => {
    if (!orgSlug || !host) return
    router.replace(buildRoute(Route.HOST_ADMIN_PLUGINS, { orgSlug, host }))
  }, [router, orgSlug, host])
  return null
}
HostAdmin.displayName = 'Page:HostAdmin'

export default HostAdmin

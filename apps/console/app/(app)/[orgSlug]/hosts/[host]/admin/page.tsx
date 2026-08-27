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
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useHostSubdomain } from '../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'

/**
 * The tab ids these sections were deep-linked by, and where they live now.
 *
 * Setup redirects three of its old `?tab=` values here (AGL-1014), so those
 * links pass through TWO redirects to reach a section — both `replace`, so
 * neither becomes a history entry the back button bounces off.
 */
const LEGACY_TAB_SECTIONS: Readonly<Record<string, Route>> = {
  plugins: Route.HOST_ADMIN_PLUGINS,
  domain: Route.HOST_ADMIN_DOMAIN,
  security: Route.HOST_ADMIN_SECURITY,
  activity: Route.HOST_ADMIN_ACTIVITY,
  danger: Route.HOST_ADMIN_DANGER,
}

/** `/admin` is the section index and renders nothing of its own (AGL-693). */
const HostAdmin: NextPageWithLayout<Record<string, never>> = () => {
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const searchParams = useSearchParams()
  const requested = searchParams?.get('tab') ?? ''
  useEffect(() => {
    if (!orgSlug || !host) return
    const route = LEGACY_TAB_SECTIONS[requested] ?? Route.HOST_ADMIN_PLUGINS
    router.replace(buildRoute(route as never, { orgSlug, host } as never))
  }, [router, orgSlug, host, requested])
  return null
}
HostAdmin.displayName = 'Page:HostAdmin'

export default HostAdmin

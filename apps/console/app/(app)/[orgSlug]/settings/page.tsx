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
import { buildRoute, Route } from '../../../../constants/route-links'
import { useOrgSlug } from '../../../../hooks/use-org-scope'

/**
 * The section ids this page used to carry in `?tab=`, and where they live now.
 *
 * Kept, not dropped. `HubTabs` mirrored the active tab into the query string
 * precisely so a section could be linked to, and those links are in bookmarks,
 * in support replies and in our own docs — `settings?tab=installed` is written
 * into another page in this console. A redirect that ignored the parameter
 * would land every one of them on General and look like the section had been
 * removed.
 */
const LEGACY_TAB_SECTIONS: Readonly<Record<string, Route>> = {
  general: Route.ORG_SETTINGS_GENERAL,
  profile: Route.ORG_SETTINGS_PROFILE,
  plugins: Route.ORG_SETTINGS_PLUGINS,
  installed: Route.ORG_SETTINGS_PLUGINS,
  'api-keys': Route.ORG_SETTINGS_API_KEYS,
  branding: Route.ORG_SETTINGS_BRANDING,
  sso: Route.ORG_SETTINGS_SSO,
  ownership: Route.ORG_SETTINGS_OWNERSHIP,
  danger: Route.ORG_SETTINGS_DELETE,
}

/**
 * `/settings` is the section index and renders nothing of its own (AGL-693).
 *
 * `replace`, not `push`: a redirect the reader did not ask for must not become
 * a history entry their back button bounces off.
 */
const OrgSettings: NextPageWithLayout<Record<string, never>> = () => {
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const searchParams = useSearchParams()
  const requested = searchParams?.get('tab') ?? ''
  useEffect(() => {
    if (!orgSlug) return
    const route = LEGACY_TAB_SECTIONS[requested] ?? Route.ORG_SETTINGS_GENERAL
    router.replace(buildRoute(route as never, { orgSlug } as never))
  }, [router, orgSlug, requested])
  return null
}
OrgSettings.displayName = 'Page:OrgSettings'

export default OrgSettings

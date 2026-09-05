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

import { buildRoute, Route } from '@aglyn/aglyn'
import { useParams } from 'next/navigation'

/**
 * The CRM hub's address for the site this console is on, or `null` until the
 * route params settle (AGL-2608).
 *
 * The same shape the email plugin uses to reach the marketing hub: the org
 * slug and the site are already in the URL, so no document is read to build
 * a link, and `Route.HOST_PLUGIN` with the CRM's nav slug is the address the
 * shell resolves. From it, `crmRoutes(path).lead(id)` names one lead — the
 * Inbox lists leads, and the CRM is where one is worked.
 */
export function useCrmHubPath(): string | null {
  const params = useParams<{ orgSlug: string; host: string }>()
  const orgSlug = params?.orgSlug
  const host = params?.host
  if (!orgSlug || !host) return null
  return buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: 'crm' })
}

export default useCrmHubPath

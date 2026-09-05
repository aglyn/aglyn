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

import { buildRoute, Route } from '@aglyn/aglyn'
import { useParams } from 'next/navigation'

/**
 * The CRM hub's own path — `/{orgSlug}/hosts/{host}/crm` — for a surface
 * that was not handed one (AGL-2599).
 *
 * A section rendered by the hub receives `basePath` from the shell and
 * passes it down, and that value wins whenever it is present: it is the
 * address the shell actually resolved, legacy `/contacts` included. The
 * dashboard widget and a record card dropped onto somebody else's page get
 * a host id and nothing else, so for them the path is rebuilt from the URL
 * the way the other dashboard glances build theirs. `useParams` is called
 * unconditionally because a hook cannot be skipped on a prop.
 */
export function useCrmHubPath(basePath?: string | null): string {
  const params = useParams<{ orgSlug?: string; host?: string }>()
  if (basePath) return basePath
  const orgSlug = String(params?.orgSlug ?? '')
  const host = String(params?.host ?? '')
  return `${buildRoute(Route.HOST_DASHBOARD, { orgSlug, host })}/crm`
}

/**
 * The CRM hub's address for a surface OUTSIDE the CRM — an order's dialog,
 * a booking's row — or `null` until the route params settle (AGL-2622).
 *
 * The shape the Inbox's own copy of this hook has: a sibling plugin is
 * handed its own `basePath`, not the CRM's, and it must not render a link
 * to `/hosts//crm` while the params are still empty. Built from the URL
 * for the reason `useCrmHubPath` is, and from `Route.HOST_PLUGIN` with the
 * CRM's slug because that is the address the shell resolves — `crmRoutes`
 * then names the record. One export here rather than a copy per plugin, so
 * a surface that moves the hub has one place to change.
 */
export function useCrmHubPathFromRoute(): string | null {
  const params = useParams<{ orgSlug?: string; host?: string }>()
  const orgSlug = params?.orgSlug
  const host = params?.host
  if (!orgSlug || !host) return null
  return buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: 'crm' })
}

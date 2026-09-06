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

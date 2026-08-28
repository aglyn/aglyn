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

import { TENANT_APEX } from '@aglyn/aglyn/server'
import { attachProjectDomain } from '@aglyn/tenant-data-admin'

/**
 * Registers `{subdomain}.aglyn.app` on the tenant deployment as a per-domain
 * REDIRECT to the custom domain (AGL-1273). The app-level canonical redirect
 * in `loadPageData` is baked into an ISR entry keyed on pathname, so it
 * structurally cannot carry the query string — a campaign that pointed at the
 * platform subdomain lost its `utm_*` on the hop. The edge redirect preserves
 * path AND query at zero runtime cost, and the app-level redirect stays as the
 * fallback wherever the provider cannot express a redirect at all.
 *
 * A redirect is a REGISTRATION, not a special case: create the name carrying
 * the redirect, or point an existing entry at the new target. Both halves live
 * in the provider, so a name already on the deployment gets its redirect
 * applied rather than being read as "already done" — an entry left serving
 * instead of forwarding is a second live copy of the site on a name that was
 * supposed to hand visitors to the custom domain.
 *
 * Best-effort BY DESIGN: the custom domain is already attached by the time
 * this runs, and a redirect-registration failure must not unwind that. A
 * failure sets `subdomainRedirectPending` so the gap is visible and the
 * completer cron (`/api/admin/finish-domain-attachments`) can close it.
 */
export async function upsertSubdomainRedirect(options: {
  subdomain: string
  target: string
}): Promise<boolean> {
  const { subdomain, target } = options
  const result = await attachProjectDomain(
    `${subdomain}.${TENANT_APEX}`,
    { redirectTo: target },
    'tenant',
  )
  return result.outcome === 'attached' || result.outcome === 'already-exists'
}

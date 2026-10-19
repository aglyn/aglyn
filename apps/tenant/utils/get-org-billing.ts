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

import type * as Aglyn from '@aglyn/aglyn/server'
import { getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * SECURITY-RELEVANT TTL (AGL-1302) for the request-time readers: the
 * lockdown verdict the middleware enforces ahead of every cache, and the
 * other dynamic routes. Org fields that change WITHOUT a tenant bust — the
 * bandwidth cap the usage sweep stamps, a suspension written straight to the
 * doc — reach them through this TTL alone, so it stays short. Do not raise it
 * for throughput.
 */
const ORG_BILLING_TTL_SECONDS = 60

/**
 * The backstop for the ISR-held render (`scope: 'render'`).
 *
 * ⚠️ A `withRenderCache` TTL inside a regeneration LOWERS THE PAGE'S OWN
 * WINDOW to match (`unstable_cache` shrinks the work store's `revalidate`).
 * At 60s this one held every published page on a 60s window under the
 * catch-all's `revalidate = 3600`: Vercel served `stale_time` to two of every
 * three uptime checks on a site home page, and each one was a full re-render.
 *
 * The render can take the published-data backstop because everything it reads
 * from the org doc is announced when it changes: a plan transition
 * (`billing/webhook`), a staff override (`admin/org-override`) and the org's
 * settings (`orgs/settings`) all call `revalidateOrgHosts`, and a lockdown
 * busts `tenant-data:{hostId}` and is enforced by the middleware before the
 * cached page is served at all. The bandwidth ceiling notice moved to the
 * verdict for the same reason (see the catch-all's `revalidate`).
 */
const ORG_BILLING_RENDER_TTL_SECONDS = PUBLISHED_SITE_DATA_TTL_SECONDS

/**
 * Fetches the billing/suspension doc that owns a host — the organization
 * since AGL-238 (the org doc mirrors the legacy tenant billing shape, so
 * the return keeps its historic `tenant` name for the render branches).
 * Fail-open: on error or a missing org, `tenant` is null — callers treat
 * that as the pre-billing state (all features on). Naming: "tenant"
 * here is the historic billing alias for the ORG doc (AGL-443; see the
 * docs-site glossary) — distinct from "the tenant app", which is this
 * whole published-sites runtime.
 *
 * Cached per host (AGL-1302): the hostIndex hop plus the org doc were two
 * reads on every render of every path. The cached value is the JSON shape the
 * entitlement resolvers already consume (plain fields; `suspendedAt` only ever
 * checked for truthiness). A missing org is NOT cached — the fail-open
 * contract stays per-request.
 *
 * `scope: 'render'` is for reads inside the ISR-cached page and its layout
 * ({@link ORG_BILLING_RENDER_TTL_SECONDS}); everything else takes the default,
 * {@link ORG_BILLING_TTL_SECONDS}. The two are separate entries, so a long
 * render entry never answers a request-time reader.
 */
export async function getOrgBilling(options: {
  hostId?: string
  scope?: 'request' | 'render'
}) {
  const { hostId, scope = 'request' } = options
  const data = {
    org: null as Partial<Aglyn.AglynOrgBilling> | null,
    error: null as unknown,
  }
  if (!hostId) return data

  const render = scope === 'render'
  try {
    const resolved = await withRenderCache({
      key: [render ? 'tenant-org-billing-render' : 'tenant-org-billing', hostId],
      revalidate: render
        ? ORG_BILLING_RENDER_TTL_SECONDS
        : ORG_BILLING_TTL_SECONDS,
      tags: [tenantDataTag(hostId)],
      read: async () =>
        ((await getOrgForHost(hostId))?.org ??
          null) as Partial<Aglyn.AglynOrgBilling> | null,
      store: (value) => value !== null,
    })
    if (resolved) data.org = resolved
  } catch (error) {
    console.error(error)
    data.error = error
  }

  return data
}

export default getOrgBilling

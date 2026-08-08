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
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * SECURITY-RELEVANT TTL (AGL-1302): this doc is the suspension gate and every
 * entitlement input for the render, so it gets the SHORTEST cache the sweep
 * problem allows — 60 seconds, matching the page's own ISR window. A
 * staff-suspended org stops serving within roughly two windows (doc TTL +
 * page revalidate), which is the same order the pre-cache behavior gave via
 * ISR alone. Do not raise this for throughput; the fan-out reads live in the
 * compose bundle, not here.
 */
const ORG_BILLING_TTL_SECONDS = 60

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
 * Cached per host for {@link ORG_BILLING_TTL_SECONDS} (AGL-1302): the
 * hostIndex hop plus the org doc were two reads on every render of every
 * path. The cached value is the JSON shape the entitlement resolvers already
 * consume (plain fields; `suspendedAt` only ever checked for truthiness).
 * A missing org is NOT cached — the fail-open contract stays per-request.
 */
export async function getOrgBilling(options: { hostId?: string }) {
  const { hostId } = options
  const data = {
    org: null as Partial<Aglyn.AglynOrgBilling> | null,
    error: null as unknown,
  }
  if (!hostId) return data

  try {
    const resolved = await withRenderCache({
      key: ['tenant-org-billing', hostId],
      revalidate: ORG_BILLING_TTL_SECONDS,
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

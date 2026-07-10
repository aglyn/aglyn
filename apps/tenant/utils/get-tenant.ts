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

import type * as Aglyn from '@aglyn/aglyn'
import { getOrgForHost } from '@aglyn/tenant-data-admin'

/**
 * Fetches the billing/suspension doc that owns a host — the organization
 * since AGL-238 (the org doc mirrors the legacy tenant billing shape, so
 * the return keeps its historic `tenant` name for the render branches).
 * Fail-open: on error or a missing org, `tenant` is null — callers treat
 * that as the pre-billing state (all features on).
 */
export async function getTenant(options: { hostId?: string }) {
  const { hostId } = options
  const data = {
    tenant: null as Partial<Aglyn.AglynTenant> | null,
    error: null as unknown,
  }
  if (!hostId) return data

  try {
    const resolved = await getOrgForHost(hostId)
    if (resolved) data.tenant = resolved.org as Partial<Aglyn.AglynTenant>
  } catch (error) {
    console.error(error)
    data.error = error
  }

  return data
}

export default getTenant

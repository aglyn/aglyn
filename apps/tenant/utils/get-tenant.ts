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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Fetches the tenant doc that owns a host (billing/entitlements, AGL-69).
 * Fail-open: on error or a missing doc, `tenant` is null — callers treat
 * that as the pre-billing state (all features on).
 */
export async function getTenant(options: { tenantId?: Aglyn.TenantUid }) {
  const { tenantId } = options
  const data = {
    tenant: null as Partial<Aglyn.AglynTenant> | null,
    error: null as unknown,
  }
  if (!tenantId) return data

  await firebaseAdmin
    .app()
    .firestore()
    .collection('tenants')
    .doc(tenantId)
    .get()
    .then((snapshot) => {
      if (snapshot.exists) data.tenant = snapshot.data() as any
    })
    .catch((error) => {
      console.error(error)
      data.error = error
    })

  return data
}

export default getTenant

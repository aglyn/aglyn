/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import * as Aglyn from '@aglyn/core-data-foundation'
import {
  child,
  type DataSnapshot,
  get,
  getDatabase,
  ref,
  set,
} from 'firebase/database'
import firebaseApp from './firebase-app'

export function setTenant(tenant: Aglyn.AglynTenant): Promise<void> {
  const { $id, ...rest } = tenant
  const db = getDatabase(firebaseApp)
  return set(ref(db, 'tenants/' + $id), rest)
}

export function getTenant(tenantId: Aglyn.TenantUid): Promise<DataSnapshot> {
  const db = getDatabase(firebaseApp)
  return get(child(ref(db), `tenants/${tenantId}`))
}

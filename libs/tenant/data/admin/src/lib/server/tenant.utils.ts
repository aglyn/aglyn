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

import * as Aglyn from '@aglyn/aglyn'
import type { Database, DataSnapshot } from 'firebase-admin/database'
import firebaseAdmin from './firebase-admin'

let db: Database
if (!db) {
  db = firebaseAdmin.database()
  if (process.env.NODE_ENV !== 'production') {
    // try {
    //   db = firebaseAdmin.database().useEmulator(
    //     process.env.FIREBASE_DATABASE_EMULATOR_HOSTNAME || 'localhost',
    //     parseInt(process.env.FIREBASE_DATABASE_EMULATOR_PORT) || 9000,
    //   )
    //   console.log('firebase useEmulator')
    // }
    // catch (e) {
    //   console.error('firebase useEmulator ERROR!', e)
    // }
  }
}
const ref = db.ref(`tenants`)

export function setAdminTenant(tenant: Aglyn.AglynTenant): Promise<void> {
  const { $id, ...rest } = tenant
  return ref.child($id).set(rest)
}

export function getAdminTenant(
  tenantId: Aglyn.TenantUid,
): Promise<DataSnapshot> {
  return ref.child(tenantId).get()
}

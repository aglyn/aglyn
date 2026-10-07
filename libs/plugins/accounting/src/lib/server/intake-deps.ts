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

/**
 * What the order-event intake needs from the platform (AGL-3614): the Admin
 * Firestore and a clock. Apart from `sync-intake.ts` so the intake stays
 * testable without the Admin SDK, and loaded by `declarations.server.ts` only
 * when the first event arrives. It reaches no credential.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import type { AccountingIntakeDeps } from './sync-intake'

export function defaultAccountingIntakeDeps(): AccountingIntakeDeps {
  return { firestore: () => firebaseAdmin.app().firestore(), now: Date.now }
}

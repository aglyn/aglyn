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

import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  createFormSubmissionsTransferResource,
  type FormSubmissionsTransferResource,
} from './form-submissions-transfer'

/**
 * The submissions resource over the console's Admin SDK. Loaded by the
 * console-server declarations with the first export, never at boot: this
 * module is what brings `firebase-admin`, so the declarations import it
 * lazily and import no other library lazily — a lazy import of a library
 * would make every static import of it, across the plugin and the apps, a
 * module boundary error.
 */
export function adminFormSubmissionsTransferResource(): FormSubmissionsTransferResource {
  return createFormSubmissionsTransferResource({ firestore: firebaseAdmin.app().firestore() })
}

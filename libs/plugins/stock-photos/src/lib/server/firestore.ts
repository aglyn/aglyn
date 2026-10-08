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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * The Admin SDK's Firestore, for the search cache. Its own module, loaded by
 * relative path on the first search, so registering the provider at boot
 * loads no Admin SDK and a lib specifier is never deferred (AGL-1921).
 */
export function stockPhotosFirestore(): FirebaseFirestore.Firestore {
  return firebaseAdmin.app().firestore()
}

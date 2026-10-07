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

import { AI_IMAGE_VERTEX_PROVIDER_ID } from './catalog'
import { VERTEX_IMAGE_PUBLISHED_HOSTS } from './vertex-image-endpoint'

/**
 * The image providers' published hosts (AGL-3602), by provider id: what the
 * subprocessor declarations pair with each `AI_IMAGE_CATALOG_PROVIDERS` row.
 * Read from each adapter's endpoint module rather than the adapter itself,
 * which loads the platform's service-account credential and has no business
 * in the manifest generator that reads this.
 */
export const AI_IMAGE_PROVIDER_HOSTS: Readonly<Record<string, readonly string[]>> = {
  [AI_IMAGE_VERTEX_PROVIDER_ID]: VERTEX_IMAGE_PUBLISHED_HOSTS,
}

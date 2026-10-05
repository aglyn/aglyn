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

import type { MatchKeySpec } from '@aglyn/aglyn/data-transfer'

/**
 * The form submissions transfer resource's key, as `plugins.config.json`
 * declares it under `transferResources`: a site's submissions, exported and
 * never imported.
 *
 * Its own light module because three readers need it — the console
 * registrar's client half, the server declarations' server half, and the
 * card buttons that open the export dialog — and none of them should load
 * the resource itself to learn its name.
 */
export const FORM_SUBMISSIONS_TRANSFER_KEY = 'forms.submissions'

/**
 * How a row names its submission: the Aglyn ID alone. A submission has no
 * natural key — two visitors may send the same words through the same form
 * in the same minute — and the resource is never imported, so the id is all
 * a file ever needs to say which submission a row is.
 *
 * Static, because the registry reads `matchKeys` synchronously at boot.
 */
export const FORM_SUBMISSIONS_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'id', normalizer: 'aglynId' },
]

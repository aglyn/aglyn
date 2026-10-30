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
 * Where a version's WORKING DRAFT lives (AGL-1152): one document per version,
 * `…/versions/{versionId}/draft/current`, on every plan. The Besigner saves
 * to it as an author works and offers it with Open draft when the page is
 * opened; publishing moves it into the version and clears it.
 *
 * Held here, in the core, because two writers must agree on it to the
 * letter: the Besigner (`besigner-server-draft.ts`) and an AI edit job, which
 * saves its change into the same draft so the author reviews and publishes
 * it in the Besigner exactly as they would their own (AGL-4116).
 */

/** The subcollection under a version that holds its draft. */
export const VERSION_DRAFT_COLLECTION = 'draft'

/** The only id a draft may have. One per version, by construction. */
export const VERSION_DRAFT_DOC_ID = 'current'

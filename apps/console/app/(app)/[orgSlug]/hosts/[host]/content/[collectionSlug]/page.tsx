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
'use client'

/**
 * One content collection's entries (AGL-2498) — `…/content/{collectionSlug}`.
 *
 * The collection is a PATH SEGMENT rather than `?collection=`, and it had to
 * become one before the entry beneath it could have an address at all: an
 * entry is addressed `collection + entry`, and half of that address cannot
 * live in the path while the other half lives in the query.
 *
 * The collection, its entries, its categories, the host's authors and screens
 * all come from `ContentScopeProvider` in `../../layout.tsx`, which sits
 * ABOVE this route and the entry route both — so the two pages are genuinely
 * separate components without a second copy of the data layer between them.
 *
 * The title comes from `./layout.tsx`.
 */
import CollectionEntriesPage from '../../../../../../../components/content/collection-entries-page.component'

export default function HostContentCollectionPage() {
  return <CollectionEntriesPage />
}
HostContentCollectionPage.displayName = 'Page:HostContentCollection'

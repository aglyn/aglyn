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
 * The content manager at its bare address (AGL-2498).
 *
 * Renders the collections list. When the site has collections at all, the
 * scope provider immediately rewrites this address to
 * `…/content/{collectionSlug}` — so what this route actually serves for long is
 * the ZERO STATE, and the `?tab=authors` deep link, neither of which names a
 * collection.
 *
 * A real page file with a real component, like every other page in the
 * console. It used to be a 4,200-line component that rendered EITHER this list
 * or the entry editor depending on a query parameter, with two sibling routes
 * aliased at it — which is what made the list flash before an entry appeared.
 */
import CollectionEntriesPage from '../../../../../../components/content/collection-entries-page.component'

export default function HostContentPage() {
  return <CollectionEntriesPage />
}
HostContentPage.displayName = 'Page:HostContent'

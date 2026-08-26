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
 * One entry's detail page (AGL-2498) —
 * `…/content/{collectionSlug}/entries/{entryId}`, or `…/entries/new` for a
 * draft that has no document yet.
 *
 * ## Why this is a real page rather than an alias
 *
 * It was an alias of the collection route for one release, and the alias is
 *
 * One component cannot render an entry until its buffer is seeded from the
 * entries listener, so on a cold load it rendered the only thing it could
 * render meanwhile — the list. The address said "entry" and the page said
 * "collection" for as long as Firestore took. Two screens, two components; the
 * shared resolution moved up into `../../../../layout.tsx`, so nothing is
 * duplicated by the split.
 *
 * The title comes from `./layout.tsx`.
 */
import EntryDetailPage from '../../../../../../../../../components/content/entry-detail-page.component'

export default function HostContentEntryPage() {
  return <EntryDetailPage />
}
HostContentEntryPage.displayName = 'Page:HostContentEntry'

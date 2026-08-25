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
 * One entry's detail page (AGL-2498) —
 * `…/content/{collectionId}/entries/{entryId}`, or `…/entries/new` for a
 * draft that has no document yet.
 *
 * An alias of `../../../page` for the reason its sibling documents: the
 * detail is rendered by the component that already resolves the collection,
 * the entries listener, the categories, the authors and the screens, and a
 * separate implementation would have to re-resolve every one of them.
 *
 * What CHANGED in AGL-2498's second pass is where the address lives. The
 * entry used to be `?entry=<id>` on `/content`, which could say which entry
 * but not which collection — the collection rode along in a SECOND query
 * parameter, and a link that rebuilt the query dropped it and landed the
 * reader on whichever collection sorted first. Both halves are path segments
 * now, so the address is complete or it is nothing.
 */
export { default } from '../../../page'

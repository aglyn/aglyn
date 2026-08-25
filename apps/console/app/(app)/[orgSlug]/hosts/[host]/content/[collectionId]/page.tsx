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
 * One content collection's entries (AGL-2498) — `…/content/{collectionId}`.
 *
 * THE SAME COMPONENT AS `../page`, MOUNTED AT A LONGER ADDRESS, AND THAT IS
 * THE WHOLE DESIGN.
 *
 * The manager resolves a lot to put an entry list on screen: the collections,
 * the entries listener for the chosen one, that collection's categories, the
 * host's authors, its screens, and the site's public origin. A second route
 * with its own copy of that resolution is a second place for the two to
 * disagree about which collection is open — and the disagreement would be
 * invisible until somebody saved an entry into the wrong one.
 *
 * So the route segment carries the collection and `useParams()` reads it.
 * There is one implementation, one data layer, and three addresses into it.
 *
 * The title comes from `../../layout.tsx`, which wraps this segment too.
 */
export { default } from '../page'

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
 * Every collection element, re-exported for the package's
 * `@aglyn/plugins-mui/components/collection` subpath.
 *
 * They were this one module until AGL-3401, and the element tier loaded all
 * nine for a page placing any one of them. Each is its own module now, reached
 * through its own `import()` in `element-tier.ts` — so no renderer imports
 * THIS file: doing so would put all nine back into one chunk.
 */
export { loadCollectionFuse } from './collection-search-box'
export * from './collection-entries'
export * from './collection-entry-body'
export * from './collection-related'
export * from './collection-share'
export * from './collection-entry-meta'
export * from './collection-entry-author'
export * from './collection-author-profile'
export * from './collection-categories'
export * from './collection-search'
export { CollectionEntries as default } from './collection-entries'

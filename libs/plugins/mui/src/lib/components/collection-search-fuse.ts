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
 * The fuzzy matcher a collection search box fetches on its first keystroke
 * (AGL-3401), behind a module of this package's own.
 *
 * `collection-search-box` `import()`s THIS file rather than the vendor
 * package itself. The chunk is the same either way, but a dynamic import of
 * another project is a lazy edge in the Nx graph, and because the apps load
 * this plugin lazily too, every static import of `@aglyn/shared-util-vendor`
 * in the console and the tenant became "a static import of a lazy-loaded
 * library" — a lint error in files that never touch Fuse.
 */
export { Fuse } from '@aglyn/shared-util-vendor/fuse'

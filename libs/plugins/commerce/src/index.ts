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

export * from './lib/constants/bundle-common'
export * from './lib/model'
export * from './lib/plugin'
/**
 * ⛔ No console surface may be re-exported here (AGL-1151).
 *
 * The tenant's generated loader activates the site half of this plugin with
 * `import('@aglyn/plugins-commerce')` — this file. Anything this barrel names
 * statically is therefore in the chunk a PUBLISHED site downloads, evaluates
 * and hydrates, whether or not the page has a storefront on it.
 *
 * The console cards are the expensive case: they carry `firebase/firestore`
 * and `@aglyn/tenant-feature-instance`, so one re-export line put roughly
 * 700 KB of database and identity client onto every visitor's first paint to
 * render markup that queries nothing. It is the shape `compress()` already
 * carries a note about, one level up — a VALUE re-export, for a component the
 * site half never renders.
 *
 * Console consumers deep-import the component they need
 * (`@aglyn/plugins-commerce/components/console/...`), which reaches the same
 * module without routing it through the site half's entry point.
 */

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
export * from './lib/components/email-blocks'
export * from './lib/plugin'
export * from './lib/model'
/**
 * ⛔ No console surface may be re-exported here (AGL-1151).
 *
 * The tenant's generated loader activates the site half of this plugin with
 * `import('@aglyn/plugins-email')` — this file. Anything named statically here
 * lands in the chunk a PUBLISHED site downloads and evaluates, so the three
 * console cards that used to sit on these lines carried `firebase/firestore`
 * and `@aglyn/tenant-feature-instance` onto every visitor's first paint, to
 * render markup that queries nothing. Two of the three had no consumer outside
 * this library at all.
 *
 * Console consumers deep-import the component they need
 * (`@aglyn/plugins-email/components/...`), which reaches the same module
 * without routing it through the site half's entry point.
 */

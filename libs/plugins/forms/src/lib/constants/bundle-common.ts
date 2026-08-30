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
 * The bundle id, persisted as `pluginId` on every node this bundle places.
 *
 * It is not a label. `requiredSitePlugins` reads `pluginId` off each saved
 * node to decide which bundles must register before first paint, so this
 * string is the answer to "which chunk does this page need in front of the
 * render". A node whose `pluginId` names a bundle that no longer registers
 * its `componentId` still RESOLVES — resolution is by component id alone —
 * but it resolves a beat late, after the post-hydration load of the rest of
 * the enabled set.
 *
 * `tools/scripts/backfill-node-plugin-ids.mjs` is what keeps the two in
 * agreement across a bundle move.
 */
export const BUNDLE_ID = 'forms'

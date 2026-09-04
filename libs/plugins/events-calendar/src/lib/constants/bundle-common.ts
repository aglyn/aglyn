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
 * Rendering resolves by `componentId` alone, so a node naming another bundle
 * still draws — but `requiredSitePlugins` reads `pluginId` to decide which
 * chunks must register before first paint, so one that names the wrong bundle
 * draws LATE. `tools/scripts/backfill-node-plugin-ids.mjs` is what keeps saved
 * nodes agreeing with this string.
 */
export const BUNDLE_ID = 'events-calendar'

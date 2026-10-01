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
 * The scheduled-route guards (AGL-489, AGL-2084), from the data layer where
 * a plugin's scheduled route reaches them too (AGL-3080). Re-exported here so
 * every console route — and every spec that stands this module in — keeps
 * the one path it has always imported.
 */
export { isCronAuthorized, isCronDryRun } from '@aglyn/tenant-data-admin/server/cron-auth'

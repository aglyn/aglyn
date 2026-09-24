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
 * Loading the documents a usage scan searches (AGL-1161), now shared with the
 * tenant (AGL-3113).
 *
 * The reader moved to `@aglyn/tenant-data-admin/server/live-page-usage` when a
 * dataset record write began needing the same corpus from the tenant side — a
 * form submission and an automation step make the same pages stale as a
 * console edit, and the copy is the dangerous part. Screen and layout node
 * trees have two storage forms, and a reader that handles only one reports
 * "used nowhere" while blind to half the corpus, which is precisely the bug
 * AGL-1223 had to fix in the one existing reader.
 *
 * Re-exported here so the three routes and the specs that reach for it by this
 * path keep working.
 */

export {
  readSystemEmailUsageCandidates,
  readUsageCandidates,
  readUsageSources,
  type UsageCandidateRead,
} from '@aglyn/tenant-data-admin/server/live-page-usage'

export { readUsageCandidates as default } from '@aglyn/tenant-data-admin/server/live-page-usage'

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
 * The static edge to the operator-alert pipeline that the plugin-jobs beat
 * defers by RELATIVE path (AGL-3377).
 *
 * nx treats a workspace lib that is ever `import()`ed by its specifier as
 * lazy-loaded everywhere, and `@nx/enforce-module-boundaries` then forbids
 * every static import of `@aglyn/tenant-data-admin` across the app. A
 * relative specifier crosses no project boundary, so deferring THIS file
 * loads the pipeline only when a job failed without recording a lazy edge.
 * Same seam as `report-server-error.ts`.
 */
export { raiseOperatorAlert } from '@aglyn/tenant-data-admin/server/operator-alerts'

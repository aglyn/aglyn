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
 * The system-email renderer lives in `@aglyn/tenant-data-admin` (AGL-3367),
 * where a library or plugin sender can reach it; an app is a place no
 * library may import from, which is how a dozen platform senders ended up
 * mailing plain text with no header or footer. Re-exported here so the
 * console's routes and the specs that mock this path keep one address.
 */
export * from '@aglyn/tenant-data-admin/server/render-system-email'
export { default } from '@aglyn/tenant-data-admin/server/render-system-email'

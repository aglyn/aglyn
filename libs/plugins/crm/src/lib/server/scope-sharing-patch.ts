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

import { crmListFieldsPatch, type CrmListCollection } from '@aglyn/aglyn/app-utils/crm'

/**
 * The CRM's scoped list fields are derived from `visibleTo` (AGL-3321), so a
 * sweep that changes the sites on a record restamps them in the same write,
 * and a site's search finds the record the moment it can see it.
 */
export function crmScopeSharingPatch(
  collection: string,
  next: Record<string, unknown>,
): Record<string, unknown> {
  return crmListFieldsPatch(collection as CrmListCollection, next)
}

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

import { type OrgPermission, permissionRefusalText } from '@aglyn/aglyn/app-utils/org-permissions'
import { DATA_PERMISSIONS } from './data-permissions'

// The keys live in `data-permissions.ts`, which imports only types so that the
// native contracts can assemble them into `ORG_ROLE_GRANTS`.
export {
  DATA_ERASE_PERMISSION,
  DATA_EXPORT_PERMISSION,
  DATA_MANAGE_PERMISSION,
  DATA_PERMISSIONS,
  DATA_SITE_DELETE_PERMISSION,
  DATA_SITE_MANAGE_PERMISSION,
  DATA_SITE_ROLE_PRESET,
  DATA_VIEW_RECORDS_PERMISSION,
} from './data-permissions'

/**
 * The refusal for one of these keys, naming it, from this table rather than the
 * live catalog: a module can ask before the declarations have registered.
 */
export function dataPermissionRefusal(key: string): string {
  const label = DATA_PERMISSIONS.find((permission) => permission.key === key)?.label
  return label ? `Your role does not include "${label}" — ask an organization admin` : permissionRefusalText(key as OrgPermission)
}

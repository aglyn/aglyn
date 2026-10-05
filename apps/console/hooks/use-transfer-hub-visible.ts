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

'use client'

import { useTransferLauncher } from '@aglyn/aglyn/app-utils/transfer-launcher-context'
import { PLUGIN_TRANSFER_RESOURCES_DECLARED } from '@aglyn/aglyn/plugin-manager/first-party-plugins.generated'
import useOrgPermissions from './use-org-permissions'

/**
 * Whether Settings → Import & export is for this person (AGL-3554): anyone
 * who may export something from the workspace — whoever holds `data.manage`,
 * and a member a resource lets read its records (`readableByMembers`, a
 * `readPermission`) on a plan that moves them, as the launcher's `can`
 * answers. The page itself then offers each button only where its route
 * takes it. `false` until the person's permissions have answered.
 */
export function useTransferHubVisible(): boolean {
  const launcher = useTransferLauncher()
  const { can, loaded } = useOrgPermissions()
  if (!loaded) return false
  if (can('data.manage')) return true
  if (!launcher) return false
  return PLUGIN_TRANSFER_RESOURCES_DECLARED.some(
    (one) => one.kinds.includes('records') && launcher.can('export', { resource: one.key, scope: one.scope }),
  )
}

export default useTransferHubVisible

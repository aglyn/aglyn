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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  isServerReleaseFlagOnForOrg,
  memberHasOrgPermission,
} from '@aglyn/tenant-data-admin'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { registerPluginServerDeclarations } from '../../constants/plugins.declarations.server.generated'

/**
 * Will the person creating this site be offered the guided AI start
 * (AGL-3594)? Decides whether the site is born with the starter.
 *
 * The answer is "yes" only when every fact the `hostFirstRun` zone and its
 * widget gate on holds for the site being created, read here from core's
 * side of the boundary rather than from the AI plugin: the workspace's plan
 * includes `aiGenerative`, the generative release flag is on for the org
 * (staff always see it, as the jobs route lets them), the AI plugin runs on
 * a site born with the plugin set this site is born with, and the creator
 * holds `ai.generate`. Any fact that fails — or cannot be read — answers
 * "no", and the site is born with the starter as before: nobody who is not
 * offered the guided start ever lands on an empty site.
 *
 * The plugin is named by its id, the one thing about it core may know.
 */
export const GUIDED_START_PLUGIN_ID = 'ai'

/** The generative release flag the AI jobs route closes on. */
export const GUIDED_START_RELEASE_FLAG = 'release_ai_generative' as const

/** The permission the zone's widget is registered behind. */
export const GUIDED_START_PERMISSION = 'ai.generate'

export async function guidedStartOffered(input: {
  orgId: string
  org: Record<string, unknown> | null | undefined
  /** The plugin opt-ins the new site is born with. */
  host: { enabledPlugins?: string[]; disabledPlugins?: string[] }
  member: Partial<AglynOrgMember> | null | undefined
  staff: boolean
}): Promise<boolean> {
  try {
    // The permission is the AI plugin's catalog key, which this core route
    // knows only through the plugins' declarations (AGL-3596). The boot step
    // registers them per process; registering them here as well, memoized,
    // means the answer never depends on which module graph booted.
    await registerPluginServerDeclarations().catch((error: unknown) => {
      console.error('guided start: plugin declarations failed', { orgId: input.orgId, error })
    })
    if (!checkEntitlement((input.org ?? {}) as never, 'aiGenerative')) return false
    if (!isHostPluginEnabled(input.org as never, input.host, GUIDED_START_PLUGIN_ID)) return false
    if (!input.staff && !(await isServerReleaseFlagOnForOrg(GUIDED_START_RELEASE_FLAG, input.orgId))) {
      return false
    }
    if (!input.staff && !(await memberHasOrgPermission(input.orgId, input.member, GUIDED_START_PERMISSION))) {
      return false
    }
    return true
  } catch (error) {
    console.error('guided start eligibility failed', { orgId: input.orgId, error })
    return false
  }
}

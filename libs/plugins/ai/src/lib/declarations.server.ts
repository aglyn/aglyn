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

// Each registry from its own module, not the `@aglyn/aglyn/server` barrel:
// boot needs three registries rather than the whole server surface, and a
// suite that stubs that barrel wholesale still loads these declarations
// against the real registries.
import {
  listPluginEventHandlers,
  registerPluginEventHandler,
} from '@aglyn/aglyn/plugin-manager/plugin-events'
import {
  listPluginUserErasers,
  registerPluginUserEraser,
} from '@aglyn/aglyn/plugin-manager/plugin-user-erasure'
import {
  listUsageAlertContributors,
  registerUsageAlertContributor,
} from '@aglyn/aglyn/plugin-manager/usage-alert-contributors'
import { AI_PLUGIN_ID } from './constants'
import { registerAiDeclarations } from './declarations'

/** The provider-spend staff alerts' contributor id under the plugin. */
const AI_USAGE_ALERTS_ID = 'provider-spend'

/**
 * The plugin's SERVER declarations (AGL-2939): what the server must know
 * at boot, before any door of the plugin has been called. The two platform
 * events the plugin writes activity for — the AI add-on bought or dropped,
 * an `ai.*` permission moved — are raised by core billing and membership
 * routes that never load the plugin's API surface, so the subscriptions
 * have to be in place from the first request. So does the eraser: an
 * account erasure is a core route too, and a person's AI usage months sit
 * under each org, keyed by the uid, where no core delete reaches them. So
 * does the usage alert contributor (AGL-2984): the usage-alerts sweep is a
 * core cron, and it evaluates the plugin's staff alerts on provider spend for
 * every org it reads.
 *
 * Light at boot by construction: the writers behind the handlers are
 * imported when the first event arrives, and the alert rules when the sweep
 * first evaluates an org, not when the process starts, so the boot cost is
 * the registration and nothing that touches Firestore.
 */
export function registerAiServerDeclarations(): void {
  registerAiDeclarations()
  // Idempotent against each REGISTRY rather than a module flag, so a
  // registry reset (a spec) or a second module instance registers again.
  if (!listPluginEventHandlers('org.seatAddons.changed').includes(AI_PLUGIN_ID)) {
    registerPluginEventHandler(
      'org.seatAddons.changed',
      async ({ orgId, actor, before, after }) => {
        const { logAiAddonChanged } = await import('./activity/ai-activity')
        await logAiAddonChanged(orgId, actor, { before, after })
      },
      { pluginId: AI_PLUGIN_ID },
    )
    registerPluginEventHandler(
      'org.permissions.changed',
      async ({ orgId, actor, subject, permission, granted }) => {
        if (!permission.startsWith('ai.')) return
        const { logAiPermissionChanged } = await import('./activity/ai-activity')
        await logAiPermissionChanged(orgId, actor, { subject, permission, granted })
      },
      { pluginId: AI_PLUGIN_ID },
    )
  }
  if (!listPluginUserErasers().includes(AI_PLUGIN_ID)) {
    registerPluginUserEraser(
      async (request) => {
        const { eraseAiUsageForUser } = await import('./usage/ai-usage-eraser')
        return eraseAiUsageForUser(request)
      },
      { pluginId: AI_PLUGIN_ID },
    )
  }
  if (
    !listUsageAlertContributors().some(
      (contributor) =>
        contributor.pluginId === AI_PLUGIN_ID &&
        contributor.id === AI_USAGE_ALERTS_ID,
    )
  ) {
    registerUsageAlertContributor({
      pluginId: AI_PLUGIN_ID,
      id: AI_USAGE_ALERTS_ID,
      evaluate: async (context) => {
        const { evaluateAiUsageAlerts } = await import('./usage/ai-usage-alerts')
        await evaluateAiUsageAlerts(context)
      },
    })
  }
}

registerAiServerDeclarations()

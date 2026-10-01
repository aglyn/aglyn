/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The container kinds plugins declare (AGL-3080): each plugin's
 * `containers` block in plugins.config.json. Core's `plugin-containers.ts`
 * reads them; core names no kind.
 */

import type { PluginContainerKind } from './plugin-containers'

export const PLUGIN_CONTAINER_KINDS_DECLARED: readonly PluginContainerKind[] = [
  {
    "pluginId": "marketing",
    "kind": "campaign",
    "label": "Campaign",
    "pluralLabel": "Campaigns",
    "ownerLabel": "Marketing",
    "orgCollection": "emailCampaigns",
    "nameField": "name"
  }
]

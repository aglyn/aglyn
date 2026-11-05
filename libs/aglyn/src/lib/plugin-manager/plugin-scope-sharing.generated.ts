/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The collections plugins keep documents shared with all sites except some
 * (AGL-4047): each plugin's `scopeSharingCollections` block in
 * plugins.config.json. Core's `plugin-scope-sharing.ts` reads them.
 */

import type { ResolvedScopeSharingCollection } from './plugin-scope-sharing'

export const PLUGIN_SCOPE_SHARING_COLLECTIONS_DECLARED: readonly ResolvedScopeSharingCollection[] = [
  {
    "pluginId": "crm",
    "name": "contacts",
    "patch": true,
    "maxIncluded": 30,
    "keepSiteFields": [
      "hostId",
      "capturedByHostIds"
    ]
  },
  {
    "pluginId": "crm",
    "name": "leads",
    "patch": true,
    "maxIncluded": 30,
    "keepSiteFields": [
      "hostId",
      "capturedByHostIds"
    ]
  },
  {
    "pluginId": "crm",
    "name": "companies",
    "patch": true,
    "maxIncluded": 30,
    "keepSiteFields": [
      "hostId",
      "capturedByHostIds"
    ]
  },
  {
    "pluginId": "crm",
    "name": "deals",
    "patch": true,
    "maxIncluded": 30,
    "keepSiteFields": [
      "hostId",
      "capturedByHostIds"
    ]
  },
  {
    "pluginId": "crm",
    "name": "crmTasks",
    "patch": true,
    "maxIncluded": 30,
    "keepSiteFields": [
      "hostId",
      "capturedByHostIds"
    ]
  },
  {
    "pluginId": "crm",
    "name": "crmActivities",
    "maxIncluded": 30,
    "keepSiteFields": [
      "hostId",
      "capturedByHostIds"
    ]
  },
  {
    "pluginId": "data",
    "name": "datasets"
  },
  {
    "pluginId": "marketing",
    "name": "emailCampaigns"
  },
  {
    "pluginId": "workflows",
    "name": "automations"
  }
]

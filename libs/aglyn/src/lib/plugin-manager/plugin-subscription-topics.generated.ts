/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The subscription topics plugins declare (AGL-3080): each plugin's
 * `subscriptionTopics` block in plugins.config.json, in preference-page
 * order. Core's `app-utils/subscription-topics.ts` reads them as the
 * built-in floor of every org's topic catalog; core names no stream.
 */

import type { DeclaredSubscriptionTopic } from '../app-utils/subscription-topics'

export const PLUGIN_SUBSCRIPTION_TOPICS_DECLARED: readonly DeclaredSubscriptionTopic[] = [
  {
    "pluginId": "marketing",
    "id": "marketing",
    "name": "Promotions and offers",
    "description": "Sales, discounts and seasonal campaigns.",
    "order": 10,
    "default": true
  },
  {
    "pluginId": "commerce",
    "id": "newsletter",
    "name": "Newsletter",
    "description": "Regular news and stories from us.",
    "order": 20
  },
  {
    "pluginId": "commerce",
    "id": "product-updates",
    "name": "Product updates",
    "description": "New products, restocks and changes to what we offer.",
    "order": 30
  },
  {
    "pluginId": "outreach",
    "id": "sales",
    "name": "Sales outreach",
    "description": "Messages from a person here about working together.",
    "order": 40
  }
]

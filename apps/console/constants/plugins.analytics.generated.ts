/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The plugins' ANALYTICS PROVIDERS (AGL-3080): the adapter each declares
 * under `analyticsProvider`, loaded with `import()` by a document that
 * uses it and registered with core's `analytics-provider.ts`. One of the
 * sanctioned @aglyn/plugins-* references outside libs/plugins (AGL-417).
 * Source of truth: plugins.config.json.
 */
/* eslint-disable @nx/enforce-module-boundaries */

import type { AnalyticsProviderLoader } from '@aglyn/aglyn/app-utils/analytics-provider'

export const ANALYTICS_PROVIDER_LOADERS: readonly AnalyticsProviderLoader[] = [
  {
    pluginId: 'marketing',
    load: () => import('@aglyn/plugins-marketing/analytics-provider'),
  },
]

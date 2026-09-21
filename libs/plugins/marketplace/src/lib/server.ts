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

import {
  registerBillingWebhookHandler,
  registerPluginApiRoute,
  registerCustomFieldType,
} from '@aglyn/aglyn/server'
// Its own subpath, never the plugin-manager barrel: what a published page
// does not need, it must not import.
import { registerPluginRouteMetadata } from '@aglyn/aglyn/plugin-manager/plugin-route-metadata'
import { BUNDLE_ID } from './constants/bundle-common'
import { marketplaceBillingWebhookHandler } from './server/billing-webhook'
import { publishPluginHandler } from './server/publish-plugin'
import { verificationRequestHandler } from './server/verification-request'
import { checkoutHandler } from './server/checkout'
import { connectHandler } from './server/connect'
import { installHandler } from './server/install'
import { installPluginHandler } from './server/install-plugin'
import { listingVersionsHandler } from './server/listing-versions'
import { RATING_FIELD } from './model/rating-field'
import { installDatasetSchemaHandler } from './server/install-dataset-schema'
import { installEmailStarterHandler } from './server/install-email-starter'
import { installEmailTemplateHandler } from './server/install-email-template'
import { installLayoutHandler } from './server/install-layout'
import { installTemplateHandler } from './server/install-template'
import { installThemeHandler } from './server/install-theme'
import { previewImageHandler } from './server/preview-image'
import { publishHandler } from './server/publish'
import { marketplaceAdminReports } from './server/admin-reports'
import { reportHandler } from './server/report'
import { reviewsHandler } from './server/reviews'
import { publisherProfileSaveHandler } from './server/publisher-profile-save'
import { publishDatasetSchemaHandler } from './server/publish-dataset-schema'
import { publishEmailStarterHandler } from './server/publish-email-starter'
import { publishEmailTemplateHandler } from './server/publish-email-template'
import { publishLayoutHandler } from './server/publish-layout'
import { publishTemplateHandler } from './server/publish-template'
import { publishThemeHandler } from './server/publish-theme'
import { updateArtifactHandler } from './server/update-artifact'

/**
 * Registers the marketplace plugin's console-side API routes (AGL-396):
 * marketplace publish/install of templates and plugins, and the Stripe
 * Connect + checkout flows for paid listings.
 *
 * Upload-bodied routes register here too. The note that used to sit here —
 * that they had to stay as named console routes because the dispatcher
 * "can't grant per-route bodyParser limits" — was a Pages Router leftover:
 * `runLegacyHandler` reads the request through the same
 * `pluginRequestFromWeb` a named App Router route would, and imposes no
 * limit of its own. publish-plugin's 8 MB bundle has been going through the
 * dispatcher the whole time.
 */
export function registerMarketplaceConsoleApi(): void {
  // Server side of the rating custom field (AGL-434): validators run
  // on import/write paths even when no client loaded the plugin.
  registerCustomFieldType(RATING_FIELD)
  /*
   * What a listing link unfurls as (AGL-876, handed to the platform by
   * AGL-3080).
   *
   * The card used to be built by a hand-written console route with a server
   * layout of its own, which is what kept that route out of the generic
   * plugin route — moving it would have dropped every listing's card with
   * nothing red. The shell asks this instead, so the card survives the move
   * and no console file reads `marketplaceListings` to build a head.
   *
   * One segment and one only: `/{org}/marketplace/{listingId}`. The hub, the
   * publish page and every other address under this route answer `null`,
   * which leaves the shell's own title exactly as it was.
   */
  registerPluginRouteMetadata(
    {
      route: 'marketplace',
      resolve: async (segments) => {
        if (segments.length !== 1) return null
        const { readListingForSocialCard } = await import(
          './server/listing-social-card.server'
        )
        const { listingSocialCard } = await import('./model/listing-social-card')
        return listingSocialCard(await readListingForSocialCard(segments[0]))
      },
    },
    // Named, because this registrar is called directly by the app's server
    // loader rather than from inside a plugin `register` fn, where the
    // loader's owner marker would be set.
    { pluginId: BUNDLE_ID },
  )
  registerPluginApiRoute('marketplace/checkout', checkoutHandler)
  registerPluginApiRoute('marketplace/connect', connectHandler)
  registerPluginApiRoute('marketplace/install', installHandler)
  registerPluginApiRoute('marketplace/install-plugin', installPluginHandler)
  registerPluginApiRoute('marketplace/install-layout', installLayoutHandler)
  registerPluginApiRoute('marketplace/install-template', installTemplateHandler)
  // A theme install DOES change the running site (AGL-1020) — it is the site's
  // appearance — so this route also owns the ways back: `revert` and `reset`.
  registerPluginApiRoute('marketplace/install-theme', installThemeHandler)
  registerPluginApiRoute(
    'marketplace/install-dataset-schema',
    installDatasetSchemaHandler,
  )
  registerPluginApiRoute(
    'marketplace/install-email-starter',
    installEmailStarterHandler,
  )
  registerPluginApiRoute(
    'marketplace/install-email-template',
    installEmailTemplateHandler,
  )
  // Updating a copied artifact is its own route (AGL-1018), not a flag on
  // install: install writes the publisher's version, this one reconciles it
  // with a copy that has diverged and refuses to overwrite silently.
  registerPluginApiRoute('marketplace/update-artifact', updateArtifactHandler)
  registerPluginApiRoute('marketplace/listing-versions', listingVersionsHandler)
  registerPluginApiRoute('marketplace/preview-image', previewImageHandler)
  registerPluginApiRoute('marketplace/publish', publishHandler)
  registerPluginApiRoute('marketplace/report', reportHandler)
  /*
   * The staff end of that button (AGL-2310), moved out of
   * `apps/console/app/api/admin/` by AGL-3080. `web:` because it is a plain
   * fetch from this plugin's own staff page, not a plugin-request handler —
   * the same shape the AI plugin's `ai/admin/*` routes use, and for the same
   * reason: a staff route names no host, so there is no subject to resolve.
   */
  registerPluginApiRoute('marketplace/admin/reports', {
    web: marketplaceAdminReports,
  })
  registerPluginApiRoute('marketplace/reviews', reviewsHandler)
  registerPluginApiRoute(
    'marketplace/publisher-profile',
    publisherProfileSaveHandler,
  )
  registerPluginApiRoute(
    'marketplace/verification-request',
    verificationRequestHandler,
  )
  registerPluginApiRoute('marketplace/publish-layout', publishLayoutHandler)
  registerPluginApiRoute('marketplace/publish-template', publishTemplateHandler)
  registerPluginApiRoute('marketplace/publish-theme', publishThemeHandler)
  registerPluginApiRoute(
    'marketplace/publish-dataset-schema',
    publishDatasetSchemaHandler,
  )
  registerPluginApiRoute(
    'marketplace/publish-email-starter',
    publishEmailStarterHandler,
  )
  registerPluginApiRoute(
    'marketplace/publish-email-template',
    publishEmailTemplateHandler,
  )
  // Relocated console routes (AGL-418): URLs preserved via the dispatcher.
  registerPluginApiRoute('marketplace/publish-plugin', publishPluginHandler)
  // Marketplace purchases ride the platform Stripe webhook (AGL-418).
  registerBillingWebhookHandler(marketplaceBillingWebhookHandler)
}

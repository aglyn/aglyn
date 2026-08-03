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
import { marketplaceBillingWebhookHandler } from './server/billing-webhook'
import { aiAssistHandler } from './server/ai-assist'
import { publishPluginHandler } from './server/publish-plugin'
import { verificationRequestHandler } from './server/verification-request'
import { checkoutHandler } from './server/checkout'
import { connectHandler } from './server/connect'
import { installHandler } from './server/install'
import { installPluginHandler } from './server/install-plugin'
import { listingVersionsHandler } from './server/listing-versions'
import { RATING_FIELD } from './model/rating-field'
import { installDatasetSchemaHandler } from './server/install-dataset-schema'
import { installEmailTemplateHandler } from './server/install-email-template'
import { installLayoutHandler } from './server/install-layout'
import { installTemplateHandler } from './server/install-template'
import { previewImageHandler } from './server/preview-image'
import { publishHandler } from './server/publish'
import { reportHandler } from './server/report'
import { reviewsHandler } from './server/reviews'
import { publisherProfileSaveHandler } from './server/publisher-profile-save'
import { publishDatasetSchemaHandler } from './server/publish-dataset-schema'
import { publishEmailTemplateHandler } from './server/publish-email-template'
import { publishLayoutHandler } from './server/publish-layout'
import { publishTemplateHandler } from './server/publish-template'
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
  registerPluginApiRoute('marketplace/checkout', checkoutHandler)
  registerPluginApiRoute('marketplace/connect', connectHandler)
  registerPluginApiRoute('marketplace/install', installHandler)
  registerPluginApiRoute('marketplace/install-plugin', installPluginHandler)
  registerPluginApiRoute('marketplace/install-layout', installLayoutHandler)
  registerPluginApiRoute('marketplace/install-template', installTemplateHandler)
  registerPluginApiRoute(
    'marketplace/install-dataset-schema',
    installDatasetSchemaHandler,
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
  registerPluginApiRoute(
    'marketplace/publish-dataset-schema',
    publishDatasetSchemaHandler,
  )
  registerPluginApiRoute(
    'marketplace/publish-email-template',
    publishEmailTemplateHandler,
  )
  // Relocated console routes (AGL-418): URLs preserved via the dispatcher.
  registerPluginApiRoute('marketplace/publish-plugin', publishPluginHandler)
  registerPluginApiRoute('ai/assist', aiAssistHandler)
  // Marketplace purchases ride the platform Stripe webhook (AGL-418).
  registerBillingWebhookHandler(marketplaceBillingWebhookHandler)
}

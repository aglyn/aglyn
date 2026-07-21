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
import { communityBillingWebhookHandler } from './server/billing-webhook'
import { aiAssistHandler } from './server/ai-assist'
import { publishPluginHandler } from './server/publish-plugin'
import { checkoutHandler } from './server/checkout'
import { connectHandler } from './server/connect'
import { installHandler } from './server/install'
import { installPluginHandler } from './server/install-plugin'
import { listingVersionsHandler } from './server/listing-versions'
import { RATING_FIELD } from './model/rating-field'
import { installTemplateHandler } from './server/install-template'
import { publishHandler } from './server/publish'
import { publisherProfileSaveHandler } from './server/publisher-profile-save'
import { publishTemplateHandler } from './server/publish-template'

/**
 * Registers the community plugin's console-side API routes (AGL-396):
 * marketplace publish/install of templates and plugins, and the Stripe
 * Connect + checkout flows for paid listings. The upload-bodied routes
 * (publish-plugin's 8 MB bundle, preview-image's 3 MB image) stay as named
 * console routes — the shared body-parsed dispatcher can't grant per-route
 * bodyParser limits.
 */
export function registerCommunityConsoleApi(): void {
  // Server side of the rating custom field (AGL-434): validators run
  // on import/write paths even when no client loaded the plugin.
  registerCustomFieldType(RATING_FIELD)
  registerPluginApiRoute('community/checkout', checkoutHandler)
  registerPluginApiRoute('community/connect', connectHandler)
  registerPluginApiRoute('community/install', installHandler)
  registerPluginApiRoute('community/install-plugin', installPluginHandler)
  registerPluginApiRoute('community/install-template', installTemplateHandler)
  registerPluginApiRoute('community/listing-versions', listingVersionsHandler)
  registerPluginApiRoute('community/publish', publishHandler)
  registerPluginApiRoute(
    'community/publisher-profile',
    publisherProfileSaveHandler,
  )
  registerPluginApiRoute('community/publish-template', publishTemplateHandler)
  // Relocated console routes (AGL-418): URLs preserved via the dispatcher.
  registerPluginApiRoute('community/publish-plugin', publishPluginHandler)
  registerPluginApiRoute('ai/assist', aiAssistHandler)
  // Marketplace purchases ride the platform Stripe webhook (AGL-418).
  registerBillingWebhookHandler(communityBillingWebhookHandler)
}

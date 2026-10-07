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

import type { MarketingProviderId } from '../model/connections'
import { createAttentiveProvider } from './attentive'
import type { ProviderHttp } from './http'
import { createKlaviyoProvider } from './klaviyo'
import { createMailchimpProvider } from './mailchimp'
import { createOmnisendProvider } from './omnisend'
import type { MarketingProvider } from './provider'

/** Every adapter, by provider id (AGL-3639). Which ones a page OFFERS is the server config's. */
export function createMarketingProvider(id: MarketingProviderId, http: ProviderHttp): MarketingProvider {
  switch (id) {
    case 'mailchimp':
      return createMailchimpProvider(http)
    case 'klaviyo':
      return createKlaviyoProvider(http)
    case 'omnisend':
      return createOmnisendProvider(http)
    case 'attentive':
      return createAttentiveProvider(http)
  }
}

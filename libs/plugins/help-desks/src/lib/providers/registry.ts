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

import type { HelpDeskProviderId } from '../model/connections'
import { createGladlyProvider } from './gladly'
import { createGorgiasProvider } from './gorgias'
import type { ProviderHttp } from './http'
import { createKustomerProvider } from './kustomer'
import type { HelpDeskProvider } from './provider'
import { createReamazeProvider } from './reamaze'
import { createRichpanelProvider } from './richpanel'

/** Every adapter, by provider id (AGL-3824). */
export function createHelpDeskProvider(id: HelpDeskProviderId, http: ProviderHttp): HelpDeskProvider {
  switch (id) {
    case 'gorgias':
      return createGorgiasProvider(http)
    case 'reamaze':
      return createReamazeProvider(http)
    case 'kustomer':
      return createKustomerProvider(http)
    case 'gladly':
      return createGladlyProvider(http)
    case 'richpanel':
      return createRichpanelProvider(http)
  }
}

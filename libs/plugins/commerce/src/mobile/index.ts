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

/**
 * Commerce's mobile entry (`@aglyn/plugins-commerce/mobile`). Reached only
 * through the generated mobile manifests, never re-exported from a web entry,
 * so no byte of it reaches a web bundle (check-mobile-isolation).
 *
 * `registerCommercePosMobile` is Aglyn POS's registrar (AGL-3618), named by
 * the plugin's `mobile.pos` block: the register, and the card reader's server
 * side as the foundation's card-reader backend.
 */

import { MOBILE_CARD_READER_BACKEND, registerMobileScreen, registerMobileService, registerMobileTab } from '@aglyn/mobile-plugin-host'
import { commerceCardReaderBackend } from './pos/card-reader-backend'
import { POS_REGISTER_SCREEN } from './pos/screen-ids'

export { POS_REGISTER_SCREEN }

export function registerCommercePosMobile(): void {
  registerMobileScreen({
    pluginId: 'commerce',
    id: POS_REGISTER_SCREEN,
    title: 'Register',
    requiresSite: true,
    load: () => import('./pos/register-screen'),
  })
  registerMobileTab({
    pluginId: 'commerce',
    id: 'commerce.pos.register',
    title: 'Register',
    icon: 'calculator-outline',
    screen: POS_REGISTER_SCREEN,
    order: 10,
  })
  registerMobileService(MOBILE_CARD_READER_BACKEND, commerceCardReaderBackend)
}

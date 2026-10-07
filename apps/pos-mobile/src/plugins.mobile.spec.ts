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

jest.mock('firebase/firestore', () => ({}))

import {
  getMobileTabs,
  loadMobilePlugins,
  MOBILE_CARD_READER_BACKEND,
  resetMobileRegistry,
  resetMobileServices,
  resolveMobileService,
} from '@aglyn/mobile-plugin-host'
import { MOBILE_PLUGIN_MANIFEST } from './plugins.mobile.generated'

/**
 * Aglyn POS's manifest (AGL-3618): every plugin it names loads and registers
 * exactly what its `mobile.pos` block declares, the register comes first,
 * and some plugin provides the card reader's server side.
 */
describe('the Aglyn POS plugin manifest', () => {
  beforeEach(() => {
    resetMobileRegistry()
    resetMobileServices()
  })

  it('loads every plugin it names, with no failures', async () => {
    const result = await loadMobilePlugins(MOBILE_PLUGIN_MANIFEST)
    expect(result.failed).toEqual([])
    expect(result.loaded).toEqual(MOBILE_PLUGIN_MANIFEST.map((entry) => entry.id))
    expect(getMobileTabs().map((tab) => tab.id)).toEqual(['commerce.pos.register', 'bookings.pos.today'])
    expect(resolveMobileService(MOBILE_CARD_READER_BACKEND)).toBeDefined()
  })
})

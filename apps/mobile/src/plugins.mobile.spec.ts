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

import { loadMobilePlugins, resetMobileRegistry } from '@aglyn/mobile-plugin-host'
import { MOBILE_PLUGIN_MANIFEST } from './plugins.mobile.generated'

/**
 * Every plugin in the generated mobile manifest loads, and registers exactly
 * what its `mobile` block in plugins.config.json declares (AGL-3620): the
 * loader refuses an undeclared registration and reports a declared one that
 * never registered, so a red here names the plugin and the id.
 */
describe('the mobile plugin manifest', () => {
  beforeEach(() => resetMobileRegistry())

  it('loads every plugin it names, with no failures', async () => {
    const result = await loadMobilePlugins(MOBILE_PLUGIN_MANIFEST)
    expect(result.failed).toEqual([])
    expect(result.loaded).toEqual(MOBILE_PLUGIN_MANIFEST.map((entry) => entry.id))
  })
})

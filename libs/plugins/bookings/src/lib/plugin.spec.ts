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

import * as Aglyn from '@aglyn/aglyn'
import { BUNDLE_ID } from './constants/bundle-common'
import { BOOKINGS_BUNDLE, registerBookingsPlugin } from './plugin'

describe('bookings plugin', () => {
  it('keeps the persisted booking component id', () => {
    // The id is stored in screen docs — never rename (moved from mui, AGL-395).
    expect(BOOKINGS_BUNDLE.map((entry) => entry.schema.$id)).toContain(
      'booking',
    )
  })

  it('registers a mui-dependent bundle + console extension once', () => {
    registerBookingsPlugin()
    const bundle = Aglyn.plugins.getDependency(BUNDLE_ID)
    expect(bundle?.dependencies).toMatchObject({ [Aglyn.MUI_BUNDLE_ID]: true })
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect(extension?.featureFlag).toBe('bookings')
    registerBookingsPlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBe(bundle)
  })
})

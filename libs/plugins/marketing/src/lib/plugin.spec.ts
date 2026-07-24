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
import { registerMarketingConsole } from './plugin'

describe('marketing plugin', () => {
  it('registers a console-only, always-on Marketing page', () => {
    registerMarketingConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect(extension?.featureFlag).toBeUndefined()
    expect(extension?.navItems?.[0]?.href).toBe('/marketing')
    expect(extension?.navItems?.[0]?.Component).toBeDefined()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeUndefined()
  })
})

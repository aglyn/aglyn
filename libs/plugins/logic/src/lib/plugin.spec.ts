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
import { pluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerLogicConsole } from './plugin'

describe('logic plugin', () => {
  it('registers a console-only, always-on Logic page', () => {
    registerLogicConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    // Not release-flagged: no entitlement gate on the surface.
    expect(extension?.featureFlag).toBeUndefined()
    expect(extension?.navItems?.[0]?.href).toBe('/logic')
    expect(extension?.navItems?.[0]?.Component).toBeDefined()
    // Console-only: it contributes no besigner/canvas bundle.
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeUndefined()
  })
})

describe('the zones its Functions & Variables page hosts (AGL-3603)', () => {
  it('declares each under the id widgets register for, owned here and laid out bare', () => {
    registerLogicConsole()
    for (const id of ['hostLogic', 'logicFunctionEditor', 'logicReferenceIssue']) {
      const zone = pluginZone(id)
      expect(`${id}: ${zone?.pluginId} ${zone?.layout} ${zone?.surface}`).toBe(`${id}: ${BUNDLE_ID} bare console`)
    }
    // The shell's catalog does not name them: the plugin that draws them says what they are.
    const catalog = Object.values(Aglyn.CONSOLE_WIDGET_SLOTS) as string[]
    expect(catalog.filter((id) => id === 'hostLogic' || id.startsWith('logic'))).toEqual([])
  })
})

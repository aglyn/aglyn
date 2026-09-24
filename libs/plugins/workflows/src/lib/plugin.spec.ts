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
import { registerWorkflowsConsole } from './plugin'

describe('workflows plugin', () => {
  it('registers a console-only Workflows page gated by the entitlement', () => {
    registerWorkflowsConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect(extension?.featureFlag).toBe('workflows')
    expect(extension?.navItems?.[0]?.href).toBe('/automation')
    expect(extension?.navItems?.[0]?.Component).toBeDefined()
    // Console-only: it contributes no besigner/canvas bundle.
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeUndefined()
  })

  it('mounts the same page at the organization, org automations first (AGL-3302)', () => {
    registerWorkflowsConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    const [orgItem] = extension?.orgNavItems ?? []
    expect(orgItem?.href).toBe('/automation')
    // The site tab's release flag gates both levels.
    expect(orgItem?.navTabId).toBe(extension?.navItems?.[0]?.navTabId)
    expect(orgItem?.Component).toBe(extension?.navItems?.[0]?.Component)
    expect(orgItem?.sections?.map((section) => section.id)).toEqual([
      'automations',
      'workflows',
      'actions',
      'webhooks',
    ])
    // Built from the actions builder's steps, so it takes that plan's flag.
    expect(orgItem?.sections?.[0]?.featureFlag).toBe('actions')
  })
})

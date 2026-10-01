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

describe('the zones its Automation page hosts (AGL-2919, AGL-3080)', () => {
  it('declares each under the id widgets register for, owned here and laid out bare', () => {
    registerWorkflowsConsole()
    for (const id of ['hostAutomations', 'automationEditor', 'automationRun']) {
      const zone = pluginZone(id)
      // A button beside Add action, one inside an open editor, one on a failed
      // run's row: the page places each, so a wrapper would add a gap it
      // already has.
      expect(`${id}: ${zone?.pluginId} ${zone?.layout} ${zone?.surface}`).toBe(
        `${id}: ${BUNDLE_ID} bare console`,
      )
    }
    // The shell's catalog no longer names them: the plugin that draws them
    // says what they are.
    const catalog = Object.values(Aglyn.CONSOLE_WIDGET_SLOTS) as string[]
    expect(catalog.filter((id) => id.startsWith('automation') || id === 'hostAutomations')).toEqual([])
  })
})

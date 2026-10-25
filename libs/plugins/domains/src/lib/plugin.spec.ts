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

import { listConsoleExtensions } from '@aglyn/aglyn'
import { registerDomainsConsole } from './plugin'

describe('domains plugin', () => {
  it('puts its cards on the Custom Domain page, behind custom domains', () => {
    registerDomainsConsole()
    const extension = listConsoleExtensions().find(
      (entry) => entry.pluginId === 'domains',
    )
    const slots = (extension?.widgets ?? []).map((widget) => [
      widget.slot,
      widget.featureFlag,
    ])
    expect(slots).toEqual([
      ['hostDomain', 'customDomain'],
      ['hostDomainConnect', 'customDomain'],
    ])
  })

  it('adds the workspace Domains page, every name beneath it, with no plan gate (AGL-4040)', () => {
    registerDomainsConsole()
    const extension = listConsoleExtensions().find((entry) => entry.pluginId === 'domains')
    expect(extension?.featureFlag).toBeUndefined()
    expect(extension?.orgNavItems).toEqual([
      expect.objectContaining({ label: 'Domains', href: '/domains', ownsSubtree: true }),
    ])
    expect(extension?.navItems ?? []).toEqual([])
  })
})

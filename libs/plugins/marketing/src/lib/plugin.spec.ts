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

  /**
   * The registry is what makes a section a ROUTE.
   *
   * The shell resolves `/marketing/{id}` against this declaration and 404s an
   * id it does not find, so a page that switches on `campaigns` is reachable
   * only if `campaigns` is declared here. The page's own specs pass the
   * section id in directly — they are testing the body, not the routing — and
   * would go on passing with the section removed from the rail, which is a
   * surface nobody can navigate to.
   */
  it('declares campaigns as a routed section', () => {
    registerMarketingConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    const sections = extension?.navItems?.[0]?.sections ?? []
    expect(sections.map((section) => section.id)).toContain('campaigns')
    expect(
      sections.find((section) => section.id === 'campaigns')?.label,
    ).toBe('Campaigns')
  })

  /*
   * ANTI-VACUITY. The reading above is "the list contains an id", which an
   * empty list cannot satisfy but a list of one could be gamed into — this is
   * the reading that says the rail is the whole rail.
   */
  it('CONTROL: the rail is the surface’s own, in its own order', () => {
    registerMarketingConsole()
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect(
      (extension?.navItems?.[0]?.sections ?? []).map((section) => section.id),
    ).toEqual([
      'overview',
      'campaigns',
      'conversions',
      'overlays',
      'experiments',
    ])
  })
})

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
import { registerInboxConsole } from './plugin'

const inboxExtension = () =>
  Aglyn.listConsoleExtensions().find((entry) => entry.pluginId === BUNDLE_ID)

describe('inbox plugin', () => {
  it('registers a console-only Inbox page', () => {
    registerInboxConsole()
    const extension = inboxExtension()
    expect(extension?.navItems?.[0]?.href).toBe('/inbox')
    expect(extension?.navItems?.[0]?.Component).toBeDefined()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeUndefined()
  })

  /**
   * The organization's Inbox (AGL-3303): the same page at `/[orgSlug]/inbox`,
   * behind the SAME release flag as the site's — one tab id holds both — with
   * the same sections, of which only Members & leads asks for more.
   */
  it('registers the organization’s Inbox as the same page, behind the site tab’s flag', () => {
    registerInboxConsole()
    const extension = inboxExtension()
    const site = extension?.navItems?.[0]
    const org = extension?.orgNavItems?.[0]
    expect(extension?.orgNavItems).toHaveLength(1)
    expect(org?.href).toBe('/inbox')
    expect(org?.navTabId).toBe(site?.navTabId)
    expect(org?.Component).toBe(site?.Component)
    expect(org?.sections?.map((section) => section.id)).toEqual(
      site?.sections?.map((section) => section.id),
    )
    expect(
      org?.sections?.map((section) => [section.id, section.permission ?? null]),
    ).toEqual([
      ['submissions', null],
      // Without a site it lists the org's leads, which the rules admit on
      // `data.manage` — so the rail stops offering a refused table.
      ['contacts', 'data.manage'],
      ['campaigns', null],
    ])
    // The site rail asks for nothing more than the surface does.
    expect(site?.sections?.every((section) => !section.permission)).toBe(true)
  })
})

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

import { getPluginConfigSchema } from '@aglyn/aglyn/plugin-manager/plugin-config'
import {
  labelContactSource,
  pluginContactSource,
} from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { narrowPermissionsToSite, siteNarrowingFor } from '@aglyn/aglyn/app-utils/host-permissions'
import { resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { WAIVERS_CONTACT_SOURCE, WAIVERS_PERMISSIONS, WAIVERS_PLUGIN_ID } from './constants/bundle-common'
import { WAIVERS_PERMISSION_DECLARATIONS } from './constants/permissions'
import { registerWaiversDeclarations } from './declarations'

/**
 * Waivers' light declarations (AGL-4042), which the console's browser and
 * both servers load before anything renders: the CRM capture door a
 * signature files a person under, so the CRM reads a signer's source as the
 * plugin's label rather than the raw word `waiver`.
 */
describe('registerWaiversDeclarations', () => {
  it('declares the waiver capture door with its label and link', () => {
    registerWaiversDeclarations()
    expect(pluginContactSource(WAIVERS_CONTACT_SOURCE)).toEqual({
      source: 'waiver',
      label: 'Waiver signed',
      openLabel: 'Open waiver',
      pluginId: WAIVERS_PLUGIN_ID,
    })
  })

  it('so a contact a signature created reads by its label', () => {
    expect(labelContactSource('waiver')).toBe('Waiver signed')
  })

  it('declares the settings the eraser and the retention job read: years kept after an erasure request', () => {
    registerWaiversDeclarations()
    expect(getPluginConfigSchema(WAIVERS_PLUGIN_ID)).toMatchObject({
      pluginId: 'waivers',
      defaults: { retentionYears: 7 },
      help: { topic: 'waivers', anchor: '#keeping-signed-waivers' },
    })
  })
})

/**
 * Waivers are a site's own (AGL-4047): an editor of the whole workspace
 * given Viewer access to one site neither takes nor manages that site's
 * waivers, unless the site grants it, and keeps both on every other site.
 */
describe('a site narrows its waivers (AGL-4047)', () => {
  const narrowed = { role: 'editor' as const, allHosts: true, hostAccess: { 'site-a': 'viewer' as const } }
  const onSite = (member: typeof narrowed & { hostPermissions?: Record<string, Record<string, boolean>> }, hostId: string) =>
    narrowPermissionsToSite(resolveOrgPermissions(member, null), siteNarrowingFor(member, hostId))

  it('declares both keys narrowed per site', () => {
    registerWaiversDeclarations()
    expect(WAIVERS_PERMISSION_DECLARATIONS.every((entry) => entry.narrowsPerSite === true)).toBe(true)
  })

  it('takes neither on the narrowed site, both on another', () => {
    registerWaiversDeclarations()
    const here = onSite(narrowed, 'site-a')
    expect(here[WAIVERS_PERMISSIONS.collect]).toBe(false)
    expect(here[WAIVERS_PERMISSIONS.manage]).toBe(false)
    const there = onSite(narrowed, 'site-b')
    expect(there[WAIVERS_PERMISSIONS.collect]).toBe(true)
    expect(there[WAIVERS_PERMISSIONS.manage]).toBe(true)
  })

  it('a site that grants collecting back lets them take signatures there, and not manage', () => {
    registerWaiversDeclarations()
    const here = onSite({ ...narrowed, hostPermissions: { 'site-a': { [WAIVERS_PERMISSIONS.collect]: true } } }, 'site-a')
    expect(here[WAIVERS_PERMISSIONS.collect]).toBe(true)
    expect(here[WAIVERS_PERMISSIONS.manage]).toBe(false)
  })
})

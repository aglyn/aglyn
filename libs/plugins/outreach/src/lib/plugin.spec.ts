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

import {
  FIRST_PARTY_PLUGINS,
  getReleaseFlagDefinition,
  listConsoleExtensions,
  listPluginPermissions,
  ORG_PERMISSION_KEYS,
  orgRoleTier,
  PLAN_ENTITLEMENTS,
  resolveRolePermissions,
} from '@aglyn/aglyn'
import { OUTREACH_CONSOLE_SECTIONS } from './components/outreach-console-sections'
import {
  OUTREACH_PLUGIN_ID,
  OUTREACH_USE_PERMISSION,
} from './constants/bundle-common'
import { registerOutreachConsole } from './plugin'

const registered = () =>
  listConsoleExtensions().find((entry) => entry.pluginId === OUTREACH_PLUGIN_ID)

describe('outreach plugin (AGL-2974)', () => {
  it('registers ONE organization-level surface and no site surface', () => {
    registerOutreachConsole()
    const extension = registered()
    expect(extension?.navItems ?? []).toEqual([])
    expect(extension?.orgNavItems).toHaveLength(1)
    const [navItem] = extension?.orgNavItems ?? []
    expect(navItem.href).toBe('/outreach')
    expect(navItem.Component).toBeDefined()
    expect(navItem.header?.docsTopic).toBe('outreach')
  })

  it('declares Sequences, Mailboxes and Compliance, from the one list the page switches on', () => {
    registerOutreachConsole()
    const sections = registered()?.orgNavItems?.[0]?.sections
    expect(sections).toBe(OUTREACH_CONSOLE_SECTIONS)
    expect(sections?.map((section) => section.id)).toEqual([
      'sequences',
      'mailboxes',
      'compliance',
    ])
  })

  /**
   * The three gates, each named where the shell reads it. A registration
   * that dropped any one of them would put the surface in front of a reader
   * the scaffold promises it is hidden from.
   */
  it('is released by release_outreach, which ships OFF', () => {
    registerOutreachConsole()
    const flag = getReleaseFlagDefinition('release_outreach')
    expect(registered()?.orgNavItems?.[0]?.navTabId).toBe(flag.navTabId)
    expect(flag.defaultEnabled).toBe(false)
    expect(
      FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === OUTREACH_PLUGIN_ID)
        ?.releaseFlag,
    ).toBe('release_outreach')
  })

  it('is entitled by features.outreach, which no plan carries', () => {
    registerOutreachConsole()
    expect(registered()?.featureFlag).toBe('outreach')
    for (const [plan, entitlements] of Object.entries(PLAN_ENTITLEMENTS)) {
      expect(`${plan}:${entitlements.features.outreach}`).toBe(`${plan}:false`)
    }
    // The refusal speaks for itself rather than calling Outreach an add-on.
    expect(registered()?.upgradeNotice?.message).toBeTruthy()
    expect(registered()?.upgradeNotice?.billingAnchor).toBeUndefined()
  })

  it('is opened by outreach.use, a plugin-declared key owners and admins hold', () => {
    registerOutreachConsole()
    expect(registered()?.permission).toBe(OUTREACH_USE_PERMISSION)
    // Declared by the plugin, not the catalog: the shell answers it from the
    // resolved map, where plugin keys ride.
    expect(ORG_PERMISSION_KEYS as readonly string[]).not.toContain(
      OUTREACH_USE_PERMISSION,
    )
    expect(
      listPluginPermissions().find((entry) => entry.key === OUTREACH_USE_PERMISSION)
        ?.label,
    ).toBe('Use Sequences')
    // Through the tier the console and the server both resolve a role onto,
    // which is where `owner` becomes the admin tier.
    const holds = (role: string) =>
      resolveRolePermissions(orgRoleTier(role))[OUTREACH_USE_PERMISSION]
    expect(holds('owner')).toBe(true)
    expect(holds('admin')).toBe(true)
    expect(holds('editor')).toBe(false)
    expect(holds('viewer')).toBe(false)
  })
})

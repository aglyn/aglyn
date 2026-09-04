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
import { registerContactsConsole } from './plugin'

const registered = () =>
  Aglyn.listConsoleExtensions().find((entry) => entry.pluginId === BUNDLE_ID)

describe('contacts plugin', () => {
  it('registers a console-only Contacts page gated by the nav tab', () => {
    registerContactsConsole()
    const extension = registered()
    expect(extension?.navItems?.[0]?.href).toBe('/contacts')
    expect(extension?.navItems?.[0]?.navTabId).toBe('nav-tab-contacts')
    expect(extension?.navItems?.[0]?.Component).toBeDefined()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeUndefined()
  })

  /**
   * The CRM declares who may open it.
   *
   * `navTabId` above is a release flag — `FeatureGate` reads it as
   * `released || isStaff`, so it says whether the surface has shipped and
   * nothing about the reader's standing. This registration carried no
   * authorization field of any kind, which on org-shared people data meant
   * membership of the organization was the whole gate.
   */
  it('declares the permission the shell enforces before mounting it', () => {
    registerContactsConsole()
    expect(registered()?.permission).toBe('data.manage')
  })

  /**
   * Named from the catalog, so a role editor can actually grant and revoke
   * it. A key outside `ORG_PERMISSION_KEYS` and outside the plugin registry
   * is refused by the shell, which would take the surface offline for
   * everybody — and a key nobody can grant is not a permission.
   */
  it('names a key the permission catalog carries', () => {
    registerContactsConsole()
    const permission = registered()?.permission as Aglyn.OrgPermission
    expect(Aglyn.ORG_PERMISSION_KEYS).toContain(permission)
    // The population it admits: the tiers the Firestore rules already let
    // write contacts (`canWriteOrgData` is owner/admin/editor), and not the
    // viewer tier.
    expect(Aglyn.DEFAULT_ROLE_PERMISSIONS.owner[permission]).toBe(true)
    expect(Aglyn.DEFAULT_ROLE_PERMISSIONS.admin[permission]).toBe(true)
    expect(Aglyn.DEFAULT_ROLE_PERMISSIONS.editor[permission]).toBe(true)
    expect(Aglyn.DEFAULT_ROLE_PERMISSIONS.viewer[permission]).toBe(false)
  })
})

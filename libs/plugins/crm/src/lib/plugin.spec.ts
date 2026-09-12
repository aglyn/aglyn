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
import { CRM_CONSOLE_SECTIONS } from './components/crm-console-sections'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerCrmConsole } from './plugin'

const registered = () =>
  Aglyn.listConsoleExtensions().find((entry) => entry.pluginId === BUNDLE_ID)

describe('crm plugin', () => {
  it('registers a console-only Contacts page gated by the nav tab', () => {
    registerCrmConsole()
    const extension = registered()
    expect(extension?.navItems?.[0]?.href).toBe('/crm')
    expect(extension?.navItems?.[0]?.legacyHrefs).toEqual(['/contacts'])
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
    registerCrmConsole()
    expect(registered()?.permission).toBe('data.manage')
  })

  /**
   * Named from the catalog, so a role editor can actually grant and revoke
   * it. A key outside `ORG_PERMISSION_KEYS` and outside the plugin registry
   * is refused by the shell, which would take the surface offline for
   * everybody — and a key nobody can grant is not a permission.
   */
  it('names a key the permission catalog carries', () => {
    registerCrmConsole()
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

  /**
   * The hub's sections are declared ON the nav item, from the one list the
   * page also switches on (AGL-2595). A registration that forgot them would
   * leave `/contacts/deals` a 404 while the page still had a Deals branch;
   * a second list would let the two drift apart.
   */
  it('declares the eight CRM sections on the nav item, contacts first and settings last', () => {
    registerCrmConsole()
    const sections = registered()?.navItems?.[0]?.sections
    expect(sections).toBe(CRM_CONSOLE_SECTIONS)
    expect(sections?.map((section) => section.id)).toEqual([
      'contacts',
      'leads',
      'companies',
      'deals',
      'tasks',
      'reports',
      'fields',
      'settings',
    ])
    // The bare `/contacts` lands on the first section a reader may open, so
    // on every plan that opens the CRM the people list has to be first: it
    // is the v1 page every existing link points at.
    expect(sections?.[0]?.label).toBe('Contacts')
    // Settings is where a settings entry sits in every hub — after the work
    // (AGL-2613). The rail decides where a bare `/crm` lands, so a settings
    // page anywhere but last would be a landing page for somebody.
    expect(sections?.[sections.length - 1]?.label).toBe('Settings')
    // No section declares its own flag — all of them ship with the surface
    // and inherit `release_crm` from the nav item.
    expect(sections?.every((section) => !section.navTabId)).toBe(true)
  })

  /**
   * The CRM is paid-only (AGL-2851), so the plan is asked once, of the whole
   * hub: declared on the extension, the shell refuses every surface it
   * registers on a plan without the CRM — the hub body, every section and
   * record, the dashboard cards. No section declares a flag of its own; one
   * could only narrow a gate that already covers it.
   */
  it('gates the extension on the CRM, and no section on a flag of its own', () => {
    registerCrmConsole()
    const extension = registered()
    expect(extension?.featureFlag).toBe('crm')
    const sections = extension?.navItems?.[0]?.sections ?? []
    expect(sections.filter((section) => section.featureFlag != null)).toEqual([])
    // …and the flag really splits the plans the way the decision says.
    expect(Aglyn.PLAN_ENTITLEMENTS.free.features.crm).toBe(false)
    expect(Aglyn.PLAN_ENTITLEMENTS.starter.features.crm).toBe(true)
  })
})

/**
 * THE CRM RAIL AS IT SHIPS, BY PLAN (AGL-2851).
 *
 * The sections as registered, judged the way the console shell judges them:
 * a section is locked when `checkEntitlement` refuses the flag its extension
 * declares or the flag it declares itself, and a bare `/crm` lands on the
 * first section left open — on none, when every one is locked, which the
 * shell answers with the upgrade notice. Every section is visible to every
 * reader, because none declares a release flag of its own. Asserted here
 * because an app never imports a plugin; the console's `plugin-hub-sections`
 * spec pins the shell's half on a fixture of this shape.
 */
describe('the CRM rail as it ships, by plan (AGL-2851)', () => {
  const refuses = (org: unknown, flag: Aglyn.ConsoleNavSection['featureFlag']) =>
    flag != null && Aglyn.checkEntitlement(org as never, flag) !== true
  const rail = (org: unknown) => {
    registerCrmConsole()
    const extension = registered()
    return (extension?.navItems?.[0]?.sections ?? []).map((section) => ({
      id: section.id,
      locked: refuses(org, extension?.featureFlag) || refuses(org, section.featureFlag),
    }))
  }
  const lockedIds = (org: unknown) =>
    rail(org)
      .filter((section) => section.locked)
      .map((section) => section.id)
  const landing = (org: unknown) => rail(org).find((section) => !section.locked)?.id

  it('locks every section on Free, Leads included, and lands nowhere', () => {
    const free = { $id: 'org-1', plan: 'free' }
    expect(lockedIds(free)).toEqual([
      'contacts',
      'leads',
      'companies',
      'deals',
      'tasks',
      'reports',
      'fields',
      'settings',
    ])
    expect(landing(free)).toBeUndefined()
  })

  it('opens every section on Starter and lands a bare /crm on Contacts', () => {
    const starter = { $id: 'org-1', plan: 'starter', subscription: { status: 'active' } }
    expect(lockedIds(starter)).toEqual([])
    expect(landing(starter)).toBe('contacts')
  })

  it('reads a dead subscription as Free and a per-org grant on Free as the CRM', () => {
    expect(landing({ plan: 'pro', billingStatus: 'canceled' })).toBeUndefined()
    expect(landing({ plan: 'free', entitlements: { features: { crm: true } } })).toBe('contacts')
  })
})

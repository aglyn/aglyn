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
import {
  COMMERCE_BUNDLE,
  registerCommerceConsole,
  registerCommercePlugin,
} from './plugin'

describe('commerce plugin', () => {
  it('registers once as a mui-dependent bundle', () => {
    registerCommercePlugin()
    const bundle = Aglyn.plugins.getDependency(BUNDLE_ID)
    expect(bundle?.$id).toBe(BUNDLE_ID)
    expect(bundle?.dependencies).toMatchObject({ [Aglyn.MUI_BUNDLE_ID]: true })
    // Idempotent: a second call is a no-op, not a duplicate.
    registerCommercePlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBe(bundle)
  })

  it('keeps every bundled component id unique and stable-looking', () => {
    const ids = COMMERCE_BUNDLE.map((entry) => entry.schema.$id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('lets nothing become a container by accident (AGL-1389)', () => {
    // Same guard the mui bundle is held to. Every id below was checked
    // against its renderer; everything else in this bundle is a self-closing
    // widget, and a new one that is not says so on its schema or turns this
    // red. See `auditChildContract` for why this is an inventory rather than
    // an exemption list.
    expect(Aglyn.auditChildContract(COMMERCE_BUNDLE, ['gate'])).toEqual([])
  })

  it('keeps every container’s children through compose (AGL-1389)', () => {
    expect(
      Aglyn.auditComposeChildSurvival(
        Aglyn.listAcceptingComponentIds(COMMERCE_BUNDLE),
      ),
    ).toEqual([])
  })

  it('authors preset styling on `sx`, never inside props (AGL-1346)', () => {
    // Same rule the mui bundle is held to: `props.sx` renders but the
    // Styles panel edits `node.sx`, so styling authored into props is
    // styling no click can change or clear. The renderer composes
    // `node.sx` last, so this is a pure relocation.
    const offenders: string[] = []
    for (const entry of COMMERCE_BUNDLE) {
      for (const preset of entry.presets ?? []) {
        const walk = (node: any) => {
          if (node?.props && 'sx' in node.props) {
            offenders.push(`${preset.$id} → ${node.componentId}`)
          }
          for (const child of node?.nodes ?? []) walk(child)
        }
        walk(preset.data)
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * The register declares who may open it; the catalog beside it does not.
 *
 * These assert the DECLARATION. What the shell does with it is proved at the
 * route in `apps/console/specs/plugin-surface-permission-keys.spec.tsx` —
 * a declaration nothing reads is the state this whole arrangement exists to
 * stop, so neither half is evidence on its own.
 */
describe('the commerce console surfaces declare their own authorization', () => {
  const consoleExtension = () =>
    Aglyn.listConsoleExtensions().find((entry) => entry.pluginId === BUNDLE_ID)
  const navItem = (href: string) =>
    consoleExtension()?.navItems?.find((entry) => entry.href === href)

  beforeEach(() => {
    registerCommerceConsole()
  })

  it('requires `managePos` to open the POS register', () => {
    expect(navItem('/pos')?.permission).toBe('managePos')
  })

  it('leaves PRODUCTS open — the narrowing must not reach the sibling', () => {
    /*
     * The reason the key sits on the nav item rather than the extension.
     * `ConsoleExtension.permission` applies to every surface the extension
     * registers, so declaring `managePos` there would have put the catalog,
     * orders and promotions behind a point-of-sale permission — refusing a
     * merchandiser who has no business at the till and every business in the
     * catalog.
     */
    expect(navItem('/products')?.permission).toBeUndefined()
    expect(consoleExtension()?.permission).toBeUndefined()
  })

  it('names a key the plugin permission registry actually carries', () => {
    // A key in neither vocabulary is REFUSED by the shell, so a typo here
    // takes the register offline for everybody rather than failing loudly.
    // `managePos` is camelCase and lives in the plugin registry, never in
    // the dotted catalog — looking it up in the wrong space finds nothing.
    const key = navItem('/pos')?.permission as string
    expect(Aglyn.listPluginPermissionKeys()).toContain(key)
    expect(Aglyn.ORG_PERMISSION_KEYS).not.toContain(key)
  })

  it('admits the tiers the sale route accepts, and not the viewer', () => {
    // `server/pos-order.ts` refuses a sale unless the resolved map holds
    // this key, so the console must offer the register to exactly the
    // population that route will take money from.
    const key = navItem('/pos')?.permission as string
    expect(Aglyn.resolveRolePermissions('admin')[key]).toBe(true)
    expect(Aglyn.resolveRolePermissions('editor')[key]).toBe(true)
    expect(Aglyn.resolveRolePermissions('viewer')[key]).toBe(false)
  })
})

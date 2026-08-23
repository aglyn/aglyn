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
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useVisibleComponentCategories } from './use-visible-component-categories'

jest.mock('./use-aglyn-besigner-flag', () => ({
  __esModule: true,
  default: () => [undefined, () => undefined],
  useAglynBesignerFlag: () => [undefined, () => undefined],
}))

/**
 * The Members blocks follow the per-site USER ACCOUNTS capability, not the
 * bundle that happens to ship them (AGL-2486).
 *
 * Zach, on `aglyn-org`: *"Memberships are disabled for aglyn-org but yet we
 * still see the components in besigner"* — the Elements panel offering
 * Password recovery, Member sign-in and Member sign-up on a site whose
 * `/signin`, `/signup` and `/recover` now 404.
 *
 * The two halves contradicted each other because they are gated by different
 * things. The routes read the new `accounts` capability; the drawer reads
 * `item.pluginId`, and these three blocks are registered by the COMMERCE
 * bundle, so a site with commerce on kept being offered sign-in blocks it
 * could not serve. An author could drop one on a page, publish, and learn
 * from a visitor.
 *
 * Attribution by CATEGORY rather than by re-registering the components under
 * another bundle: re-registering would move where they load from and change
 * what existing sites serve, which is the risky half deliberately deferred.
 * This is a read-time filter over the picker only.
 */
const PRESET_IDS = [
  'spec-member-block',
  'spec-shop-block',
  'spec-base-block',
  'spec-own-block',
] as const

function preset(
  $id: string,
  pluginId: string,
  category: string,
): Aglyn.PresetSchema {
  return {
    $id,
    type: Aglyn.NodeType.PRESET,
    displayName: $id,
    pluginId,
    category,
    icon: { path: '' },
    data: { $id: null, componentId: $id, pluginId },
  } as unknown as Aglyn.PresetSchema
}

function wrapperFor(enabled: readonly string[] | undefined) {
  return function Wrapper({ children }: { children?: ReactNode }) {
    return (
      <Aglyn.EnabledPluginsContext.Provider value={enabled}>
        {children}
      </Aglyn.EnabledPluginsContext.Provider>
    )
  }
}

function visibleIds(enabled: readonly string[] | undefined): string[] {
  const { result } = renderHook(() => useVisibleComponentCategories(), {
    wrapper: wrapperFor(enabled),
  })
  return (result.current ?? []).flatMap((category) =>
    (category.items ?? [])
      .map((item) => item.$id as string)
      .filter((id) => (PRESET_IDS as readonly string[]).includes(id)),
  )
}

/**
 * Does the drawer show a category by that name at all? Keyed on `label`,
 * which is what `schemasBySortedCategories` actually emits — reading a
 * `category` property here returned undefined for every row and made the
 * assertion below pass without testing anything.
 */
function categoryLabels(enabled: readonly string[] | undefined): string[] {
  const { result } = renderHook(() => useVisibleComponentCategories(), {
    wrapper: wrapperFor(enabled),
  })
  return (result.current ?? []).map((category) => String(category.label))
}

describe('Members blocks follow the user-accounts capability (AGL-2486)', () => {
  beforeEach(() => {
    Aglyn.components.registerPreset([
      // Registered by COMMERCE, exactly as the real member blocks are.
      preset('spec-member-block', 'commerce', Aglyn.ComponentCategory.MEMBERS),
      preset('spec-shop-block', 'commerce', Aglyn.ComponentCategory.COMMERCE),
      // The base library, which must never be filterable away.
      preset('spec-base-block', 'mui', Aglyn.ComponentCategory.LAYOUT),
      // Host-owned reusable component: belongs to no plugin at all.
      preset(
        'spec-own-block',
        undefined as unknown as string,
        Aglyn.REUSABLE_COMPONENT_CATEGORY,
      ),
    ])
  })

  afterEach(() => {
    Aglyn.components.unregisterPreset([...PRESET_IDS])
  })

  it('does NOT offer a Members block when user accounts is off', () => {
    // The `aglyn-org` case: commerce on, accounts off. Named rather than
    // whole-list, so adding a preset to this fixture cannot turn the
    // assertion into a statement about the fixture.
    const ids = visibleIds(['mui', 'commerce'])
    expect(ids).not.toContain('spec-member-block')
    expect(ids).toContain('spec-shop-block')
  })

  it('hides the whole MEMBERS category, not just its items', () => {
    // An empty category heading is still an advertisement for a capability
    // the site does not have.
    // Guarded against the vacuous form: the category IS present when the
    // capability is on, so its absence below is a real subtraction.
    expect(
      categoryLabels(['mui', 'commerce', Aglyn.ACCOUNTS_PLUGIN_ID]),
    ).toContain(String(Aglyn.ComponentCategory.MEMBERS))
    expect(categoryLabels(['mui', 'commerce'])).not.toContain(
      String(Aglyn.ComponentCategory.MEMBERS),
    )
  })

  it('DOES offer them once the site turns user accounts on', () => {
    // The other direction, so a filter that simply drops the category
    // always is not mistaken for a fix.
    const ids = visibleIds(['mui', 'commerce', Aglyn.ACCOUNTS_PLUGIN_ID])
    expect(ids).toContain('spec-member-block')
    expect(ids).toContain('spec-shop-block')
  })

  it('still needs the owning bundle: accounts alone is not enough', () => {
    // The capability un-defaults the category; it does not conjure a bundle
    // the site has switched off. Both gates apply.
    const ids = visibleIds(['mui', Aglyn.ACCOUNTS_PLUGIN_ID])
    expect(ids).not.toContain('spec-member-block')
    expect(ids).not.toContain('spec-shop-block')
  })

  it('leaves surfaces with NO plugin set unfiltered', () => {
    // `undefined` is the "no host resolved" shape (platform email editor,
    // tests). It must keep behaving exactly as before, or this filter would
    // silently empty the drawer wherever no set is published.
    const ids = visibleIds(undefined)
    expect(ids).toContain('spec-member-block')
    expect(ids).toContain('spec-shop-block')
  })

  /*==========================================
   *
   * MARK - the GENERAL rule, not a members-shaped special case
   *
   * Zach, 2026-08-23: "That hiding membership features if the plugin is
   * turned off should also work for commerce if commerce is turned off and
   * the same thing with any other plugin for that matter."
   *
   * The rule is: an element whose PROVIDING plugin is disabled for this site
   * is not offered on this site. That already held for every bundle through
   * `pluginId` — what did not hold was Members, because those blocks are
   * registered by the commerce bundle and so rode commerce's verdict. These
   * pin the general behaviour so the next capability does not repeat it.
   *
   *=========================================*/

  it('ANY disabled plugin loses its elements, commerce included', () => {
    const ids = visibleIds(['mui'])
    expect(ids).not.toContain('spec-shop-block')
    expect(ids).not.toContain('spec-member-block')
    expect(ids).toContain('spec-base-block')
  })

  it('a disabled plugin loses its whole CATEGORY, header included', () => {
    // An empty "Commerce" heading is still an advertisement. Guarded against
    // the vacuous form: the category IS there when commerce is on.
    expect(categoryLabels(['mui', 'commerce'])).toContain(
      String(Aglyn.ComponentCategory.COMMERCE),
    )
    expect(categoryLabels(['mui'])).not.toContain(
      String(Aglyn.ComponentCategory.COMMERCE),
    )
  })

  it('and gets them back when the site re-enables it', () => {
    // Re-enabling is the half that proves this is a read-time filter rather
    // than anything that unregistered the components.
    expect(visibleIds(['mui'])).not.toContain('spec-shop-block')
    expect(visibleIds(['mui', 'commerce'])).toContain('spec-shop-block')
  })

  it('the base component library is never filtered out', () => {
    // `mui` is alwaysOn, and `resolveEnabledPlugins`/`subtractDisabledPlugins`
    // union it back in however a site is configured — so the picker can never
    // be emptied. Asserted here as the property the drawer depends on.
    expect(Aglyn.resolveEnabledPlugins({ enabledPlugins: [] })).toContain('mui')
    expect(
      Aglyn.subtractDisabledPlugins(['mui', 'commerce'], ['mui', 'commerce']),
    ).toEqual(['mui'])
  })

  it('host-owned "Your components" belong to no plugin and are untouched', () => {
    // They are authored on the site itself, so no plugin verdict can name
    // them — and a filter that swallowed them would delete the user's own
    // work from the drawer.
    expect(visibleIds(['mui'])).toContain('spec-own-block')
    expect(visibleIds(['mui', 'commerce'])).toContain('spec-own-block')
  })

  /*==========================================
   *
   * MARK - the seam: SEARCH reads the filtered list, and nothing else does
   *
   *=========================================*/

  it('both picker surfaces search the FILTERED list', () => {
    // A category hidden from the grid but findable by typing is the same
    // defect wearing a search box. Both surfaces share `usePickerFilter`,
    // and this asserts what they hand it: the output of the capability
    // filter, not the raw registry.
    //
    // Static on purpose. The picker's PRESENTATION is being restructured in
    // parallel; this pins only the data seam, so that work is free to move
    // components around as long as the searchable list still comes from
    // here. If a file below moves, re-point the path — do not drop the
    // assertion.
    const REPO_ROOT = resolve(__dirname, '../../../../../../..')
    const SURFACES = [
      'libs/besigner/feature/designer/src/lib/components/component-picker.tsx',
      'libs/besigner/feature/designer/src/lib/components/component-accordion-list.tsx',
    ]
    for (const file of SURFACES) {
      const source = readFileSync(resolve(REPO_ROOT, file), 'utf8')
      expect(source).toContain('useVisibleComponentCategories()')
      expect(source).toContain('usePickerFilter(')
    }
  })

  it('the accounts capability registers NO components of its own', () => {
    // Which is what guarantees an element already on a published page keeps
    // rendering when the capability is off. `accounts` carries no loader
    // manifest entry and contributes no presets, so no node can ever hold
    // `pluginId: 'accounts'` — the tenant loads the COMMERCE bundle exactly
    // as before and the member blocks on an existing page still render.
    // This filter decides what is OFFERED, never what already exists.
    const all = Object.values(Aglyn.components.presets ?? {})
    // Non-vacuous: the registry really does hold this spec's presets, so an
    // empty result below is a fact about `accounts` rather than about an
    // unreadable registry.
    expect(all.length).toBeGreaterThan(0)
    const owned = all.filter(
      (presetSchema: { pluginId?: string }) =>
        presetSchema?.pluginId === Aglyn.ACCOUNTS_PLUGIN_ID,
    )
    expect(owned).toEqual([])
  })
})

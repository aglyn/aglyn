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
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useVisibleComponentCategories } from './use-visible-component-categories'

// The drawer's view-type flag needs a live besigner app, so it is stubbed at
// its hook. Unset (a page) unless a suite below says which view it is.
let mockViewType: unknown = undefined
jest.mock('./use-aglyn-besigner-flag', () => ({
  __esModule: true,
  default: () => [mockViewType, () => undefined],
  useAglynBesignerFlag: () => [mockViewType, () => undefined],
}))

/**
 * Per-site plugin enablement, editor surface (AGL-1014).
 *
 * `enabledPlugins` is a boundary, not a preference. The console gate, both
 * plugin-API dispatchers and the tenant page loader already resolve it per
 * host; the editor did not, so a site with Commerce switched off still
 * offered — and inserted — Commerce elements from the component drawer.
 *
 * The registry these presets come from is a module-global union that only
 * ever grows (`consolePluginLoader` never unloads a bundle), so loading less
 * cannot fix it: what an earlier site registered stays registered for the
 * session. Filtering at the READ is the only enforcement that holds, which
 * is what these tests pin.
 */
const PRESET_IDS = ['spec-mui', 'spec-commerce'] as const

function preset($id: string, pluginId: string): Aglyn.PresetSchema {
  return {
    $id,
    type: Aglyn.NodeType.PRESET,
    displayName: $id,
    pluginId,
    category: 'Spec',
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

describe('useVisibleComponentCategories — per-site plugin enablement (AGL-1014)', () => {
  beforeEach(() => {
    Aglyn.components.registerPreset([
      preset('spec-mui', 'mui'),
      preset('spec-commerce', 'commerce'),
    ])
  })

  afterEach(() => {
    Aglyn.components.unregisterPreset([...PRESET_IDS])
  })

  it('hides a plugin the site has disabled', () => {
    expect(visibleIds(['mui'])).toEqual(['spec-mui'])
  })

  it('keeps a plugin the site still enables', () => {
    expect(visibleIds(['mui', 'commerce']).sort()).toEqual([
      'spec-commerce',
      'spec-mui',
    ])
  })

  it('filters nothing when no set is supplied (no host in scope)', () => {
    expect(visibleIds(undefined).sort()).toEqual(['spec-commerce', 'spec-mui'])
  })
})

/**
 * Reusable email blocks (AGL-3287). The console files each of the host's
 * components with `reusableComponentPaletteSlot`, and this drawer decides
 * where that filing lands: an email's drawer offers the host's email blocks
 * and none of its page components, and a page's the reverse. Neither renders
 * the other's elements.
 */
describe('useVisibleComponentCategories — reusable email blocks (AGL-3287)', () => {
  const REUSABLE_IDS = ['hostcmp:spec-header', 'hostcmp:spec-nav'] as const

  /** An entry exactly as the console registers one for a host component. */
  function hostComponentPreset(
    id: string,
    kind: Aglyn.ReusableComponentKind,
  ): Aglyn.PresetSchema {
    return {
      $id: id,
      type: Aglyn.NodeType.PRESET,
      displayName: id,
      icon: { path: '' },
      ...Aglyn.reusableComponentPaletteSlot(kind),
      data: {
        $id: null,
        componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
        pluginId: 'mui',
        props: { refId: id },
      },
    } as unknown as Aglyn.PresetSchema
  }

  function offered(enabled: readonly string[] | undefined): {
    ids: string[]
    groups: string[]
  } {
    const { result } = renderHook(() => useVisibleComponentCategories(), {
      wrapper: wrapperFor(enabled),
    })
    const categories = result.current ?? []
    return {
      ids: categories.flatMap((category) =>
        (category.items ?? [])
          .map((item) => item.$id as string)
          .filter((id) => (REUSABLE_IDS as readonly string[]).includes(id)),
      ),
      groups: categories.map((category) => String(category.label)),
    }
  }

  beforeEach(() => {
    Aglyn.components.registerPreset([
      hostComponentPreset('hostcmp:spec-header', 'email'),
      hostComponentPreset('hostcmp:spec-nav', 'site'),
    ])
  })

  afterEach(() => {
    Aglyn.components.unregisterPreset([...REUSABLE_IDS])
    mockViewType = undefined
  })

  it('offers an email its email blocks and none of the page components', () => {
    mockViewType = Aglyn.HostViewType.EMAIL
    const { ids, groups } = offered(undefined)
    expect(ids).toEqual(['hostcmp:spec-header'])
    // Under their own heading, not the page drawer's.
    expect(groups).toContain(Aglyn.REUSABLE_EMAIL_BLOCK_CATEGORY)
    expect(groups).not.toContain(Aglyn.REUSABLE_COMPONENT_CATEGORY)
  })

  it.each([
    ['a page', Aglyn.HostViewType.SCREEN],
    ['a layout', Aglyn.HostViewType.LAYOUT],
    ['a component editor', undefined],
  ])('offers %s the page components and none of the email blocks', (_where, view) => {
    mockViewType = view
    const { ids, groups } = offered(undefined)
    expect(ids).toEqual(['hostcmp:spec-nav'])
    expect(groups).not.toContain(Aglyn.REUSABLE_EMAIL_BLOCK_CATEGORY)
  })

  it('follows the site switching its email plugin off, as the email blocks themselves do', () => {
    mockViewType = Aglyn.HostViewType.EMAIL
    expect(offered(['mui']).ids).toEqual([])
    expect(offered(['mui', Aglyn.EMAIL_VIEW_BUNDLE_ID]).ids).toEqual([
      'hostcmp:spec-header',
    ])
    // A page component belongs to no plugin, so no switch hides it.
    mockViewType = Aglyn.HostViewType.SCREEN
    expect(offered(['mui']).ids).toEqual(['hostcmp:spec-nav'])
  })
})

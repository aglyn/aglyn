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

// The drawer's view-type flag needs a live besigner app; the filter under
// test is orthogonal to it, so the flag is stubbed at its hook.
jest.mock('./use-aglyn-besigner-flag', () => ({
  __esModule: true,
  default: () => [undefined, () => undefined],
  useAglynBesignerFlag: () => [undefined, () => undefined],
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

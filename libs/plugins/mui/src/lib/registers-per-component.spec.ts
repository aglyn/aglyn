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

/**
 * A published page registers the elements it places, and nothing else
 * (AGL-3141).
 *
 * A file of its own because the registry and the bundle's own bookkeeping are
 * MODULE state: a spec that has already asked for the whole library cannot
 * then observe a narrowed registration, and the failure this guards is only
 * visible on a registry that has not seen everything already.
 *
 * The failure it guards is silent. A component id the page places and the
 * registration misses has no component to render, so the element draws
 * nothing at all and no error says why (AGL-52) — which is why the second
 * page, the one that adds an element the first never had, is the case
 * asserted hardest.
 */

import * as Aglyn from '@aglyn/aglyn'
import { BUNDLE_ID } from './constants/bundle-common'
import { MUI_COMPONENT_SOURCES, loadMuiBundle, registerMuiPlugin } from './plugin'

const registeredIds = () =>
  Object.values(Aglyn.components.schemas)
    .filter((schema) => schema?.pluginId === BUNDLE_ID)
    .map((schema) => schema.$id as string)
    .sort()

describe('the mui bundle registers per component (AGL-3141)', () => {
  it('registers a page’s elements and leaves the rest unfetched', async () => {
    await registerMuiPlugin({ componentIds: ['muiTypography', 'muiBox'] })
    expect(registeredIds()).toEqual(['muiBox', 'muiTypography'])
  })

  it('adds what a SECOND page places to a bundle already loaded', async () => {
    // The dependency exists by now, so this takes the branch that registers
    // into a LOADED bundle. Getting it wrong is the blank element: the page
    // places `muiBreadcrumbs` and the registry has never heard of it.
    await registerMuiPlugin({ componentIds: ['muiBreadcrumbs'] })
    expect(registeredIds()).toEqual([
      'muiBox',
      'muiBreadcrumbs',
      'muiTypography',
    ])
  })

  it('ignores an id it does not own rather than registering a blank', async () => {
    // A document carries elements from every plugin on the page, so the ids
    // handed here include other bundles'. Resolving one to an undefined
    // component would register a component that renders nothing.
    await registerMuiPlugin({ componentIds: ['form', 'booking'] })
    expect(registeredIds()).toEqual([
      'muiBox',
      'muiBreadcrumbs',
      'muiTypography',
    ])
  })

  it('registers the whole library when no ids are named', async () => {
    // The console and the besigner take this path: their palette shows every
    // element, so they ask for everything and get it through the same map.
    await registerMuiPlugin()
    expect(registeredIds()).toEqual(Object.keys(MUI_COMPONENT_SOURCES).sort())
  })

  it('resolves every id in the map to a real component and its own schema', async () => {
    // The map names exports as strings, so a renamed export resolves to
    // `undefined` and registers a component that draws nothing. Nothing else
    // in the suite would notice.
    const bundle = await loadMuiBundle()
    const broken = bundle
      .map((entry, index) => ({
        id: Object.keys(MUI_COMPONENT_SOURCES)[index] as string,
        entry,
      }))
      .filter(
        ({ id, entry }) =>
          !entry.component || !entry.schema || entry.schema.$id !== id,
      )
      .map(({ id }) => id)
    expect(broken).toEqual([])
  })
})

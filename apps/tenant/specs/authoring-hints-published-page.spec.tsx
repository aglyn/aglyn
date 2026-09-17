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
 * THE PUBLISHED PAGE IS NOT AN EDITING SURFACE (AGL-3067).
 *
 * An element with nothing authored draws its authoring hint only where
 * `ScreenLinkContext.suppressNavigation` is set. The besigner canvas and the
 * console's Preview set it; the page a visitor loads must not. The plugin
 * specs render both shapes by hand (`authoring-hints-bundle.spec.tsx` in
 * plugins-mui and plugins-commerce), and this pins the tenant's half: a node
 * rendered through `CatchAllPage`, the component the published route renders,
 * reads no editing flag. A tenant that started providing one would put every
 * empty element's hint in front of its visitors, and fails here instead.
 *
 * The node is a probe rather than a real element because an app may not
 * import a plugin; what it reads is the same context every element reads.
 */

jest.mock('../utils/site-plugin-loader', () =>
  require('./site-plugin-loader-empty-manifest'),
)

import { components } from '@aglyn/aglyn/aglyn'
import { ScreenLinkContext } from '@aglyn/aglyn/app-utils/screen-link-context-value'
import { act, render } from '@testing-library/react'
import { forwardRef, useContext } from 'react'
import CatchAllPage from '../app/[host]/[scheme]/[[...slug]]/catch-all-client'

const ROOT = '_@_'
const PROBE_ID = 'surfaceProbe'

/** Writes the surface flags a node reads onto its own element. */
const SurfaceProbe = forwardRef<HTMLDivElement, Record<string, unknown>>(
  ({ sx: _sx, ...props }, ref) => {
    const { suppressNavigation, editorInert } = useContext(ScreenLinkContext)
    return (
      <div
        ref={ref}
        {...props}
        data-suppress-navigation={String(Boolean(suppressNavigation))}
        data-editor-inert={String(Boolean(editorInert))}
      />
    )
  },
)
SurfaceProbe.displayName = 'SurfaceProbe'

const NODES = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['probe'] },
  probe: {
    $id: 'probe',
    type: 'node',
    pluginId: 'mui',
    componentId: PROBE_ID,
    parentId: ROOT,
    props: {},
  },
}

beforeAll(() => {
  components.registerComponent(SurfaceProbe as never, {
    $id: PROBE_ID,
    pluginId: 'mui',
  } as never)
})

afterAll(() => {
  components.unregisterComponent(PROBE_ID)
})

describe('the published page (AGL-3067)', () => {
  it('renders its nodes with no editing flag for an authoring hint to read', async () => {
    let container: HTMLElement | undefined
    // `CatchAllPage` opens by suspending on its plugin gate, so the render is
    // flushed inside `act` or the container is still empty when it is read.
    await act(async () => {
      container = render(
        <CatchAllPage
          data={{ host: { $id: 'host1' } as never }}
          nodes={NODES as never}
        />,
      ).container
    })
    const probe = container?.querySelector('[data-aglyn="leaf:probe"]')
    // The control: a page that committed nothing would read as unflagged.
    expect(probe).toBeTruthy()
    expect(probe?.getAttribute('data-suppress-navigation')).toBe('false')
    expect(probe?.getAttribute('data-editor-inert')).toBe('false')
  })
})

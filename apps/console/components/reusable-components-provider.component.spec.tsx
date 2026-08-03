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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'react'
import ReusableComponentsProvider from './reusable-components-provider.component'

/**
 * The `@aglyn/besigner-ui` barrel pulls the whole designer — every styled
 * component, the node tree, the drawers — in at import time, which cannot
 * mount under this app's jest transform. Only the promotion context matters
 * here, and it is loaded for real from its own module so the provider and
 * the probe below share one context object.
 */
jest.mock('@aglyn/besigner-ui', () => ({
  ComponentPromotionContext: jest.requireActual(
    '../../../libs/besigner/feature/designer/src/lib/contexts/component-promotion-context',
  ).ComponentPromotionContext,
}))
const { ComponentPromotionContext } = jest.requireMock('@aglyn/besigner-ui')

/**
 * `canvas` is a mobx singleton with own non-configurable computeds, so it is
 * replaced wholesale rather than spied on (same approach as
 * `use-besigner-document.spec`). Everything else from `@aglyn/aglyn` — and
 * `replaceSubtreeWithInstance` above all — stays REAL: the point of these
 * tests is the wiring, so a stubbed swap would prove nothing.
 */
const mockCanvas = {
  toJSON: jest.fn(() => ({ nodes: {} as Record<string, any> })),
  applyNodes: jest.fn(),
}

jest.mock('@aglyn/aglyn', () => {
  const actual = jest.requireActual('@aglyn/aglyn')
  return new Proxy(actual, {
    get: (target, prop) =>
      prop === 'canvas' ? mockCanvas : Reflect.get(target, prop),
  })
})

const mockCreateHostResource = jest.fn(async () => ({ id: 'cmp-new' }))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostResourceApi: () => mockCreateHostResource,
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useLoading: () => ({ queueLoading: () => jest.fn() }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: jest.fn(() => 'collection-ref'),
  doc: jest.fn(() => 'doc-ref'),
  getDoc: jest.fn(),
  limit: jest.fn((n: number) => n),
  query: jest.fn(() => 'query-ref'),
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'pro' }, orgId: 'org1', ready: true }),
}))

jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: [], status: 'success' }),
}))

let mockEntitled = true
jest.mock('../constants/entitlements', () => ({
  hasEntitlement: () => mockEntitled,
}))

/**
 * A layout whose chrome is about to be promoted: `nav` (the subtree that
 * moves into the definition) beside a `footer` that must not be touched.
 */
const layoutNodes = () => ({
  _root_: { $id: '_root_', componentId: 'div', nodes: ['nav', 'footer'] },
  nav: {
    $id: 'nav',
    parentId: '_root_',
    componentId: 'muiAppBar',
    nodes: ['brand'],
    // Derived fields the designer hangs off a node; they must not be
    // persisted into the definition.
    componentSchema: { displayName: 'App Bar' },
    resolvedProps: { color: 'transparent' },
  },
  brand: {
    $id: 'brand',
    parentId: 'nav',
    componentId: 'muiTypography',
    props: { children: 'Aglyn' },
  },
  footer: { $id: 'footer', parentId: '_root_', componentId: 'muiBox' },
})

const navNode = () => ({
  $id: 'nav',
  parentId: '_root_',
  componentId: 'muiAppBar',
  componentSchema: { displayName: 'App Bar' },
})

/** Renders the provider and hands back the promote callback it publishes. */
function setup() {
  let promote: ((node: any) => void) | undefined
  function Probe() {
    promote = useContext(ComponentPromotionContext).onPromote
    return null
  }
  render(
    <ReusableComponentsProvider hostId="h1">
      <Probe />
    </ReusableComponentsProvider>,
  )
  return { promote: promote as (node: any) => void }
}

/** Opens the dialog for `nav`, names the component, and confirms. */
async function promoteNav(name = 'Site nav') {
  const { promote } = setup()
  act(() => promote(navNode()))
  const field = await screen.findByLabelText('Name')
  fireEvent.change(field, { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Save component' }))
}

describe('ReusableComponentsProvider — promotion swaps the source for an instance (AGL-1193)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEntitled = true
    mockCreateHostResource.mockResolvedValue({ id: 'cmp-new' })
    mockCanvas.toJSON.mockImplementation(() => ({ nodes: layoutNodes() }))
  })

  it('leaves the promoting document following the component, not holding a copy', async () => {
    await promoteNav()

    await waitFor(() => expect(mockCanvas.applyNodes).toHaveBeenCalled())
    const next = mockCanvas.applyNodes.mock.calls[0][0] as Record<string, any>

    // The regression: the source subtree is gone and `nav` is now an
    // instance of what was just created. Without this the layout that
    // DEFINED the component is the one place that never tracks it.
    expect(next['nav']).toMatchObject({
      $id: 'nav',
      parentId: '_root_',
      componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
      props: { refId: 'cmp-new', name: 'Site nav' },
    })
    expect(next['brand']).toBeUndefined()
    // Untouched siblings and an intact child list, so the tree still
    // resolves and the selection still points at something.
    expect(next['_root_'].nodes).toEqual(['nav', 'footer'])
    expect(next['footer']).toBeDefined()
    // `refId` must be the id the API minted, never the source node's id —
    // pointing an instance at `nav` would resolve to nothing.
    expect(next['nav'].props.refId).not.toBe('nav')
  })

  it('sends the whole subtree to the API as a rootless definition, without derived fields', async () => {
    await promoteNav()

    await waitFor(() => expect(mockCreateHostResource).toHaveBeenCalled())
    const { resource, hostId, data } = mockCreateHostResource.mock.calls[0][0] as any
    expect({ resource, hostId }).toEqual({
      resource: 'reusableComponent',
      hostId: 'h1',
    })
    expect(data.rootId).toBe('nav')
    expect(Object.keys(data.nodes).sort()).toEqual(['brand', 'nav'])
    // The definition root is parentless — it is grafted under whatever
    // parent each instance has.
    expect(data.nodes.nav.parentId).toBeNull()
    expect(data.nodes.nav.componentSchema).toBeUndefined()
    expect(data.nodes.nav.resolvedProps).toBeUndefined()
  })

  it('does not swap the canvas when creation is denied', async () => {
    mockCreateHostResource.mockRejectedValue(new Error('Quota exceeded'))
    await promoteNav()

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Quota exceeded',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
    // Swapping here would point the document at a component that does not
    // exist, and the original subtree would be gone with it.
    expect(mockCanvas.applyNodes).not.toHaveBeenCalled()
  })

  it('refuses to promote at all without the entitlement', async () => {
    mockEntitled = false
    const { promote } = setup()
    act(() => promote(navNode()))

    expect(screen.queryByRole('button', { name: 'Save component' })).toBeNull()
    expect(mockCreateHostResource).not.toHaveBeenCalled()
    expect(mockCanvas.applyNodes).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('Starter plan'),
      expect.objectContaining({ variant: 'warning' }),
    )
  })
})

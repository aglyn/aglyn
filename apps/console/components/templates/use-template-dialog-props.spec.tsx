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

const mockCreateHostResource = jest.fn()
const mockCreateHostVersion = jest.fn()
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'user-1' } }),
  useHostResourceApi: () => mockCreateHostResource,
  useHostVersionApi: () => mockCreateHostVersion,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('./create-page-from-template', () => ({
  __esModule: true,
  default: jest.fn(),
}))

import type * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import UseTemplateDialog from './use-template-dialog.component'

/**
 * A component or layout made from a template declares the properties its tree
 * binds to (AGL-2932), and a `{{prop.*}}` binding survives being made.
 */

const PROPS: Aglyn.ReusableComponentProp[] = [
  { name: 'headline', type: 'text', defaultValue: 'Build once' },
  { name: 'showCta', type: 'boolean', defaultValue: true },
]

const NODES = {
  root: {
    $id: 'root',
    componentId: 'muiTypography',
    props: { children: '{{prop.headline}} for {{customer}}' },
  },
}

const use = async (template: Record<string, unknown>) => {
  render(<UseTemplateDialog hostId="host-1" template={template} onClose={jest.fn()} />)
  fireEvent.change(await screen.findByLabelText(/name$/), {
    target: { value: 'Made from a template' },
  })
}

describe('using a template whose tree binds to properties (AGL-2932)', () => {
  beforeEach(() => {
    mockCreateHostResource.mockReset().mockResolvedValue({ id: 'new-1' })
    mockCreateHostVersion.mockReset().mockResolvedValue({ id: 'version-1' })
  })

  it('declares the properties on the component it makes, and keeps the bindings', async () => {
    await use({
      kind: 'component',
      displayName: 'Hero',
      rootId: 'root',
      nodes: NODES,
      props: PROPS,
      // A template saved before property tokens were told apart from
      // placeholders lists one; it is not asked for.
      placeholders: [{ name: 'customer' }, { name: 'prop.headline' }],
    })
    expect(screen.queryByLabelText('prop.headline')).toBeNull()
    fireEvent.change(screen.getByLabelText('customer'), {
      target: { value: 'agencies' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create component' }))
    await waitFor(() => expect(mockCreateHostResource).toHaveBeenCalledTimes(1))
    const { resource, data } = mockCreateHostResource.mock.calls[0][0]
    expect(resource).toBe('reusableComponent')
    expect(data.props).toEqual(PROPS)
    expect(data.nodes.root.props.children).toBe('{{prop.headline}} for agencies')
  })

  it("declares the properties on the layout's first version", async () => {
    await use({ kind: 'layout', displayName: 'Chrome', nodes: NODES, props: PROPS })
    fireEvent.click(screen.getByRole('button', { name: 'Create layout' }))
    await waitFor(() => expect(mockCreateHostVersion).toHaveBeenCalledTimes(1))
    const { kind, data } = mockCreateHostVersion.mock.calls[0][0]
    expect(kind).toBe('layout')
    expect(data.props).toEqual(PROPS)
    expect(data.nodes.root.props.children).toBe('{{prop.headline}} for {{customer}}')
  })

  it('declares nothing for a template that carries no properties', async () => {
    await use({ kind: 'component', displayName: 'Plain', rootId: 'root', nodes: NODES })
    fireEvent.click(screen.getByRole('button', { name: 'Create component' }))
    await waitFor(() => expect(mockCreateHostResource).toHaveBeenCalledTimes(1))
    expect(mockCreateHostResource.mock.calls[0][0].data).not.toHaveProperty('props')
  })
})

/**
 * A template saved from an email block makes an email block (AGL-3287), so
 * the component lands in the drawer its source was offered in.
 */
describe('using a component template saved from an email block (AGL-3287)', () => {
  beforeEach(() => {
    mockCreateHostResource.mockReset().mockResolvedValue({ id: 'new-1' })
  })

  it('makes an email block from an email block template', async () => {
    await use({
      kind: 'component',
      displayName: 'Footer',
      rootId: 'root',
      nodes: NODES,
      componentKind: 'email',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create component' }))
    await waitFor(() => expect(mockCreateHostResource).toHaveBeenCalledTimes(1))
    expect(mockCreateHostResource.mock.calls[0][0].data.kind).toBe('email')
  })

  it('makes a page component, sending no kind, from any other template', async () => {
    await use({ kind: 'component', displayName: 'Hero', rootId: 'root', nodes: NODES })
    fireEvent.click(screen.getByRole('button', { name: 'Create component' }))
    await waitFor(() => expect(mockCreateHostResource).toHaveBeenCalledTimes(1))
    expect(mockCreateHostResource.mock.calls[0][0].data).not.toHaveProperty('kind')
  })
})

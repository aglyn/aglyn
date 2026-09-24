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
 * Make a reusable component with AI (AGL-2908), in the besigner's Attributes
 * panel: where it is drawn, what it sends, and that nothing happens until
 * the person applies.
 *
 * The canvas is the real singleton and the editor the real session seam, so
 * "nothing written" is measured on the document the besigner would save.
 * Every request is recorded; no spec calls a live provider.
 */

import { canvas, CANVAS_ROOT_ELEMENT_ID, type NodeSchema } from '@aglyn/aglyn'
import {
  registerEditorSession,
  resetEditorSessionsForTests,
} from '@aglyn/aglyn/plugin-manager/editor-sessions'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const ROOT = CANVAS_ROOT_ELEMENT_ID
const BESIGNER = '/acme/hosts/host-1/screens/screen-1/versions/v-2/besigner'

/** Every request the widget made, as `[url, parsedBody]`. */
const posts: Array<[string, Record<string, unknown>]> = []
/** Every component the resources route was asked to create. */
const creates: Array<Record<string, unknown>> = []
let proposalResponse: unknown = null

jest.mock('next/navigation', () => ({
  __esModule: true,
  usePathname: () => BESIGNER,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'u1' } }),
  useHostResourceApi: () => async (options: Record<string, unknown>) => {
    creates.push(options)
    return { id: 'cmp-new' }
  },
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: async (_user: unknown, url: string, init: { body: string }) => {
    posts.push([url, JSON.parse(init.body)])
    if (url.endsWith('/api/ai/generate/component')) {
      return {
        ok: (proposalResponse as { ok?: boolean })?.ok !== false,
        json: async () => proposalResponse,
      }
    }
    return { ok: true, json: async () => ({}) }
  },
}))

import { AiSaveAsComponent } from './ai-save-as-component.component'
import { ASSIST_EDIT_ACTION_ID, summarizeAssistEditOps } from '../model/assist-edit'

const PAGE = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['feature'] },
  feature: {
    $id: 'feature',
    parentId: ROOT,
    componentId: 'muiStack',
    nodes: ['heading'],
    props: {},
  },
  heading: {
    $id: 'heading',
    parentId: 'feature',
    componentId: 'muiTypography',
    nodes: [],
    props: { children: 'Ship faster', variant: 'h2' },
  },
}

const SAVE = {
  op: 'saveAsComponent' as const,
  nodeId: 'feature',
  componentId: 'muiStack',
  name: 'Feature section',
  props: [{ name: 'headline', type: 'text' as const, label: 'Headline' }],
  bindings: [
    { nodeId: 'heading', componentId: 'muiTypography', field: 'children', prop: 'headline' },
  ],
}

const EDIT = {
  id: ASSIST_EDIT_ACTION_ID,
  summary: 'Each page sets the headline.',
  ops: [SAVE],
  diff: summarizeAssistEditOps([SAVE]),
  dropped: [],
  target: { kind: 'screen', documentId: 'screen-1', versionId: 'v-2', hostId: 'host-1' },
}

const selection = (patch: Record<string, unknown> = {}): NodeSchema<any> =>
  ({
    $id: 'feature',
    componentId: 'muiStack',
    componentSchema: { displayName: 'Stack' },
    ...patch,
  }) as unknown as NodeSchema<any>

const props = (patch: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  node: selection(),
  editable: true,
  ...patch,
})

let unregister: () => void = () => undefined

beforeEach(() => {
  posts.length = 0
  creates.length = 0
  proposalResponse = { edit: EDIT, exchangeId: 'exchange-1' }
  resetEditorSessionsForTests()
  canvas.reset()
  canvas.setNodes(PAGE as never)
  act(() => {
    unregister = registerEditorSession({
      documentKind: 'screen',
      documentId: 'screen-1',
      versionId: 'v-2',
      isLiveVersion: () => false,
      selectedNodeId: () => 'feature',
    })
  })
})

afterEach(() => {
  act(() => unregister())
  resetEditorSessionsForTests()
  canvas.reset()
})

const button = () => screen.queryByRole('button', { name: 'Make a reusable component with AI' })

describe('where it is drawn', () => {
  it('offers the section the person selected', () => {
    render(<AiSaveAsComponent {...props()} />)
    expect(button()).toBeTruthy()
  })

  it('is absent for an element this editor may not change in place', () => {
    render(<AiSaveAsComponent {...props({ editable: false })} />)
    expect(button()).toBeNull()
  })

  it('is absent with no selection, no site and no workspace', () => {
    const { unmount } = render(<AiSaveAsComponent {...props({ node: null })} />)
    expect(button()).toBeNull()
    unmount()
    const withoutHost = render(<AiSaveAsComponent {...props({ hostId: null })} />)
    expect(button()).toBeNull()
    withoutHost.unmount()
    render(<AiSaveAsComponent {...props({ orgId: null })} />)
    expect(button()).toBeNull()
  })

  it('is absent on an element that already follows a component', () => {
    render(
      <AiSaveAsComponent
        {...props({ node: selection({ componentId: 'reusableInstance' }) })}
      />,
    )
    expect(button()).toBeNull()
  })
})

describe('what it sends, and when', () => {
  it('asks nothing until the person names the component and presses', () => {
    render(<AiSaveAsComponent {...props()} />)
    fireEvent.click(button() as HTMLElement)
    expect(screen.getByLabelText('Component name')).toBeTruthy()
    expect(posts).toEqual([])
  })

  it('sends the outline, the name and the open route — and nothing else', async () => {
    render(<AiSaveAsComponent {...props()} />)
    fireEvent.click(button() as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest properties' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    const [url, body] = posts[0]
    expect(url).toBe('/api/ai/generate/component')
    expect(Object.keys(body).sort()).toEqual(['canvas', 'hostId', 'name', 'orgId', 'route'])
    expect(body).toMatchObject({ orgId: 'org-1', hostId: 'host-1', route: BESIGNER })
    const outline = body['canvas'] as { selectedId: string; nodes: Array<{ id: string }> }
    expect(outline.selectedId).toBe('feature')
    expect(outline.nodes.map((node) => node.id).sort()).toEqual([ROOT, 'feature', 'heading'].sort())
  })

  it('changes nothing on the page while the proposal waits for a decision', async () => {
    const before = JSON.stringify(canvas.toJSON())
    render(<AiSaveAsComponent {...props()} />)
    fireEvent.click(button() as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest properties' }))
    await waitFor(() => expect(screen.getByText('Proposed change')).toBeTruthy())
    expect(JSON.stringify(canvas.toJSON())).toBe(before)
    expect(creates).toEqual([])
    expect(canvas.canUndo).toBe(false)
  })

  it('says a refusal in the door’s own words', async () => {
    proposalResponse = { ok: false, error: 'Give the component a name first.' }
    render(<AiSaveAsComponent {...props()} />)
    fireEvent.click(button() as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest properties' }))
    await waitFor(() => expect(screen.getByText('Give the component a name first.')).toBeTruthy())
    expect(creates).toEqual([])
  })
})

describe('what Apply does', () => {
  it('says the component is saved as well, before the person decides', async () => {
    render(<AiSaveAsComponent {...props()} />)
    fireEvent.click(button() as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest properties' }))
    await waitFor(() => expect(screen.getByText('Proposed change')).toBeTruthy())
    expect(screen.getByText(/saves the component to your library/)).toBeTruthy()
    expect(screen.getByText(/Nothing is published/)).toBeTruthy()
  })

  it('creates the component through the resources route and swaps the section for it', async () => {
    render(<AiSaveAsComponent {...props()} />)
    fireEvent.click(button() as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest properties' }))
    await waitFor(() => expect(screen.getByText('Proposed change')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Apply as draft' }))
    await waitFor(() => expect(creates).toHaveLength(1))
    expect(creates[0]).toMatchObject({ hostId: 'host-1', resource: 'reusableComponent' })
    const data = creates[0]['data'] as Record<string, unknown>
    expect(data['displayName']).toBe('Feature section')
    expect((data['props'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: 'headline',
      // Today's value, read off the field the token replaced.
      defaultValue: 'Ship faster',
    })
    await waitFor(() =>
      expect(canvas.getNode('feature')).toMatchObject({ props: { refId: 'cmp-new' } }),
    )
    // And the apply is reported, so the activity row counts it.
    await waitFor(() =>
      expect(posts.some(([url]) => url === '/api/assist/edit-applied')).toBe(true),
    )
    const [, report] = posts.find(([url]) => url === '/api/assist/edit-applied') as [
      string,
      Record<string, unknown>,
    ]
    expect(report).toMatchObject({
      orgId: 'org-1',
      exchangeId: 'exchange-1',
      documentId: 'screen-1',
      versionId: 'v-2',
      opCounts: { component: 1 },
    })
    // A section of a page is a page component, as every component was.
    expect(data).not.toHaveProperty('kind')
  })

  /**
   * A block saved out of an email is an email block (AGL-3287): offered in
   * emails, never on a page. Before this it became a page component, which
   * the email's own drawer then hid.
   */
  it('saves a section of an email as an email block', async () => {
    canvas.reset()
    canvas.setNodes({
      ...PAGE,
      feature: { ...PAGE.feature, pluginId: 'email' },
    } as never)
    render(<AiSaveAsComponent {...props()} />)
    fireEvent.click(button() as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest properties' }))
    await waitFor(() => expect(screen.getByText('Proposed change')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Apply as draft' }))
    await waitFor(() => expect(creates).toHaveLength(1))
    expect((creates[0]['data'] as Record<string, unknown>)['kind']).toBe('email')
  })
})

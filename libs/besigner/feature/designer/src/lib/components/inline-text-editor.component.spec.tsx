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

import { inlineTextEdit } from '../utils/inline-text-edit.store'
import InlineTextEditorComponent from './inline-text-editor.component'

// The inline canvas text editor (double-click a text element) now renders
// stored {{...}} tokens as named pills, offers the same grouped insert
// picker as the attributes panel via the {x} toolbar button, and
// serializes pills back to raw token syntax on commit (AGL-586).
describe('InlineTextEditorComponent pills (AGL-586)', () => {
  const rect = { left: 10, top: 10, width: 120, height: 24 }

  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as any)
  })
  afterEach(() => {
    act(() => inlineTextEdit.close())
    updateNodeProps.mockRestore()
  })

  const plainNode = (children: string) =>
    ({
      $id: 'agl586-inline',
      type: 'node',
      componentId: 'text',
      props: { children },
      componentSchema: { flags: {} },
      nodes: [],
    }) as any

  const richNode = (children: string, html: string) =>
    ({
      $id: 'agl586-inline-rich',
      type: 'node',
      componentId: 'rich-text',
      props: { children, html },
      componentSchema: {
        flags: { richTextEditable: Aglyn.FEATURE_FLAG.ENABLED },
      },
      nodes: [],
    }) as any

  const openEditor = async (node: any) => {
    render(<InlineTextEditorComponent />)
    act(() => inlineTextEdit.open(node, rect))
    const label = ((node.componentSchema?.flags?.richTextEditable ?? 0) &
      Aglyn.FEATURE_FLAG.ENABLED) !== 0
      ? 'Edit rich text'
      : 'Edit text'
    const surface = await screen.findByRole('textbox', { name: label })
    // The surface DOM is built on a requestAnimationFrame after open.
    await waitFor(() =>
      expect(surface.textContent && surface.textContent.length > 0).toBe(true),
    )
    return surface
  }

  it('renders stored tokens as named pills when the editor opens', async () => {
    const surface = await openEditor(plainNode('Hi {{entry.title}}!'))
    const pill = surface.querySelector('[data-token]') as HTMLElement
    expect(pill).toBeTruthy()
    expect(pill.getAttribute('data-token')).toBe('{{entry.title}}')
    expect(pill.getAttribute('contenteditable')).toBe('false')
    expect(pill.textContent).toBe('Title')
    expect(surface.textContent).toBe('Hi Title!')
  })

  it('commits pills back to raw token syntax (Enter)', async () => {
    const node = plainNode('Hi {{entry.title}}!')
    const surface = await openEditor(node)
    surface.appendChild(document.createTextNode(' Bye'))
    fireEvent.keyDown(surface, { key: 'Enter' })
    expect(updateNodeProps).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ children: 'Hi {{entry.title}}! Bye' }),
    )
    // The editor closed after the single commit.
    expect(inlineTextEdit.node).toBeUndefined()
  })

  it('inserts a pill from the toolbar {x} picker', async () => {
    const node = plainNode('Start ')
    const surface = await openEditor(node)
    // No live selection — the pill appends at the end.
    window.getSelection()?.removeAllRanges()
    const button = screen.getByRole('button', { name: 'Insert data token' })
    fireEvent.mouseDown(button)
    fireEvent.click(button)
    fireEvent.click(await screen.findByText('Link URL'))
    const pill = surface.querySelector('[data-token]') as HTMLElement
    expect(pill.getAttribute('data-token')).toBe('{{entry.url}}')
    fireEvent.keyDown(surface, { key: 'Enter' })
    expect(updateNodeProps).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ children: 'Start {{entry.url}}' }),
    )
  })

  it('removes a pill via its popover', async () => {
    const node = plainNode('A {{entry.slug}} B')
    const surface = await openEditor(node)
    fireEvent.click(surface.querySelector('[data-token]') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(surface.querySelector('[data-token]')).toBeNull()
    fireEvent.keyDown(surface, { key: 'Enter' })
    expect(updateNodeProps).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ children: 'A  B' }),
    )
  })

  it('replaces a pill in place via its popover', async () => {
    const node = plainNode('A {{entry.slug}} B')
    const surface = await openEditor(node)
    fireEvent.click(surface.querySelector('[data-token]') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }))
    fireEvent.click(await screen.findByText('Collection name'))
    const pill = surface.querySelector('[data-token]') as HTMLElement
    expect(pill.getAttribute('data-token')).toBe('{{collection.name}}')
    fireEvent.keyDown(surface, { key: 'Enter' })
    expect(updateNodeProps).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ children: 'A {{collection.name}} B' }),
    )
  })

  it('cancels without committing on Escape', async () => {
    const surface = await openEditor(plainNode('keep me'))
    fireEvent.keyDown(surface, { key: 'Escape' })
    expect(updateNodeProps).not.toHaveBeenCalled()
    expect(inlineTextEdit.node).toBeUndefined()
  })

  it('rich mode: pills render inside markup and serialize back on Done', async () => {
    const node = richNode('Hi Message', '<b>Hi {{var:v1}}</b>')
    const surface = await openEditor(node)
    const pill = surface.querySelector('[data-token]') as HTMLElement
    expect(pill).toBeTruthy()
    expect(pill.getAttribute('data-token')).toBe('{{var:v1}}')
    // Bold structure survives around the pill.
    expect(surface.querySelector('b')?.contains(pill)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(updateNodeProps).toHaveBeenCalledTimes(1)
    const props = updateNodeProps.mock.calls[0]?.[1] as Record<string, string>
    // The RAW token (id grammar) is stored — never the pill label.
    expect(props['html']).toContain('{{var:v1}}')
    expect(props['html']).not.toContain('data-token')
    expect(props['children']).toBe('Hi {{var:v1}}')
  })
})

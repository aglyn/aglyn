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

  // Instance prop overrides (AGL-1304): opened with a propTarget, the same
  // surface edits the INSTANCE's propValues[propName] — the double-clicked
  // leaf is a grafted preview node, not a canvas node.
  describe('instance prop overrides (AGL-1304)', () => {
    const instanceNode = (propValues?: Record<string, unknown>) =>
      ({
        $id: 'agl1304-inst',
        type: 'node',
        componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
        props: { refId: 'hero', ...(propValues && { propValues }) },
        componentSchema: { flags: {} },
        nodes: [],
      }) as any

    const openPropEditor = async (node: any, initialText: string) => {
      render(<InlineTextEditorComponent />)
      act(() =>
        inlineTextEdit.open(node, rect, {
          propName: 'headline',
          initialText,
        }),
      )
      // Always the PLAIN surface — prop values substitute as strings.
      const surface = await screen.findByRole('textbox', { name: 'Edit text' })
      await waitFor(() => expect(surface.textContent).toBe(initialText))
      return surface
    }

    it('opens with the effective text and commits to propValues, keeping refId', async () => {
      const node = instanceNode()
      const surface = await openPropEditor(node, 'Headline goes here')
      surface.textContent = 'Ship faster'
      fireEvent.keyDown(surface, { key: 'Enter' })
      expect(updateNodeProps).toHaveBeenCalledWith(
        node,
        expect.objectContaining({
          refId: 'hero',
          [Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY]: { headline: 'Ship faster' },
        }),
      )
      expect(inlineTextEdit.node).toBeUndefined()
      expect(inlineTextEdit.propTarget).toBeUndefined()
    })

    it('preserves sibling prop overrides on commit', async () => {
      const node = instanceNode({ headline: 'Old', image: '/keep.png' })
      const surface = await openPropEditor(node, 'Old')
      surface.textContent = 'New'
      fireEvent.keyDown(surface, { key: 'Enter' })
      expect(updateNodeProps).toHaveBeenCalledWith(
        node,
        expect.objectContaining({
          [Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY]: {
            headline: 'New',
            image: '/keep.png',
          },
        }),
      )
    })

    it('an emptied edit removes the override — and the container when it was the last', async () => {
      const node = instanceNode({ headline: 'Old' })
      const surface = await openPropEditor(node, 'Old')
      surface.textContent = ''
      fireEvent.keyDown(surface, { key: 'Enter' })
      // The graft treats '' as unset (the component default returns), so a
      // cleared instance must serialize identically to a never-overridden
      // one — no propValues key at all.
      const props = updateNodeProps.mock.calls[0]?.[1] as Record<
        string,
        unknown
      >
      expect(props['refId']).toBe('hero')
      expect(
        Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY in props,
      ).toBe(false)
    })

    it('cancels without committing on Escape', async () => {
      const surface = await openPropEditor(instanceNode(), 'Keep me')
      fireEvent.keyDown(surface, { key: 'Escape' })
      expect(updateNodeProps).not.toHaveBeenCalled()
      expect(inlineTextEdit.propTarget).toBeUndefined()
    })
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

/**
 * AGL-1644. The text editor is the second of the two `position: fixed` in-place
 * editors, and it never had even the AGL-1624 floor: it positioned on a rect
 * captured once at open, unclamped, so a scroll left it over unrelated chrome
 * and an element near the top of the viewport put its toolbar off-screen.
 */
describe('the text editor follows the canvas (AGL-1644)', () => {
  afterEach(() => {
    act(() => inlineTextEdit.close())
    document.body.innerHTML = ''
  })

  const node = () =>
    ({
      $id: 'agl1644-inline',
      type: 'node',
      componentId: 'text',
      props: { children: 'Hello' },
      componentSchema: { flags: {} },
      nodes: [],
    }) as any

  /** A canvas element whose viewport rect the test can move, as a scroll does. */
  const movableAnchor = (top: number, left = 40) => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    let box = { left, top, width: 200, height: 24 }
    el.getBoundingClientRect = () =>
      ({
        ...box,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON: () => ({}),
      }) as DOMRect
    return {
      el,
      scrollTo: (nextTop: number) => {
        box = { ...box, top: nextTop }
        act(() => {
          fireEvent.scroll(window)
        })
      },
    }
  }

  const overlay = () =>
    document.querySelector(
      '[data-aglyn="overlay:inline-text-editor"]',
    ) as HTMLElement

  const openAnchored = (top: number) => {
    const anchor = movableAnchor(top)
    render(<InlineTextEditorComponent />)
    act(() =>
      inlineTextEdit.open(
        node(),
        { left: 40, top, width: 200, height: 24 },
        undefined,
        anchor.el,
      ),
    )
    return anchor
  }

  it('re-measures the anchor when the canvas scrolls', () => {
    const anchor = openAnchored(300)
    expect(window.getComputedStyle(overlay()).top).toBe('300px')

    anchor.scrollTo(150)
    expect(window.getComputedStyle(overlay()).top).toBe('150px')
  })

  // The editor's toolbar sits 40px ABOVE the surface. Anchoring flush at the
  // element's top put those controls off-screen for any element near the top of
  // the viewport — visible editable, unreachable Done button.
  it('keeps the toolbar on screen for an element at the very top', () => {
    const anchor = openAnchored(300)
    anchor.scrollTo(2)
    expect(
      Number.parseFloat(window.getComputedStyle(overlay()).top),
    ).toBeGreaterThanOrEqual(40)
  })

  it('falls back to the captured rect when there is no anchor', () => {
    render(<InlineTextEditorComponent />)
    act(() =>
      inlineTextEdit.open(node(), { left: 40, top: 210, width: 200, height: 24 }),
    )
    expect(window.getComputedStyle(overlay()).top).toBe('210px')
  })
})

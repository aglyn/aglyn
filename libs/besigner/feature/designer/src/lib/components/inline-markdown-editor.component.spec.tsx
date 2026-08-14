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
import * as Besigner from '@aglyn/besigner'
import { Box } from '@mui/material'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { MediaPickerContext } from '../contexts/media-picker-context'
import { ATTRIBUTE_COMMIT_DEBOUNCE_MS } from '../hooks/use-debounced-commit'
import { inlineMarkdownEdit } from '../utils/inline-markdown-edit.store'
import DraggableDroppable from './dnd/draggable-droppable'
import InlineMarkdownEditorComponent from './inline-markdown-editor.component'

/** A node the schema declares a markdown-document attribute for. */
const markdownNode = (content: string) =>
  ({
    $id: 'agl1624-node',
    type: Aglyn.NodeType.NODE,
    componentId: 'unregistered-markdown',
    props: { content, variant: 'body1' },
    componentSchema: {
      attributes: [
        {
          name: 'content',
          label: 'Content',
          component: Aglyn.FieldComponentType.MARKDOWN,
        },
      ],
    },
    nodes: [],
  }) as any

/** Every contentEditable row the WYSIWYG rendered, in document order. */
const rowEls = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-row-kind]'))

/**
 * The canvas half of AGL-1616: double-clicking a Markdown element opens the
 * WYSIWYG over it (AGL-1624).
 *
 * Two seams, and both of them are places this can go wrong in a way the canvas
 * still looks right afterwards:
 *
 * 1. the double-click itself, which must open the editor WITHOUT letting the
 *    event reach the canvas' double-click-to-zoom; and
 * 2. when the typed document reaches `canvas.updateNodeProps` — the trap the
 *    issue exists to respect, because a besigner attribute that commits on
 *    blur loses everything typed since the last focus change, silently.
 */
describe('canvas double-click on a markdown element (AGL-1624)', () => {
  afterEach(() => {
    act(() => inlineMarkdownEdit.close())
    act(() => Besigner.focus.clearSelection())
  })

  /**
   * The leaf inside an ancestor that handles double-click the way
   * `ZoomablePanningComponent` does. If the node-level handler ever stops
   * consuming the event, this spy fires and the canvas zooms while the author
   * is trying to edit text.
   */
  const renderLeaf = (node: any) => {
    const onZoom = jest.fn()
    render(
      <div onDoubleClick={onZoom} data-testid="panner">
        <DraggableDroppable
          node={node}
          type={Besigner.DragType.CANVAS}
          accept={[Besigner.DragType.CANVAS]}
        >
          <Box data-testid="leaf">{'rendered document'}</Box>
        </DraggableDroppable>
      </div>,
    )
    return { onZoom, leaf: screen.getByTestId('leaf') }
  }

  it('opens the editor on the attribute the SCHEMA declares, not on a component id', () => {
    const node = markdownNode('## Title\n\nBody.')
    const { onZoom, leaf } = renderLeaf(node)

    act(() => {
      fireEvent.dblClick(leaf)
    })

    expect(inlineMarkdownEdit.node?.$id).toBe('agl1624-node')
    expect(inlineMarkdownEdit.attributeName).toBe('content')
    expect(inlineMarkdownEdit.initialValue).toBe('## Title\n\nBody.')
    // The hazard this issue was split out for: the canvas must not zoom.
    expect(onZoom).not.toHaveBeenCalled()
  })

  // A real double-click is mousedown, mousedown, dblclick — and the canvas
  // mousedown handler TOGGLES selection, so the second one deselects the node
  // the first one selected. The editor closes when the selection leaves the
  // node it is editing, so without putting the selection back it would open
  // and shut in the same tick.
  it('leaves the node selected after the two mousedowns a real double-click sends', () => {
    const node = markdownNode('## Title')
    const { leaf } = renderLeaf(node)

    act(() => {
      fireEvent.mouseDown(leaf)
      fireEvent.mouseDown(leaf)
      fireEvent.dblClick(leaf)
    })

    expect(Besigner.focus.isNodeSelected(node)).toBe(true)
    expect(inlineMarkdownEdit.node?.$id).toBe('agl1624-node')
  })

  // The control that makes the assertion above non-vacuous: on a node with no
  // markdown attribute the very same double-click DOES reach the panner.
  it('leaves double-click-to-zoom alone for a node that declares none', () => {
    const node = {
      ...markdownNode(''),
      componentSchema: { attributes: [{ name: 'title', label: 'Title' }] },
    }
    const { onZoom, leaf } = renderLeaf(node)

    act(() => {
      fireEvent.dblClick(leaf)
    })

    expect(inlineMarkdownEdit.node).toBeUndefined()
    expect(onZoom).toHaveBeenCalledTimes(1)
  })

  it('leaves a locked node read-only', () => {
    const node = markdownNode('## Title')
    node.componentSchema.flags = { dragging: Aglyn.FEATURE_FLAG.DISABLED }
    const { leaf } = renderLeaf(node)

    act(() => {
      fireEvent.dblClick(leaf)
    })

    expect(inlineMarkdownEdit.node).toBeUndefined()
  })
})

/**
 * A stand-in canvas element whose viewport rect the test can move, the way a
 * scroll moves a real one.
 */
const movableAnchor = (top: number, left = 40) => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  let box = { left, top, width: 600, height: 300 }
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
    /** Moves the element and fires the scroll the browser would have fired. */
    scrollTo: (nextTop: number, nextLeft = box.left) => {
      box = { ...box, top: nextTop, left: nextLeft }
      act(() => {
        fireEvent.scroll(window)
      })
    },
  }
}

const overlayTop = (testId: string): string =>
  window.getComputedStyle(screen.getByTestId(testId)).top

/**
 * AGL-1644. Both in-place editors anchored on a rect captured ONCE at open and
 * never recomputed, so scrolling the canvas mid-edit left the editor floating
 * over unrelated chrome. AGL-1624 clamped that dead rect with `Math.max(8, …)`,
 * which put a first paint somewhere visible and did nothing about the drift —
 * its own author called it a floor rather than a fix.
 *
 * The distinction the tests below turn on: a floor can only ever push the
 * editor DOWN to the margin. Following the element back UP the page — the
 * second half of every scroll a person actually performs — is the part a
 * clamped constant cannot do at all.
 */
describe('the markdown editor follows the canvas (AGL-1644)', () => {
  afterEach(() => {
    act(() => inlineMarkdownEdit.close())
    act(() => Besigner.focus.clearSelection())
    document.body.innerHTML = ''
  })

  const openAnchored = (top: number) => {
    const node = markdownNode('Hello world')
    const anchor = movableAnchor(top)
    render(<InlineMarkdownEditorComponent />)
    act(() => {
      Besigner.focus.setSelectedNode(node)
      inlineMarkdownEdit.open(
        node,
        { left: 40, top, width: 600, height: 300 },
        'content',
        node.props.content,
        anchor.el,
      )
    })
    return anchor
  }

  it('re-measures the anchor when the canvas scrolls', () => {
    const anchor = openAnchored(300)
    expect(overlayTop('inline-markdown-editor')).toBe('300px')

    anchor.scrollTo(180)
    expect(overlayTop('inline-markdown-editor')).toBe('180px')
  })

  // The half a floor cannot reach. Scrolled off the top the editor waits at the
  // margin — and scrolling back returns it to the element, rather than leaving
  // it parked where the clamp put it.
  it('waits at the top margin while the element is above the viewport, then comes back', () => {
    const anchor = openAnchored(300)

    anchor.scrollTo(-900)
    expect(overlayTop('inline-markdown-editor')).toBe('8px')

    anchor.scrollTo(240)
    expect(overlayTop('inline-markdown-editor')).toBe('240px')
  })

  // The opposite edge, which the old `Math.max(8, …)` had no answer for at all:
  // an element below the fold would have taken the editor off the bottom.
  it('keeps the editor reachable when the element is below the viewport', () => {
    const anchor = openAnchored(300)
    anchor.scrollTo(window.innerHeight + 500)
    const top = Number.parseFloat(overlayTop('inline-markdown-editor'))
    expect(top).toBeLessThan(window.innerHeight)
  })

  // No anchor — an `open` from a caller that has none — must behave exactly as
  // it did before, on the captured rect.
  it('falls back to the captured rect when there is no anchor', () => {
    const node = markdownNode('Hello world')
    render(<InlineMarkdownEditorComponent />)
    act(() => {
      Besigner.focus.setSelectedNode(node)
      inlineMarkdownEdit.open(
        node,
        { left: 40, top: 220, width: 600, height: 300 },
        'content',
        node.props.content,
      )
    })
    expect(overlayTop('inline-markdown-editor')).toBe('220px')
  })
})

describe('in-place markdown commit semantics (AGL-1624)', () => {
  let updateNodeProps: jest.SpyInstance

  /** The `content` value on the LAST commit. */
  const lastCommittedContent = (): unknown => {
    const calls = updateNodeProps.mock.calls
    const call = calls[calls.length - 1] as unknown[]
    return (call?.[1] as Record<string, unknown>)?.['content']
  }

  /** Opens the editor the way a canvas double-click does: selection first. */
  const openOn = (node: any) => {
    render(<InlineMarkdownEditorComponent />)
    act(() => {
      Besigner.focus.setSelectedNode(node)
      inlineMarkdownEdit.open(
        node,
        { left: 40, top: 60, width: 600, height: 300 },
        'content',
        node.props.content,
      )
    })
  }

  beforeEach(() => {
    jest.useFakeTimers()
    // Keep commits away from the real canvas store; the node isn't in it.
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as any)
  })
  afterEach(() => {
    act(() => inlineMarkdownEdit.close())
    act(() => Besigner.focus.clearSelection())
    updateNodeProps.mockRestore()
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('renders the WYSIWYG over the element, not a raw source box', () => {
    openOn(markdownNode('## Title\n\nBody **text**.'))
    expect(screen.getByTestId('inline-markdown-editor')).toBeTruthy()
    const rows = rowEls()
    expect(rows.map((el) => el.dataset['rowKind'])).toEqual([
      'heading2',
      'paragraph',
    ])
    expect(rows[1]?.querySelector('strong')?.textContent).toBe('text')
  })

  it('commits on the debounce without any focus event at all', () => {
    openOn(markdownNode('Hello world'))
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello calm world'
    act(() => {
      fireEvent.input(row)
    })
    expect(updateNodeProps).not.toHaveBeenCalled()
    act(() => {
      jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS)
    })
    expect(lastCommittedContent()).toBe('Hello calm world')
  })

  // The trap. On the canvas, clicking away is the natural way to finish, and
  // an edit that never blurred is the one a blur-committed editor throws away
  // while the element behind it still shows the right text.
  it('commits an edit that never blurred when Done closes the editor', () => {
    openOn(markdownNode('Hello world'))
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello brave world'
    act(() => {
      fireEvent.input(row)
    })
    expect(updateNodeProps).not.toHaveBeenCalled()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    expect(lastCommittedContent()).toBe('Hello brave world')
  })

  // Selecting another element on the canvas is the same gesture with none of
  // the intent to save. It must behave identically.
  it('commits when the canvas selection moves to another node', () => {
    const node = markdownNode('Hello world')
    openOn(node)
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello other world'
    act(() => {
      fireEvent.input(row)
    })

    act(() => {
      Besigner.focus.setSelectedNode({ ...node, $id: 'some-other-node' } as any)
    })
    expect(inlineMarkdownEdit.node).toBeUndefined()
    expect(lastCommittedContent()).toBe('Hello other world')
  })

  // Escape CLOSES and KEEPS. With a debounced commit the document is already
  // partly written, so a "cancel" could only discard the last 250 ms of it —
  // a worse lie than committing and leaving undo to do the undoing.
  it('keeps the edit when Escape closes the editor', () => {
    openOn(markdownNode('Hello world'))
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello quiet world'
    act(() => {
      fireEvent.input(row)
    })

    act(() => {
      fireEvent.keyDown(screen.getByTestId('inline-markdown-editor'), {
        key: 'Escape',
      })
    })
    expect(inlineMarkdownEdit.node).toBeUndefined()
    expect(lastCommittedContent()).toBe('Hello quiet world')
  })

  // The toolbar, the link popover and the URL dialog all take focus, two of
  // them into a portal. The keystrokes before the click must already be safe,
  // and the ones after it must still commit.
  it('keeps typing that straddles a focus-stealing toolbar click', () => {
    openOn(markdownNode('Hello world'))
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello wide world'
    act(() => {
      fireEvent.input(row)
      fireEvent.blur(row)
      jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS)
    })
    expect(lastCommittedContent()).toBe('Hello wide world')

    const again = rowEls()[0] as HTMLElement
    again.textContent = 'Hello wider world'
    act(() => {
      fireEvent.input(again)
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    expect(lastCommittedContent()).toBe('Hello wider world')
  })

  // markdown-lite has five renderers, and this attribute holds published legal
  // copy. A commit that reformatted the document would rewrite it on the first
  // stray keystroke.
  it('commits the markdown-lite dialect a document actually uses', () => {
    const source =
      '## 1. Information We Collect\n\n' +
      '**1.1 Information you provide.**\n\n' +
      '- **Account & identity:** name, email address.\n' +
      '- **Billing:** plan selection.\n\n' +
      '> A pull quote.\n\n' +
      '```ts\nconst a = 1\n```\n\n' +
      '| Prop | Default |\n| --- | --: |\n| size | 8 |\n\n' +
      'See the [Cookie Policy](/legal/cookies).'
    openOn(markdownNode(source))
    // One stray keystroke in the FIRST row — the heading renders as rich text,
    // so its DOM reads "1. Information We Collect" without the `## `.
    const row = rowEls()[0] as HTMLElement
    row.textContent = '1. Information We Collect Today'
    act(() => {
      fireEvent.input(row)
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    expect(lastCommittedContent()).toBe(
      source.replace('We Collect\n', 'We Collect Today\n'),
    )
  })

  // The commit REPLACES the props object, so anything else on the node has to
  // survive the edit — the same spread every other besigner commit does.
  it('leaves the node’s other props intact', () => {
    openOn(markdownNode('Hello world'))
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello kept world'
    act(() => {
      fireEvent.input(row)
      jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS)
    })
    const call = updateNodeProps.mock.calls[0] as unknown[]
    expect(call[1]).toEqual({
      content: 'Hello kept world',
      variant: 'body1',
    })
  })

  // AGL-1645. The canvas is the harder of the two surfaces for this: opening
  // the picker is a modal that takes focus, and focus is what closes and
  // commits every other in-place editor on this canvas. The whole round trip
  // is driven, because the button being wired proves nothing on its own.
  describe('the image button reaches the media library (AGL-1645)', () => {
    /** `openOn`, under a host picker whose pending callback is captured. */
    const openWithPicker = (node: any) => {
      let pending: ((value: string) => void) | null = null
      const onPickMedia = jest.fn((onPick: (value: string) => void) => {
        pending = onPick
      })
      render(
        <MediaPickerContext.Provider value={{ onPickMedia }}>
          <InlineMarkdownEditorComponent />
        </MediaPickerContext.Provider>,
      )
      act(() => {
        Besigner.focus.setSelectedNode(node)
        inlineMarkdownEdit.open(
          node,
          { left: 40, top: 60, width: 600, height: 300 },
          'content',
          node.props.content,
        )
      })
      return { onPickMedia, pick: (value: string) => pending?.(value) }
    }

    /** Toolbar image button → alt text → "Choose from media". */
    const openPickerWithAlt = (alt: string) => {
      act(() => {
        fireEvent.click(screen.getByLabelText('Image'))
      })
      act(() => {
        fireEvent.change(screen.getByLabelText('Alt text'), {
          target: { value: alt },
        })
      })
      act(() => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Choose from media' }),
        )
      })
    }

    it('inserts the picked asset and commits it as markdown-lite', () => {
      const { onPickMedia, pick } = openWithPicker(markdownNode('Before.'))
      openPickerWithAlt('A signed contract')
      expect(onPickMedia).toHaveBeenCalledTimes(1)

      act(() => {
        pick('media:org:acme/med123')
      })
      const img = document.querySelector(
        '[data-row-kind="image"] img',
      ) as HTMLImageElement | null
      expect(img?.getAttribute('src')).toBe('/api/media/cdn/org:acme/med123')
      expect(img?.getAttribute('alt')).toBe('A signed contract')

      act(() => {
        jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS)
      })
      expect(lastCommittedContent()).toBe(
        'Before.\n\n![A signed contract](/api/media/cdn/org:acme/med123)',
      )
    })

    // The focus hazard, stated as an assertion. The editor must still be open
    // and still editing the same node after a modal has taken focus and given
    // it back — a surface that closed on the dialog would drop the author back
    // onto the canvas with the image inserted into nothing.
    it('stays open across the modal that steals focus', () => {
      const node = markdownNode('Before.')
      const { pick } = openWithPicker(node)
      openPickerWithAlt('Kept open')
      act(() => {
        pick('media:org:acme/med123')
      })
      // Let the dialog finish its exit transition and hand focus back. Until
      // it does, MUI holds `aria-hidden` on everything behind the modal — the
      // editor is there, but a role query cannot see it, which is precisely
      // the state an author would be stuck in if the dialog never closed.
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(inlineMarkdownEdit.node?.$id).toBe(node.$id)
      expect(screen.getByTestId('inline-markdown-editor')).toBeTruthy()

      // And typing after the insert still commits, on the same debounce.
      const rows = rowEls()
      const last = rows[rows.length - 1] as HTMLElement
      last.textContent = 'After the image.'
      act(() => {
        fireEvent.input(last)
      })
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      })
      expect(String(lastCommittedContent())).toContain(
        '![Kept open](/api/media/cdn/org:acme/med123)\n\nAfter the image.',
      )
    })

    // Without a host picker the editor keeps its own URL prompt rather than
    // showing a button that does nothing.
    it('offers no media button when the host supplies no picker', () => {
      openOn(markdownNode(''))
      act(() => {
        fireEvent.click(screen.getByLabelText('Image'))
      })
      expect(screen.getByLabelText('Alt text')).toBeTruthy()
      expect(
        screen.queryByRole('button', { name: 'Choose from media' }),
      ).toBeNull()
    })
  })
})

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
import { act, fireEvent, render, screen } from '@testing-library/react'

import { MediaPickerContext } from '../contexts/media-picker-context'
import ElementPropsForm, {
  ATTRIBUTE_COMMIT_DEBOUNCE_MS,
} from './element-props-form.component'

// The Markdown component's `content` attribute renders the markdown-lite
// WYSIWYG instead of a raw textarea (AGL-1616). Exercised through the REAL
// attributes form, because the thing that can lose an author's work is the
// interaction between the editor and the panel's debounced commit (AGL-567) —
// not the editor, which has its own suite, and not the debounce, which has
// its own.
describe('MarkdownAttributeField (AGL-1616)', () => {
  let updateNodeProps: jest.SpyInstance

  /** The `content` value on the LAST commit. */
  const lastCommittedContent = (): unknown => {
    const calls = updateNodeProps.mock.calls
    const call = calls[calls.length - 1] as unknown[]
    return (call?.[1] as Record<string, unknown>)?.['content']
  }

  const node = (content: string) =>
    ({
      $id: 'agl1616-node',
      type: 'node',
      componentId: 'unregistered-markdown',
      props: { content },
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

  // ElementPropsFormProps inherits schema/componentMapper from
  // FormRendererProps, but the component supplies both internally —
  // passing them from a test would shadow the real ones via {...rest}.
  // Same reason (and same shape) as insert-token-menu.component.spec.tsx.
  const formProps = (content: string) => ({ node: node(content) }) as any

  /** Every contentEditable row the editor rendered, in document order. */
  const rowEls = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-row-kind]'))

  beforeEach(() => {
    jest.useFakeTimers()
    // Keep commits away from the real canvas store; the node isn't in it.
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as any)
  })
  afterEach(() => {
    updateNodeProps.mockRestore()
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('renders the WYSIWYG for a MARKDOWN attribute, not a textarea', () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps('## Title\n\nBody **text**.')} />,
    )
    expect(screen.getByTestId('markdown-attribute-field')).toBeTruthy()
    const rows = rowEls()
    expect(rows.map((el) => el.dataset['rowKind'])).toEqual([
      'heading2',
      'paragraph',
    ])
    // The document is rendered as rich text, not as raw markdown-lite source.
    expect(rows[1]?.querySelector('strong')?.textContent).toBe('text')
    unmount()
  })

  // The trap this issue names: a besigner attribute commits on BLUR, and a
  // rich editor changes when and whether blur fires. If an edit only reaches
  // react-final-form on blur, selecting another node throws it away while the
  // canvas still looks correct. Typing then leaving WITHOUT ever blurring the
  // field is the case that proves the edit was live the whole time.
  it('commits an edit that never blurred, on unmount (node switch)', () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps('Hello world')} />,
    )
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello brave world'
    act(() => {
      fireEvent.input(row)
    })
    // Still inside the debounce window: nothing committed yet.
    expect(updateNodeProps).not.toHaveBeenCalled()

    // Selecting another node tears the panel down. The unmount flush is the
    // only thing standing between the author and a silent loss.
    unmount()
    expect(lastCommittedContent()).toBe('Hello brave world')
  })

  it('commits on the debounce without any focus event at all', () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps('Hello world')} />,
    )
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello calm world'
    act(() => {
      fireEvent.input(row)
    })
    act(() => {
      jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS)
    })
    expect(lastCommittedContent()).toBe('Hello calm world')
    unmount()
  })

  // A toolbar click, the link popover and the source/visual toggle all steal
  // focus from the contentEditable — two of them into a portal outside the
  // <form>. The keystrokes before the click must already be in the form, and
  // the ones after it must still commit.
  it('keeps typing that straddles a focus-stealing toolbar click', () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps('Hello world')} />,
    )
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello wide world'
    act(() => {
      fireEvent.input(row)
    })
    // Focus leaves the editor for the toolbar; the panel flushes on blur.
    act(() => {
      fireEvent.blur(row)
      jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS)
    })
    expect(lastCommittedContent()).toBe('Hello wide world')

    // Back in the editor, more typing, and away again without a blur.
    const again = rowEls()[0] as HTMLElement
    again.textContent = 'Hello wider world'
    act(() => {
      fireEvent.input(again)
    })
    unmount()
    expect(lastCommittedContent()).toBe('Hello wider world')
  })

  // markdown-lite has five renderers; the field must round-trip THAT dialect,
  // not generic markdown. A commit that reformatted the document would rewrite
  // published legal copy on the first stray keystroke.
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
    const { unmount } = render(<ElementPropsForm {...formProps(source)} />)
    // One stray keystroke in the FIRST row — the heading renders as rich
    // text, so its DOM reads "1. Information We Collect" without the `## `.
    // Everything after it must survive verbatim.
    const row = rowEls()[0] as HTMLElement
    row.textContent = '1. Information We Collect Today'
    act(() => {
      fireEvent.input(row)
    })
    unmount()
    expect(lastCommittedContent()).toBe(
      source.replace('We Collect\n', 'We Collect Today\n'),
    )
  })

  // AGL-1645: the toolbar's image action reached the editor's own "paste a
  // URL" prompt, because neither besigner surface passed the callback that
  // opens the host's media library. Driven end to end — toolbar, dialog,
  // picker, insert, commit — because every one of those steps is a place the
  // handoff can break while the button still looks wired.
  describe('the image button reaches the media library (AGL-1645)', () => {
    /** Renders the panel under a host picker, capturing its pending callback. */
    const renderWithPicker = (content: string) => {
      let pending: ((value: string) => void) | null = null
      const onPickMedia = jest.fn((onPick: (value: string) => void) => {
        pending = onPick
      })
      const view = render(
        <MediaPickerContext.Provider value={{ onPickMedia }}>
          <ElementPropsForm {...formProps(content)} />
        </MediaPickerContext.Provider>,
      )
      return { ...view, onPickMedia, pick: (value: string) => pending?.(value) }
    }

    /** Toolbar image button → alt text → "Choose from media". */
    const openPickerWithAlt = (alt: string) => {
      act(() => {
        fireEvent.click(screen.getByLabelText('Image'))
      })
      const altField = screen.getByLabelText('Alt text') as HTMLInputElement
      act(() => {
        fireEvent.change(altField, { target: { value: alt } })
      })
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Choose from media' }))
      })
    }

    it('inserts the picked asset and commits it as markdown-lite', () => {
      const { unmount, onPickMedia, pick } = renderWithPicker('Before.')
      openPickerWithAlt('A signed contract')
      expect(onPickMedia).toHaveBeenCalledTimes(1)

      act(() => {
        pick('media:org:acme/med123')
      })

      // The editor really holds the image, not just the string.
      const img = document.querySelector(
        '[data-row-kind="image"] img',
      ) as HTMLImageElement | null
      expect(img?.getAttribute('src')).toBe('/api/media/cdn/org:acme/med123')
      expect(img?.getAttribute('alt')).toBe('A signed contract')

      unmount()
      expect(lastCommittedContent()).toBe(
        'Before.\n\n![A signed contract](/api/media/cdn/org:acme/med123)',
      )
    })

    // The trap that makes this more than plumbing. `onPickMedia` returns what
    // an ATTRIBUTE should store — a `media:` reference (AGL-1215) — and no
    // markdown-lite renderer resolves one, so a reference written straight into
    // `![](…)` is a permanently broken image on the published page.
    it('never lets a raw media: reference reach the document', () => {
      const { unmount, pick } = renderWithPicker('')
      openPickerWithAlt('')
      act(() => {
        pick('media:org:acme/med123')
      })
      unmount()
      const committed = String(lastCommittedContent())
      // Non-vacuous: the image is really in the document — it is the FORM the
      // assertion below is about.
      expect(committed).toContain('![](/api/media/cdn/org:acme/med123)')
      expect(committed).not.toContain('media:')
    })

    // A raw URL — a free-tier org or a legacy upload, where the picker has no
    // cdnPath to mint a reference from — must pass through untouched.
    it('passes a raw URL through unchanged', () => {
      const url = 'https://firebasestorage.googleapis.com/v0/b/x/o/y.png'
      const { unmount, pick } = renderWithPicker('')
      openPickerWithAlt('Legacy upload')
      act(() => {
        pick(url)
      })
      unmount()
      expect(lastCommittedContent()).toBe(`![Legacy upload](${url})`)
    })

    // With no host picker the editor must keep its own URL prompt rather than
    // offer a button that does nothing — the email besigner mounts no provider.
    it('offers no media button when the host supplies no picker', () => {
      const { unmount } = render(<ElementPropsForm {...formProps('')} />)
      act(() => {
        fireEvent.click(screen.getByLabelText('Image'))
      })
      expect(screen.getByLabelText('Alt text')).toBeTruthy()
      expect(
        screen.queryByRole('button', { name: 'Choose from media' }),
      ).toBeNull()
      unmount()
    })
  })
})

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
 * A link in an entry body names its target by REFERENCE (AGL-3118/AGL-3119).
 *
 * `[Read this](/blog/old-slug)` breaks on the next rename; `[Read this]
 * (entry:blog/9fKqR)` does not, and the author never types either — the
 * dialog's lookup offers the site's pages, listings, feeds and entries, and
 * writes the reference. What is pinned here is that the picked target reaches
 * the document as a reference, that the search is what finds an entry, and
 * that a stored reference is shown to the author by NAME.
 *
 * The typed-URL path this replaces is pinned in
 * `markdown-visual-editor.spec.tsx`, which drives the same dialog with no
 * provider mounted at all.
 */

import * as Aglyn from '@aglyn/aglyn'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'

import MarkdownVisualEditor, {
  type MarkdownVisualEditorHandle,
} from './markdown-visual-editor.component'
import { applyLinkToSource } from './markdown-source-command'

const SCREENS = { s1: 'pricing', 'collection:blog': 'blog' }
const LABELS = { s1: 'Pricing', 'collection:blog': 'Blog' }

const ENTRY: Aglyn.LinkTargetOption = {
  value: 'entry:blog/9fKqR',
  label: 'Hello world (/blog/hello-world) — Blog entry · published',
  title: 'Hello world',
  collectionName: 'Blog',
  status: 'published',
}

const seam = (
  overrides: Partial<Aglyn.LinkTargetSearchContextValue> = {},
): Aglyn.LinkTargetSearchContextValue => ({
  available: true,
  searchEntries: jest.fn(async () => [ENTRY]),
  describeTarget: jest.fn(async () => ENTRY.label),
  ...overrides,
})

const renderEditor = (
  initial: string,
  search: Aglyn.LinkTargetSearchContextValue = seam(),
) => {
  const handleChange = jest.fn()
  const ref = createRef<MarkdownVisualEditorHandle>()
  const view = render(
    <Aglyn.ScreenLinkContext.Provider
      value={{ screens: SCREENS, labels: LABELS, suppressNavigation: true }}
    >
      <Aglyn.LinkTargetSearchContext.Provider value={search}>
        <MarkdownVisualEditor
          ref={ref}
          value={initial}
          onChange={handleChange}
        />
      </Aglyn.LinkTargetSearchContext.Provider>
    </Aglyn.ScreenLinkContext.Provider>,
  )
  return { ...view, handleChange, ref, search }
}

const lastEmitted = (handleChange: jest.Mock): string =>
  handleChange.mock.calls[handleChange.mock.calls.length - 1]?.[0]

/** Places a DOM selection at plain-text offsets inside the first row. */
const selectIn = (rowEl: HTMLElement, start: number, end = start) => {
  const walk = (target: number) => {
    const walker = document.createTreeWalker(rowEl, NodeFilter.SHOW_TEXT)
    let remaining = target
    let node = walker.nextNode()
    let last: Text | null = null
    while (node) {
      const text = node as Text
      if (remaining <= text.length) return { node: text, offset: remaining }
      remaining -= text.length
      last = text
      node = walker.nextNode()
    }
    return last
      ? { node: last, offset: last.length }
      : { node: rowEl as Node, offset: 0 }
  }
  const from = walk(start)
  const to = walk(end)
  const range = document.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const lookup = () => screen.getByRole('combobox') as HTMLInputElement
/**
 * Focus is load-bearing twice over: an unfocused Autocomplete resets its own
 * text on every render, and the dialog opens its list on focus — so clicking
 * an already-open list would toggle it shut.
 */
const openLookup = () => {
  const box = lookup()
  box.focus()
  if (box.getAttribute('aria-expanded') !== 'true') fireEvent.mouseDown(box)
}
const typeInLookup = (text: string) => {
  const box = lookup()
  box.focus()
  fireEvent.change(box, { target: { value: text } })
}

describe('the link dialog writes references (AGL-3119)', () => {
  it('stores a picked page as `screen:<id>`, not as its path today', () => {
    const { handleChange, ref } = renderEditor('read the docs today')
    selectIn(document.querySelector('[data-row-kind]') as HTMLElement, 9, 13)
    act(() => ref.current?.exec('link'))
    openLookup()
    fireEvent.click(screen.getByRole('option', { name: 'Pricing (/pricing)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(lastEmitted(handleChange)).toBe(
      'read the [docs](screen:s1) today',
    )
  })

  it('offers the collection listing as a target too', () => {
    const { handleChange, ref } = renderEditor('see the blog')
    selectIn(document.querySelector('[data-row-kind]') as HTMLElement, 8, 12)
    act(() => ref.current?.exec('link'))
    openLookup()
    fireEvent.click(
      screen.getByRole('option', { name: 'Blog (/blog) — collection listing' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(lastEmitted(handleChange)).toBe('see the [blog](collection:blog)')
  })

  it('finds an entry through the search and links it by its ids', async () => {
    jest.useFakeTimers()
    try {
      const { handleChange, ref, search } = renderEditor('read this post')
      selectIn(document.querySelector('[data-row-kind]') as HTMLElement, 5, 14)
      act(() => ref.current?.exec('link'))
      openLookup()
      typeInLookup('hello')
      await act(async () => {
        jest.advanceTimersByTime(Aglyn.LINK_TARGET_SEARCH_DEBOUNCE_MS + 10)
      })
      expect(search.searchEntries).toHaveBeenCalledWith('hello', {
        signal: expect.any(AbortSignal),
      })
      fireEvent.click(screen.getByRole('option', { name: ENTRY.label }))
      fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
      expect(lastEmitted(handleChange)).toBe(
        'read [this post](entry:blog/9fKqR)',
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps writing a typed address when the author wants one', () => {
    const { handleChange, ref } = renderEditor('read the docs today')
    selectIn(document.querySelector('[data-row-kind]') as HTMLElement, 9, 13)
    act(() => ref.current?.exec('link'))
    openLookup()
    fireEvent.click(screen.getByRole('option', { name: /External URL/ }))
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(lastEmitted(handleChange)).toBe(
      'read the [docs](https://example.com) today',
    )
  })

  it('falls back to the target’s NAME for the link text, never its reference', () => {
    const { handleChange, ref } = renderEditor('Read more: ')
    selectIn(document.querySelector('[data-row-kind]') as HTMLElement, 11)
    act(() => ref.current?.exec('link'))
    openLookup()
    fireEvent.click(screen.getByRole('option', { name: 'Pricing (/pricing)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    // `[screen:s1](screen:s1)` is what a reference-as-text would read like.
    expect(lastEmitted(handleChange)).toContain('[Pricing](screen:s1)')
  })
})

describe('what the editor shows for a reference (AGL-3119)', () => {
  it('names the target in the link popover, not its stored ids', async () => {
    const search = seam()
    renderEditor('See [this post](entry:blog/9fKqR) now', search)
    fireEvent.click(document.querySelector('[data-md-link]') as HTMLElement)
    await act(async () => undefined)
    expect(search.describeTarget).toHaveBeenCalledWith('entry:blog/9fKqR')
    expect(screen.getByText(`Links to ${ENTRY.label}`)).toBeTruthy()
    expect(screen.queryByText('entry:blog/9fKqR')).toBeNull()
  })

  it('names a page reference from the routing map, with no read at all', async () => {
    const search = seam()
    renderEditor('See [pricing](screen:s1) now', search)
    fireEvent.click(document.querySelector('[data-md-link]') as HTMLElement)
    expect(screen.getByText('Links to Pricing (/pricing)')).toBeTruthy()
    expect(search.describeTarget).not.toHaveBeenCalled()
  })

  it('still shows a plain URL as the address it is', () => {
    renderEditor('See [docs](https://example.com) now')
    fireEvent.click(document.querySelector('[data-md-link]') as HTMLElement)
    expect(screen.getByText('https://example.com')).toBeTruthy()
  })

  it('reopens an edited reference on the target it names', async () => {
    const search = seam()
    renderEditor('See [this post](entry:blog/9fKqR) now', search)
    fireEvent.click(document.querySelector('[data-md-link]') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await act(async () => undefined)
    expect(lookup().value).toBe(ENTRY.label)
    // Editing a link keeps its text: only the target is in question.
    expect(screen.queryByLabelText('Text')).toBeNull()
  })
})

describe('the same link on the raw-source surface', () => {
  it('writes the reference over the selection', () => {
    const edit = applyLinkToSource('read the docs today', 9, 13, {
      href: 'entry:blog/9fKqR',
      text: 'this post',
    })
    expect(edit.body).toBe('read the [this post](entry:blog/9fKqR) today')
    expect(edit.body.slice(edit.start, edit.end)).toBe(
      '[this post](entry:blog/9fKqR)',
    )
  })

  it('keeps the selected words when the dialog was given no text', () => {
    const edit = applyLinkToSource('read the docs today', 9, 13, {
      href: 'screen:s1',
    })
    expect(edit.body).toBe('read the [docs](screen:s1) today')
  })
})

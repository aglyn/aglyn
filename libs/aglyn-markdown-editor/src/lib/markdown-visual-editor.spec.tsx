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

import { act, fireEvent, render, screen } from '@testing-library/react'
import React, { createRef, useState } from 'react'

import MarkdownVisualEditor, {
  markdownToRows,
  rowsToMarkdown,
  type MarkdownVisualEditorHandle,
} from './markdown-visual-editor.component'

const rowEls = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-row-kind]'))

/** Places a DOM selection inside a row at plain-text offsets. */
const selectIn = (rowEl: HTMLElement, start: number, end = start) => {
  const walker = document.createTreeWalker(rowEl, NodeFilter.SHOW_TEXT)
  const resolve = (target: number): { node: Node; offset: number } => {
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
    if (last) return { node: last, offset: last.length }
    return { node: rowEl, offset: 0 }
  }
  const from = resolve(start)
  // The walker is forward-only; rebuild for the end position.
  const endWalker = document.createTreeWalker(rowEl, NodeFilter.SHOW_TEXT)
  let remaining = end
  let node = endWalker.nextNode()
  let to: { node: Node; offset: number } = from
  let lastText: Text | null = null
  while (node) {
    const text = node as Text
    if (remaining <= text.length) {
      to = { node: text, offset: remaining }
      break
    }
    remaining -= text.length
    lastText = text
    node = endWalker.nextNode()
  }
  if (!node && lastText) to = { node: lastText, offset: lastText.length }
  const range = document.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const renderEditor = (initial: string) => {
  const handleChange = jest.fn()
  const ref = createRef<MarkdownVisualEditorHandle>()
  const view = render(
    <MarkdownVisualEditor ref={ref} value={initial} onChange={handleChange} />,
  )
  return { ...view, handleChange, ref }
}

const lastEmitted = (handleChange: jest.Mock): string =>
  handleChange.mock.calls[handleChange.mock.calls.length - 1]?.[0]

describe('markdownToRows / rowsToMarkdown', () => {
  it('flattens lists to item rows and regroups them losslessly', () => {
    const source =
      '## Title\n\nIntro **bold**.\n\n- one\n- two\n\n' +
      '![Pic](https://cdn.example.com/p.png)\n\nOutro.'
    const rows = markdownToRows(source)
    expect(rows.map((row) => row.kind)).toEqual([
      'heading2',
      'paragraph',
      'listItem',
      'listItem',
      'image',
      'paragraph',
    ])
    expect(rowsToMarkdown(rows)).toBe(source)
  })

  it('carries code blocks and tables through untouched (AGL-974)', () => {
    // This editor writes marketplace READMEs, so a block it cannot
    // represent used to be DELETED the next time the author saved.
    const source =
      'Intro.\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n' +
      '| Prop | Default |\n| --- | --: |\n| size | 8 |\n\nOutro.'
    const rows = markdownToRows(source)
    expect(rows.map((row) => row.kind)).toEqual([
      'paragraph',
      'code',
      'table',
      'paragraph',
    ])
    expect(rowsToMarkdown(rows)).toBe(source)
  })

  it('carries quotes as editable rows and round-trips them (AGL-1315)', () => {
    const source = 'Intro.\n\n> A **pull** quote.\n\nOutro.'
    const rows = markdownToRows(source)
    expect(rows.map((row) => row.kind)).toEqual([
      'paragraph',
      'quote',
      'paragraph',
    ])
    expect(rowsToMarkdown(rows)).toBe(source)
  })

  it('carries numbered items as rows and round-trips them (AGL-1320)', () => {
    const source = 'Intro.\n\n1. step **one**\n2. step two\n\nOutro.'
    const rows = markdownToRows(source)
    expect(rows.map((row) => row.kind)).toEqual([
      'paragraph',
      'orderedItem',
      'orderedItem',
      'paragraph',
    ])
    expect(rowsToMarkdown(rows)).toBe(source)
  })

  it('keeps a non-1 start on the row that opens the run (AGL-1320)', () => {
    // Without this the flat row model would silently renumber a notice that
    // resumes at 7 down to 1 on the author's next save.
    const source = '7. seven\n8. eight'
    const rows = markdownToRows(source)
    expect(rows.map((row) => (row as { start?: number }).start)).toEqual([
      7,
      undefined,
    ])
    expect(rowsToMarkdown(rows)).toBe(source)
  })

  it('regroups adjacent numbered rows into one list, bullets apart (AGL-1320)', () => {
    const source = '- bullet\n\n1. number\n2. another'
    const rows = markdownToRows(source)
    expect(rows.map((row) => row.kind)).toEqual([
      'listItem',
      'orderedItem',
      'orderedItem',
    ])
    expect(rowsToMarkdown(rows)).toBe(source)
  })

  it('yields a single empty paragraph for an empty document', () => {
    const rows = markdownToRows('')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('paragraph')
    expect(rowsToMarkdown(rows)).toBe('')
  })
})

describe('MarkdownVisualEditor', () => {
  it('renders the parsed blocks as an editable surface', () => {
    renderEditor(
      '## Head\n\nA **bold** and *italic* [link](https://example.com).\n\n' +
        '- item\n\n![Alt](https://cdn.example.com/i.png)',
    )
    const rows = rowEls()
    expect(rows.map((row) => row.dataset['rowKind'])).toEqual([
      'heading2',
      'paragraph',
      'listItem',
      'image',
    ])
    expect(rows[1]?.querySelector('strong')?.textContent).toBe('bold')
    expect(rows[1]?.querySelector('em')?.textContent).toBe('italic')
    expect(
      rows[1]?.querySelector('[data-md-link]')?.getAttribute('data-md-href'),
    ).toBe('https://example.com')
    expect(rows[3]?.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/i.png',
    )
    // Text rows are live contentEditable surfaces; images are not.
    expect(rows[0]?.getAttribute('contenteditable')).toBe('true')
    expect(rows[3]?.getAttribute('contenteditable')).toBe('false')
  })

  it('renders code and table rows as their own editing surfaces (AGL-983)', () => {
    renderEditor(
      'Intro\n\n```ts\nconst a = 1\n```\n\n' +
        '| Prop | Default |\n| --- | --- |\n| size | 8 |',
    )
    const rows = rowEls()
    expect(rows.map((row) => row.dataset['rowKind'])).toEqual([
      'paragraph',
      'code',
      'table',
    ])
    // The snippet is a textarea over row.text, not a frozen <pre>.
    expect(
      rows[1]?.querySelector<HTMLTextAreaElement>('textarea')?.value,
    ).toBe('const a = 1')
    // The row itself stays out of the document's caret flow; the surfaces
    // inside it are what the caret enters.
    expect(rows[1]?.getAttribute('contenteditable')).toBe('false')
    const headerCells = Array.from(rows[2]?.querySelectorAll('th') ?? [])
    expect(
      headerCells
        .filter((cell) => cell.getAttribute('contenteditable') === 'true')
        .map((cell) => cell.textContent),
    ).toEqual(['Prop', 'Default'])
    expect(
      Array.from(rows[2]?.querySelectorAll('td') ?? [])
        .filter((cell) => cell.getAttribute('contenteditable') === 'true')
        .map((cell) => cell.textContent),
    ).toEqual(['size', '8'])
  })

  it('inserts a code block and a table from the toolbar (AGL-983)', () => {
    const ref = createRef<MarkdownVisualEditorHandle>()
    const onChange = jest.fn()
    render(
      <MarkdownVisualEditor ref={ref} value={'Intro'} onChange={onChange} />,
    )
    act(() => ref.current?.exec('code'))
    act(() => ref.current?.exec('table'))
    // Each insert leaves a paragraph behind it — a caret landing spot, so
    // the document never ends on a block the caret cannot enter.
    expect(rowEls().map((row) => row.dataset['rowKind'])).toEqual([
      'paragraph',
      'code',
      'paragraph',
      'table',
      'paragraph',
    ])
    // An empty starter table still serializes as a real table, so what the
    // author sees is what the listing renders.
    expect(onChange).toHaveBeenLastCalledWith(
      'Intro\n\n```\n```\n\n|  |  |\n| --- | --- |\n|  |  |\n|  |  |',
    )
  })

  it('typing syncs the DOM back into the model', () => {
    const { handleChange } = renderEditor('Hello world')
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello brave world'
    fireEvent.input(row)
    expect(lastEmitted(handleChange)).toBe('Hello brave world')
  })

  it('typing inside a bold run keeps the mark in the model', () => {
    const { handleChange } = renderEditor('a **bold** c')
    const row = rowEls()[0] as HTMLElement
    const strong = row.querySelector('strong') as HTMLElement
    strong.textContent = 'bolder'
    fireEvent.input(row)
    expect(lastEmitted(handleChange)).toBe('a **bolder** c')
  })

  it('toolbar bold wraps the selection and re-renders it as <strong>', () => {
    const { handleChange, ref } = renderEditor('Hello world')
    const row = rowEls()[0] as HTMLElement
    selectIn(row, 6, 11)
    act(() => ref.current?.exec('bold'))
    expect(lastEmitted(handleChange)).toBe('Hello **world**')
    expect(rowEls()[0]?.querySelector('strong')?.textContent).toBe('world')
  })

  it('toolbar bold on an all-bold selection unwraps it', () => {
    const { handleChange, ref } = renderEditor('Hello **world**')
    const row = rowEls()[0] as HTMLElement
    selectIn(row, 6, 11)
    act(() => ref.current?.exec('bold'))
    expect(lastEmitted(handleChange)).toBe('Hello world')
  })

  it('toolbar heading toggles the caret row between paragraph and H2', () => {
    const { handleChange, ref } = renderEditor('Hello world')
    selectIn(rowEls()[0] as HTMLElement, 3)
    act(() => ref.current?.exec('heading'))
    expect(lastEmitted(handleChange)).toBe('## Hello world')
    expect(rowEls()[0]?.dataset['rowKind']).toBe('heading2')
    selectIn(rowEls()[0] as HTMLElement, 3)
    act(() => ref.current?.exec('heading'))
    expect(lastEmitted(handleChange)).toBe('Hello world')
  })

  it('Enter splits a paragraph at the caret', () => {
    const { handleChange } = renderEditor('Hello world')
    const row = rowEls()[0] as HTMLElement
    selectIn(row, 6)
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(lastEmitted(handleChange)).toBe('Hello\n\nworld')
    expect(rowEls()).toHaveLength(2)
  })

  it('Enter in a list item continues the list; on an empty item exits it', () => {
    const { handleChange } = renderEditor('- one')
    const row = rowEls()[0] as HTMLElement
    selectIn(row, 3)
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(rowEls().map((el) => el.dataset['rowKind'])).toEqual([
      'listItem',
      'listItem',
    ])
    const empty = rowEls()[1] as HTMLElement
    selectIn(empty, 1)
    fireEvent.keyDown(empty, { key: 'Enter' })
    expect(rowEls().map((el) => el.dataset['rowKind'])).toEqual([
      'listItem',
      'paragraph',
    ])
    expect(lastEmitted(handleChange)).toBe('- one')
  })

  it('Backspace at the start of a paragraph merges it into the previous', () => {
    const { handleChange } = renderEditor('Hello\n\nworld')
    const second = rowEls()[1] as HTMLElement
    selectIn(second, 0)
    fireEvent.keyDown(second, { key: 'Backspace' })
    expect(lastEmitted(handleChange)).toBe('Helloworld')
    expect(rowEls()).toHaveLength(1)
  })

  it('Backspace at the start of a heading demotes it to a paragraph', () => {
    const { handleChange } = renderEditor('## Title')
    const row = rowEls()[0] as HTMLElement
    selectIn(row, 0)
    fireEvent.keyDown(row, { key: 'Backspace' })
    expect(lastEmitted(handleChange)).toBe('Title')
    expect(rowEls()[0]?.dataset['rowKind']).toBe('paragraph')
  })

  it('converts "## " and "- " prefixes typed at a paragraph start', () => {
    const { handleChange } = renderEditor('')
    const row = rowEls()[0] as HTMLElement
    row.textContent = '## Title'
    fireEvent.input(row)
    expect(lastEmitted(handleChange)).toBe('## Title')
    expect(rowEls()[0]?.dataset['rowKind']).toBe('heading2')

    const { handleChange: listChange } = renderEditor('')
    const listRow = rowEls()
      .filter((el) => el.dataset['rowKind'] === 'paragraph')
      .pop() as HTMLElement
    listRow.textContent = '- item'
    fireEvent.input(listRow)
    expect(lastEmitted(listChange)).toBe('- item')
  })

  it('converts a "> " prefix to a quote row (AGL-1315)', () => {
    const { handleChange } = renderEditor('')
    const row = rowEls()[0] as HTMLElement
    row.textContent = '> wisdom'
    fireEvent.input(row)
    expect(rowEls()[0]?.dataset['rowKind']).toBe('quote')
    expect(lastEmitted(handleChange)).toBe('> wisdom')
  })

  it('renders numbered source as numbered rows, seeding the run (AGL-1320)', () => {
    // The fifth renderer of the block union. Rows are siblings rather than
    // children of an <ol>, so the run's start rides on the opener as a
    // counter seed — `7.` means the counter starts one below seven.
    renderEditor('Intro.\n\n7. seven\n8. eight')
    const rows = rowEls()
    expect(rows.map((row) => row.dataset['rowKind'])).toEqual([
      'paragraph',
      'orderedItem',
      'orderedItem',
    ])
    expect(rows[1]?.style.counterReset).toBe('md-ordered 6')
    expect(rows[2]?.style.counterReset).toBe('')
    // No literal marker leaks into the editable text.
    expect(rows[1]?.textContent).toBe('seven')
  })

  it('converts a "1. " prefix to a numbered row (AGL-1320)', () => {
    const { handleChange } = renderEditor('')
    const row = rowEls()[0] as HTMLElement
    row.textContent = '1. first step'
    fireEvent.input(row)
    expect(rowEls()[0]?.dataset['rowKind']).toBe('orderedItem')
    expect(lastEmitted(handleChange)).toBe('1. first step')
  })

  it('opens a numbered run at the number that was typed (AGL-1320)', () => {
    const { handleChange } = renderEditor('')
    const row = rowEls()[0] as HTMLElement
    row.textContent = '4) fourth step'
    fireEvent.input(row)
    expect(rowEls()[0]?.dataset['rowKind']).toBe('orderedItem')
    // `)` normalizes to `.`, and the typed number survives as the start.
    expect(lastEmitted(handleChange)).toBe('4. fourth step')
  })

  it('converts a "# " prefix to a heading too (AGL-1082)', () => {
    // Typing must agree with pasting: the parser clamps `#` to the top
    // rendered level, so the shortcut has to reach the same row kind rather
    // than leaving a literal hash behind.
    const { handleChange } = renderEditor('')
    const row = rowEls()[0] as HTMLElement
    row.textContent = '# Office Hours'
    fireEvent.input(row)
    expect(rowEls()[0]?.dataset['rowKind']).toBe('heading2')
    expect(lastEmitted(handleChange)).toBe('## Office Hours')
  })

  it('pastes clipboard text as plain text at the caret', () => {
    const { handleChange } = renderEditor('ab')
    const row = rowEls()[0] as HTMLElement
    selectIn(row, 1)
    fireEvent.paste(row, {
      clipboardData: { getData: () => '**pasted**\nlines' },
    })
    // Formatting is NOT interpreted and newlines flatten to spaces.
    expect(lastEmitted(handleChange)).toBe('a**pasted** linesb')
  })

  it('clicking a link opens the popover; Remove unwraps it to text', async () => {
    const { handleChange } = renderEditor(
      'See [docs](https://example.com) now',
    )
    const link = document.querySelector('[data-md-link]') as HTMLElement
    fireEvent.click(link)
    expect(await screen.findByText('https://example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(lastEmitted(handleChange)).toBe('See docs now')
    expect(document.querySelector('[data-md-link]')).toBeNull()
  })

  it('toolbar link wraps the selection through the URL dialog', async () => {
    const { handleChange, ref } = renderEditor('read the docs today')
    const row = rowEls()[0] as HTMLElement
    selectIn(row, 9, 13)
    act(() => ref.current?.exec('link'))
    const url = await screen.findByLabelText('URL')
    fireEvent.change(url, { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(lastEmitted(handleChange)).toBe(
      'read the [docs](https://example.com) today',
    )
  })

  it('toolbar image inserts an image block through the URL dialog', async () => {
    const { handleChange, ref } = renderEditor('Hello')
    selectIn(rowEls()[0] as HTMLElement, 5)
    act(() => ref.current?.exec('image'))
    const url = await screen.findByLabelText('URL')
    fireEvent.change(url, {
      target: { value: 'https://cdn.example.com/p.png' },
    })
    fireEvent.change(screen.getByLabelText('Alt text'), {
      target: { value: 'Pic' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(lastEmitted(handleChange)).toBe(
      'Hello\n\n![Pic](https://cdn.example.com/p.png)',
    )
  })

  it('insertImage (media picker) appends an image block', () => {
    const { handleChange, ref } = renderEditor('Hello')
    act(() =>
      ref.current?.insertImage('Shot', 'https://cdn.example.com/s.png'),
    )
    expect(lastEmitted(handleChange)).toBe(
      'Hello\n\n![Shot](https://cdn.example.com/s.png)',
    )
  })

  it('Cmd/Ctrl+Z undoes through the model snapshot stack', () => {
    const { handleChange } = renderEditor('Hello')
    const row = rowEls()[0] as HTMLElement
    row.textContent = 'Hello there'
    fireEvent.input(row)
    expect(lastEmitted(handleChange)).toBe('Hello there')
    fireEvent.keyDown(rowEls()[0] as HTMLElement, { key: 'z', ctrlKey: true })
    expect(lastEmitted(handleChange)).toBe('Hello')
    fireEvent.keyDown(rowEls()[0] as HTMLElement, {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
    })
    expect(lastEmitted(handleChange)).toBe('Hello there')
  })

  it('re-parses when the value changes externally (AI assist)', () => {
    const { rerender } = renderEditor('Hello')
    rerender(
      <MarkdownVisualEditor
        value={'## Rewritten\n\nBody'}
        onChange={jest.fn()}
      />,
    )
    expect(rowEls().map((el) => el.dataset['rowKind'])).toEqual([
      'heading2',
      'paragraph',
    ])
  })
})

/** Mimics the page's Visual/Markdown tabs over one shared body string. */
const TabHarness = ({ initial }: { initial: string }) => {
  const [body, setBody] = useState(initial)
  const [tab, setTab] = useState<'visual' | 'markdown'>('visual')
  return (
    <>
      <button
        onClick={() =>
          setTab((prev) => (prev === 'visual' ? 'markdown' : 'visual'))
        }
      >
        {'toggle'}
      </button>
      {tab === 'visual' ? (
        <MarkdownVisualEditor value={body} onChange={setBody} />
      ) : (
        <textarea
          aria-label="Body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      )}
    </>
  )
}

describe('mode toggle', () => {
  it('preserves content across Visual <-> Markdown switches', () => {
    render(<TabHarness initial={'## Hi\n\nBody text'} />)
    // Edit in Visual mode.
    const paragraph = rowEls()[1] as HTMLElement
    paragraph.textContent = 'Body text edited'
    fireEvent.input(paragraph)
    // Switch to Markdown: the textarea sees the serialized string.
    fireEvent.click(screen.getByText('toggle'))
    const textarea = screen.getByLabelText('Body') as HTMLTextAreaElement
    expect(textarea.value).toBe('## Hi\n\nBody text edited')
    // Edit raw markdown, switch back: the editor re-parses it.
    fireEvent.change(textarea, {
      target: { value: '## Hi\n\nBody text edited\n\n- new item' },
    })
    fireEvent.click(screen.getByText('toggle'))
    const kinds = rowEls().map((el) => el.dataset['rowKind'])
    expect(kinds).toEqual(['heading2', 'paragraph', 'listItem'])
    expect(rowEls()[2]?.textContent).toBe('new item')
  })
})

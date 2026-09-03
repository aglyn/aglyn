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
 * AGL-2486 item 17 — "typing a comma or Enter while adding a style sometimes
 * clears the entire JSON window".
 *
 * Reproduced in the real editor first: one comma inside `Edit -> Raw JSON` on
 * a besigner screen replaced a 37-line document with `{}`, and the console
 * carried `Error occurred in JsonEditor during parse` from
 * `JsonEditorRaw.useMemo[parsedValue]`. The dialog fed Monaco
 * `JSON.stringify(JSON.parse(buffer) ?? {})`, so a transiently unparseable
 * buffer became the literal document `{}` and Monaco — which treats `value` as
 * authoritative — overwrote the full model range with it.
 *
 * Monaco cannot run under jsdom, so `<Editor>` is replaced here by a double
 * that implements the ONE behaviour the bug lives in. See `FakeMonaco`.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import JsonEditor from './json-editor'

/**
 * Every options object `dynamic()` was called with, in order.
 *
 * `var`, not `const`: `json-editor.tsx` calls `dynamic()` at MODULE scope, so
 * it runs while this spec's own import of it is still evaluating — before a
 * `const` here would have initialized, which is a TDZ ReferenceError that
 * fails the whole suite. A `var` is hoisted as `undefined` and assigned on
 * first use instead.
 *
 * `no-var` is disabled rather than obeyed: the rule exists to stop hoisting
 * being relied on by accident, and here it is the whole point. Obeying it
 * reintroduces the TDZ error the comment above describes.
 */
// eslint-disable-next-line no-var
var mockDynamicOptions: any[] | undefined

jest.mock('next/dynamic', () => ({
  __esModule: true,
  // `json-editor.tsx` has exactly one dynamic import: the Monaco editor.
  // `mockEditor` is only dereferenced when the component renders, which is
  // after this module body has run.
  default: (_loader: any, options: any) => {
    if (!mockDynamicOptions) mockDynamicOptions = []
    mockDynamicOptions.push(options)
    return (props: any) => mockEditor(props)
  },
}))

/**
 * A stand-in for `@monaco-editor/react`'s `<Editor>`.
 *
 * De-minified from `@monaco-editor/react` 4.7.0 (`dist/index.js`), the value
 * effect is:
 *
 *   useUpdate(() => {
 *     if (!editor || value === undefined) return
 *     if (readOnly) editor.setValue(value)
 *     else if (value !== editor.getValue()) {
 *       suppress = true
 *       editor.executeEdits('', [{ range: fullModelRange, text: value,
 *                                  forceMoveMarkers: true }])
 *       editor.pushUndoStop()
 *       suppress = false
 *     }
 *   }, [value], isEditorReady)
 *
 * with `onChange` wired as `onDidChangeModelContent(() => suppress || onChange(...))`.
 *
 * Three properties carry the defect and all three are reproduced:
 *  - the effect runs on UPDATES only, never on mount (`useUpdate`);
 *  - it replaces the FULL model range, i.e. the whole buffer, not a diff;
 *  - `onChange` is SUPPRESSED for that programmatic edit, so the parent's
 *    state keeps text the editor is no longer showing.
 *
 * Everything else about Monaco — tokenising, markers, the view — is irrelevant
 * to whether a keystroke can destroy the buffer, and is not modelled.
 */
const FakeMonaco = (props: any) => {
  const { value, defaultValue, onChange } = props
  // Uncontrolled on purpose: Monaco's model is its own mutable buffer, not
  // React state, and the parent reaches into it imperatively. A controlled
  // textarea would model a component this editor is not.
  const box = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (value === undefined || !box.current) return
    // `executeEdits` over the full model range, with `onChange` suppressed.
    if (value !== box.current.value) box.current.value = value
  }, [value])

  return (
    <textarea
      ref={box}
      aria-label="Raw JSON editor"
      defaultValue={value ?? defaultValue ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )
}

const mockEditor = (props: any) => <FakeMonaco {...props} />

/** The `{}` a failed `JSON.parse` used to be defaulted to. */
const WIPED = '{}'

const DOC = {
  $id: '_@_',
  props: { variant: 'h1', align: 'center' },
}

const editor = () =>
  screen.getByLabelText('Raw JSON editor') as HTMLTextAreaElement

/** Clear the "Advanced Feature Ahead!" gate that hides the editor. */
const dismissWarning = () => {
  const alert = screen
    .getByText('Warning: Advanced Feature Ahead!')
    .closest('.MuiAlert-root') as HTMLElement
  fireEvent.click(within(alert).getByRole('button'))
}

/** Type `next` into the editor, the way Monaco reports a keystroke. */
const type = (next: string) =>
  fireEvent.change(editor(), { target: { value: next } })

describe('JsonEditor', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<JsonEditor open={false} />)
    expect(baseElement).toBeTruthy()
  })

  describe('the editor is loading before it is needed (AGL-2541)', () => {
    it('mounts the editor UNDER the warning, not instead of it', () => {
      render(<JsonEditor open defaultValue={DOC as any} />)

      // Both, at once. The warning gate used to be an `If`/`Else`, so the
      // editor was not rendered at all while the warning stood — its chunk
      // was never requested and Monaco's loader never ran. Dismissing the
      // warning then started a download from cold, against a pane that shows
      // nothing while it waits, which is what "the editor never mounts" was.
      expect(
        screen.getByText('Warning: Advanced Feature Ahead!'),
      ).toBeTruthy()
      expect(editor()).toBeTruthy()
    })

    it('seeds that editor with the document, not with an empty buffer', () => {
      // Mounting it early is only safe if it mounts with the real document:
      // an editor warmed on `{}` would hand the author a wiped buffer the
      // moment they dismissed the warning.
      render(<JsonEditor open defaultValue={DOC as any} />)
      expect(editor().value).toBe(JSON.stringify(DOC, null, 2))
      expect(editor().value).not.toBe(WIPED)
    })

    it('gives the dynamic import something visible to render while it waits', () => {
      // `dynamic()` with no `loading` renders `null` — the same empty box for
      // "still downloading" and for "this will never arrive". The blank pane
      // with no console error was indistinguishable from a broken build.
      const [options] = mockDynamicOptions ?? []
      expect(options?.ssr).toBe(false)
      expect(typeof options?.loading).toBe('function')
    })
  })

  describe('a transiently invalid buffer (AGL-2486 item 17)', () => {
    it('keeps the whole document when a comma makes it unparseable', () => {
      render(<JsonEditor open defaultValue={DOC as any} />)
      dismissWarning()

      const seeded = editor().value
      expect(seeded).toContain('"align": "center"')

      // The exact reported keystroke: a comma after the last property, which
      // leaves a trailing comma before `}` and so does not parse.
      const withComma = seeded.replace('"align": "center"', '"align": "center",')
      expect(() => JSON.parse(withComma)).toThrow()
      type(withComma)

      expect(editor().value).toBe(withComma)
      expect(editor().value).not.toBe(WIPED)
    })

    it('keeps the buffer when Enter splits it mid-token', () => {
      render(<JsonEditor open defaultValue={DOC as any} />)
      dismissWarning()

      const withNewline = editor().value.replace('"align"', '"ali\ngn"')
      expect(() => JSON.parse(withNewline)).toThrow()
      type(withNewline)

      expect(editor().value).toBe(withNewline)
    })

    it('says so, visibly, without touching the text', () => {
      render(<JsonEditor open defaultValue={DOC as any} />)
      dismissWarning()

      expect(screen.queryByText(/Not valid JSON yet/)).toBeNull()

      const broken = editor().value.replace('"align": "center"', '"align":')
      type(broken)

      expect(screen.getByText(/Not valid JSON yet/)).toBeTruthy()
      expect(
        screen.getByText(/kept exactly as typed/),
      ).toBeTruthy()
      expect(editor().value).toBe(broken)
    })

    it('does not reformat valid text the author typed', () => {
      render(<JsonEditor open defaultValue={DOC as any} />)
      dismissWarning()

      // Valid, but not 2-space pretty-printed. Round-tripping it through
      // JSON.parse/stringify rewrote the buffer under the cursor.
      const compact = '{"$id":"_@_","props":{"variant":"h1"}}'
      type(compact)

      expect(editor().value).toBe(compact)
    })
  })

  describe('the buffer survives what happens around it', () => {
    it('is not re-seeded by a re-render with an equal document', () => {
      const { rerender } = render(
        <JsonEditor open defaultValue={{ ...DOC } as any} />,
      )
      dismissWarning()

      const edited = editor().value.replace('"h1"', '"h2"')
      type(edited)

      // A new object identity holding the same content — what every call site
      // passes, because `Aglyn.canvas.nestedNodes` rebuilds on each read.
      rerender(<JsonEditor open defaultValue={{ ...DOC } as any} />)

      expect(editor().value).toBe(edited)
    })

    it('is not re-seeded when the stored document changes underneath it', () => {
      const { rerender } = render(
        <JsonEditor open defaultValue={DOC as any} />,
      )
      dismissWarning()

      const edited = editor().value.replace('"h1"', '"h2"')
      type(edited)

      rerender(
        <JsonEditor
          open
          defaultValue={{ ...DOC, props: { variant: 'h5' } } as any}
        />,
      )

      expect(editor().value).toBe(edited)
    })

    it('still follows the document while the buffer is pristine', () => {
      const { rerender } = render(
        <JsonEditor open defaultValue={DOC as any} />,
      )
      dismissWarning()
      expect(editor().value).toContain('"h1"')

      rerender(
        <JsonEditor
          open
          defaultValue={{ ...DOC, props: { variant: 'h5' } } as any}
        />,
      )

      expect(editor().value).toContain('"h5"')
    })

    it('ignores a backdrop click while the buffer is unsaved', () => {
      const onClose = jest.fn()
      render(<JsonEditor open defaultValue={DOC as any} onClose={onClose} />)
      dismissWarning()

      type(editor().value.replace('"h1"', '"h2"'))
      fireEvent.click(document.querySelector('.MuiBackdrop-root') as Element)

      expect(onClose).not.toHaveBeenCalled()

      // Cancel is a deliberate act and still closes.
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onClose).toHaveBeenCalledWith(expect.anything(), 'cancelClick')
    })
  })

  describe('saving still works', () => {
    it('commits the parsed document', () => {
      const onSave = jest.fn()
      render(<JsonEditor open defaultValue={DOC as any} onSave={onSave} />)
      dismissWarning()

      type('{"$id":"_@_","props":{"variant":"h2"}}')
      fireEvent.click(screen.getByRole('button', { name: 'Save JSON' }))

      expect(onSave).toHaveBeenCalledWith(expect.anything(), {
        $id: '_@_',
        props: { variant: 'h2' },
      })
    })

    it('refuses an unparseable buffer and leaves it alone', () => {
      const onSave = jest.fn()
      render(<JsonEditor open defaultValue={DOC as any} onSave={onSave} />)
      dismissWarning()

      const broken = '{"$id":"_@_",}'
      type(broken)
      fireEvent.click(screen.getByRole('button', { name: 'Save JSON' }))

      expect(onSave).not.toHaveBeenCalled()
      expect(editor().value).toBe(broken)
    })
  })
})

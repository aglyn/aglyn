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

import CustomCssForm, {
  jsonDraftProblem,
  resetPendingCustomCssDrafts,
} from './custom-css-form.component'

/**
 * The JSS (sx) tab must not eat un-applied work (AGL-2486).
 *
 * Reported as "pressing comma or Enter sometimes clears the entire JSON
 * window". The keys are a red herring — nothing in this form is wired to a
 * keystroke, and nothing but Apply writes to the document. What is real is
 * that the buffer lives in `useState` inside a form that gets UNMOUNTED by
 * ordinary authoring: the Styles panel renders "Select an element" whenever
 * the canvas selection empties (a stray click on the artboard does it), and
 * the mode toggle re-seeds the buffers from the stored document. Either way
 * the author's half-written sx goes, and because the trigger is not the key
 * they pressed, it reads as random.
 *
 * These drive the real component through the real canvas, and every case is
 * a loss an author can hit deliberately — no timing, no dev server.
 */
describe('CustomCssForm — the JSS buffer survives (AGL-2486)', () => {
  const seedNode = (sx: Record<string, any>) => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'muiStack', nodes: ['meta'] },
      meta: { $id: 'meta', componentId: 'muiStack', parentId: 'root', sx },
    } as any)
    return Aglyn.canvas.getNode('meta') as Aglyn.NodeSchema
  }

  const jssTab = () => screen.getByRole('button', { name: 'JSS (sx)' })
  const builderTab = () => screen.getByRole('button', { name: 'Builder' })

  /** The one textarea the JSS tab shows. */
  const jssEditor = () => {
    const areas = screen.getAllByRole('textbox') as HTMLTextAreaElement[]
    return areas.find((el) => el.tagName === 'TEXTAREA')!
  }

  const type = (value: string) => {
    act(() => {
      fireEvent.change(jssEditor(), { target: { value } })
    })
  }

  const openJss = () => {
    act(() => {
      fireEvent.click(jssTab())
    })
  }

  beforeEach(() => {
    resetPendingCustomCssDrafts()
  })
  afterEach(() => {
    Aglyn.canvas.reset()
    resetPendingCustomCssDrafts()
  })

  it('keeps a half-typed property when the element is DESELECTED and picked again', () => {
    const node = seedNode({ color: 'red' })
    // `withLastSelectedNode` swaps the whole panel for "Select an element"
    // the moment the selection empties, so an unmount/remount is exactly
    // what a stray canvas click does to this form.
    const { unmount } = render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()
    // Mid-property: a trailing comma is what every new declaration looks
    // like one keystroke before it is finished, and it does not parse.
    type('{\n  "color": "red",\n')
    unmount()

    render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()
    expect(jssEditor().value).toBe('{\n  "color": "red",\n')
    // And the document was never touched by any of it.
    expect(Aglyn.canvas.getNode('meta')?.sx).toEqual({ color: 'red' })
  })

  it('keeps the buffer across a trip through the Builder tab', () => {
    const node = seedNode({ color: 'red' })
    render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()
    type('{ "color": "blue"')

    act(() => {
      fireEvent.click(builderTab())
    })
    openJss()
    expect(jssEditor().value).toBe('{ "color": "blue"')
  })

  it('typing the buffer back to the stored document drops the draft', () => {
    const node = seedNode({ color: 'red' })
    const stored = JSON.stringify({ color: 'red' }, null, 2)
    const { unmount } = render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()
    type('{ "color": "blue"')
    type(stored)
    unmount()

    render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()
    expect(jssEditor().value).toBe(stored)
  })

  it('an invalid buffer is a NON-COMMIT — Apply leaves sx and the text alone', () => {
    const node = seedNode({ color: 'red' })
    render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()
    type('{ "color": "blue",')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply JSS' }))
    })
    expect(Aglyn.canvas.getNode('meta')?.sx).toEqual({ color: 'red' })
    expect(jssEditor().value).toBe('{ "color": "blue",')
    expect(screen.getByText(/not valid json yet/i)).toBeTruthy()
  })

  it('an EMPTY buffer never commits — clearing every style must be spelled {}', () => {
    const node = seedNode({ color: 'red' })
    render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()
    // A genuinely empty buffer is the dangerous one: it used to fall
    // through a `jsonDraft || '{}'` default and commit `{}`, so Select-All
    // and Delete followed by Apply silently deleted every style on the
    // element with nothing said and nothing to read back.
    type('')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply JSS' }))
    })
    expect(Aglyn.canvas.getNode('meta')?.sx).toEqual({ color: 'red' })

    type('   ')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply JSS' }))
    })
    expect(Aglyn.canvas.getNode('meta')?.sx).toEqual({ color: 'red' })

    // ...while the deliberate spelling still works.
    type('{}')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply JSS' }))
    })
    expect(Aglyn.canvas.getNode('meta')?.sx).toEqual({})
  })

  it('a successful Apply clears the pending draft', () => {
    const node = seedNode({ color: 'red' })
    const { unmount } = render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()
    type('{ "color": "blue" }')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply JSS' }))
    })
    expect(Aglyn.canvas.getNode('meta')?.sx).toEqual({ color: 'blue' })
    unmount()

    render(
      <CustomCssForm
        node={Aglyn.canvas.getNode('meta') as Aglyn.NodeSchema}
        breakpoint={null}
      />,
    )
    openJss()
    // Re-seeded from the document, not from the applied text.
    expect(jssEditor().value).toBe(JSON.stringify({ color: 'blue' }, null, 2))
  })
})

/**
 * The commit verdict on its own — the half that decides whether the
 * document is touched at all.
 */
describe('jsonDraftProblem (AGL-2486)', () => {
  it('refuses an empty buffer rather than reading it as {}', () => {
    expect(jsonDraftProblem('')).toMatch(/empty/i)
    expect(jsonDraftProblem('   \n ')).toMatch(/empty/i)
  })

  it('refuses transiently invalid mid-edit JSON', () => {
    expect(jsonDraftProblem('{"a":1,')).toMatch(/not valid json/i)
    expect(jsonDraftProblem('{"a":1,\n')).toMatch(/not valid json/i)
  })

  it('refuses valid JSON that is not an object', () => {
    // `strictNullChecks` is off, so these must be rejected by explicit
    // checks — `!parsed` would fold `null`, `0` and `""` into one verdict
    // and `typeof null` is `'object'`.
    expect(jsonDraftProblem('null')).toMatch(/must be a json object/i)
    expect(jsonDraftProblem('0')).toMatch(/must be a json object/i)
    expect(jsonDraftProblem('""')).toMatch(/must be a json object/i)
    expect(jsonDraftProblem('[]')).toMatch(/must be a json object/i)
  })

  it('accepts a real sx document, including the empty one', () => {
    expect(jsonDraftProblem('{}')).toBeNull()
    expect(jsonDraftProblem('{ "color": "red" }')).toBeNull()
    expect(jsonDraftProblem('{"pt":{"xs":8,"md":14}}')).toBeNull()
  })
})

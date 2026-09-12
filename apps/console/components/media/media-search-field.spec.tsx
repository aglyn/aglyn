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
 * AGL-1460 #1 and #2, driven rather than reasoned about.
 *
 * The reported symptom was that changing the search text does not update the
 * results until you click **Load more**. The harness below is the real path
 * the library uses — the real field, the real matcher, the real state — with
 * only Firestore left out, and the assertion is the literal complaint:
 * type, and the list changes with NO other interaction.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { useMemo, useState } from 'react'

import { MediaSearchField } from './media-search-field.component'
import { parseMediaQuery, searchMedia } from './media-search'

const LIBRARY = [
  { $id: 'a', fileName: 'mock-hero-noshadow.png', tags: ['hero'] },
  { $id: 'b', fileName: 'mock-card-noshadow.png', tags: [] },
  { $id: 'c', fileName: 'mock-card-shadow.png', tags: [] },
  { $id: 'd', fileName: 'logo.svg', tags: ['brand'] },
]

/** The library's own wiring: text -> query -> visible cards, undebounced. */
function Harness() {
  const [search, setSearch] = useState('')
  const result = useMemo(
    () => searchMedia(LIBRARY, parseMediaQuery(search)),
    [search],
  )
  return (
    <div>
      <MediaSearchField
        value={search}
        onChange={setSearch}
        loaded={LIBRARY.length}
        total={LIBRARY.length}
        complete
        completing={false}
        truncated={false}
        mode={result.mode}
        matches={result.items.length}
      />
      <ul data-testid="grid">
        {result.items.map((item: any) => (
          <li key={item.$id}>{item.fileName}</li>
        ))}
      </ul>
    </div>
  )
}

const names = () =>
  Array.from(screen.getByTestId('grid').querySelectorAll('li')).map(
    (node) => node.textContent,
  )

const field = () => screen.getByLabelText('Search') as HTMLInputElement

describe('changing the text updates the results, with no other interaction (AGL-1460 #1)', () => {
  it('re-searches on every change of the box', () => {
    render(<Harness />)
    expect(names()).toHaveLength(4)

    fireEvent.change(field(), { target: { value: 'noshadow' } })
    expect(names()).toEqual([
      'mock-hero-noshadow.png',
      'mock-card-noshadow.png',
    ])

    // The reported bug: this second edit is the one that did not take.
    fireEvent.change(field(), { target: { value: 'logo' } })
    expect(names()).toEqual(['logo.svg'])

    fireEvent.change(field(), { target: { value: 'tag:hero' } })
    expect(names()).toEqual(['mock-hero-noshadow.png'])
  })

  it('restores the full set when the text is deleted', () => {
    render(<Harness />)
    fireEvent.change(field(), { target: { value: 'logo' } })
    expect(names()).toHaveLength(1)
    fireEvent.change(field(), { target: { value: '' } })
    expect(names()).toHaveLength(4)
  })
})

describe('the clear button (AGL-1460 #2)', () => {
  it('is absent while the box is empty', () => {
    render(<Harness />)
    expect(screen.queryByLabelText('Clear search')).toBeNull()
  })

  it('appears once there is something to clear, and clears it', () => {
    render(<Harness />)
    fireEvent.change(field(), { target: { value: 'logo' } })
    expect(names()).toHaveLength(1)

    fireEvent.click(screen.getByLabelText('Clear search'))

    expect(field().value).toBe('')
    expect(names()).toHaveLength(4)
    expect(screen.queryByLabelText('Clear search')).toBeNull()
  })
})

describe('the field reports the true scope of the search (AGL-1460)', () => {
  const props = {
    value: 'hero',
    onChange: () => undefined,
    loaded: 60,
    total: 174,
    complete: false,
    completing: false,
    truncated: false,
    mode: 'exact' as const,
    matches: 1,
  }

  it('names the partial window instead of "Searches loaded files"', () => {
    render(<MediaSearchField {...props} />)
    expect(screen.getByText('Searching 60 of 174 loaded files')).toBeTruthy()
  })

  it('claims the whole library only when it holds it', () => {
    render(<MediaSearchField {...props} loaded={174} complete />)
    expect(screen.getByText('Searched all 174 files')).toBeTruthy()
  })
})


/**
 * The magnifier's identity (AGL-2854).
 *
 * MUI `InputBase` reports its start adornment up to the enclosing
 * `FormControl` from a passive effect keyed on that element:
 *
 * ```js
 * useEffect(() => {
 *   if (muiFormControl) muiFormControl.setAdornedStart(Boolean(startAdornment))
 * }, [muiFormControl, startAdornment])
 * ```
 *
 * Built inline, the adornment is a new element on every render, so the effect
 * re-runs on every render and calls `setAdornedStart` with the value the
 * state already holds. React cannot take the eager-bailout path for that call
 * — the fiber's alternate still carries the lanes of the render being
 * committed — so each one enqueues a real update during the commit's passive
 * flush. React counts those, never resets the count while they keep arriving,
 * and throws error #185 at fifty, unmounting the page.
 *
 * This field sits in the media library's toolbar, which re-renders on every
 * keystroke ANYWHERE on the page — so in production the throw landed on a
 * different control entirely, in the details drawer's Alt text field. That
 * is the shape driven here: a neighbour is typed in, and this field is only
 * along for the re-render.
 *
 * `media-library-input-burst.spec.tsx` drives the same thing through the real
 * page. This one is the cheap guard on the field itself.
 */
describe('MediaSearchField while its neighbours re-render (AGL-2854)', () => {
  /** Past React's NESTED_UPDATE_LIMIT of 50, with margin. */
  const BURST = 60
  const DEPTH = /Maximum update depth exceeded/
  let depthErrors: string[] = []
  // React reports error #185 by dispatching a `window` error rather than by
  // throwing out of `dispatchEvent`.
  const onWindowError = (event: ErrorEvent) => {
    const message = String(event.error?.message ?? event.message ?? '')
    if (!DEPTH.test(message)) return
    depthErrors.push(message)
    event.preventDefault()
  }

  beforeEach(() => {
    depthErrors = []
    window.addEventListener('error', onWindowError)
  })

  afterEach(() => {
    window.removeEventListener('error', onWindowError)
  })

  /** The search box beside a field that owns the state both of them re-render on. */
  function Neighbours() {
    const [caption, setCaption] = useState('')
    return (
      <div>
        <input
          aria-label="Alt text"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
        />
        <MediaSearchField
          value=""
          onChange={() => undefined}
          loaded={4}
          total={4}
          complete
          completing={false}
          truncated={false}
          mode="exact"
          matches={4}
        />
      </div>
    )
  }

  it('does not push React past its update depth', async () => {
    // MUI reads `process.env.NODE_ENV` when it renders, and its development
    // path hands `FormControl` a fresh `registerEffect` every render — which
    // makes the context object new every render on its own, re-running the
    // very effect this asserts about. Under jest's default `NODE_ENV=test`
    // this cannot fail. React itself is unaffected: its build was chosen when
    // the module was first required.
    const previous = process.env.NODE_ENV
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    try {
      render(<Neighbours />)
      const caption = screen.getByLabelText('Alt text') as HTMLInputElement
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set

      // Outside `act`, which would drain the scheduler between keystrokes and
      // reset the nested-update count this is about.
      const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
      const wasAct = env.IS_REACT_ACT_ENVIRONMENT
      env.IS_REACT_ACT_ENVIRONMENT = false
      try {
        for (let index = 1; index <= BURST; index += 1) {
          setValue?.call(caption, 'a'.repeat(index))
          caption.dispatchEvent(new Event('input', { bubbles: true }))
        }
      } finally {
        env.IS_REACT_ACT_ENVIRONMENT = wasAct
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(depthErrors).toEqual([])
      // React unmounts the tree when it throws #185, so the typed text still
      // being on screen is the other half of the claim.
      expect(caption.value).toBe('a'.repeat(BURST))
    } finally {
      ;(process.env as Record<string, string>).NODE_ENV = previous as string
    }
  })
})

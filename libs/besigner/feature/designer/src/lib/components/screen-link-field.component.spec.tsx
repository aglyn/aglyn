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
import { useState, type ReactNode } from 'react'

import { ScreenLinkValuePicker } from './screen-link-field.component'

const SCREENS = { s1: 'pricing', s2: 'company/contact', s3: '/' }
const LABELS = { s1: 'Pricing', s2: 'Contact', s3: 'Home' }

/** A controlled host, so what the picker emits is what it reads back. */
function Harness(props: {
  initial?: string
  onValue?: (v: string) => void
  screens?: Record<string, string>
  labels?: Record<string, string>
  search?: Aglyn.LinkTargetSearchContextValue
  children?: ReactNode
}) {
  const [value, setValue] = useState(props.initial ?? '')
  const picker = (
    <Aglyn.ScreenLinkContext.Provider
      value={{
        screens: props.screens ?? SCREENS,
        labels: props.labels ?? LABELS,
      }}
    >
      <ScreenLinkValuePicker
        label="Default"
        value={value}
        onChange={(next) => {
          setValue(next)
          props.onValue?.(next)
        }}
      />
      <output data-testid="stored">{value}</output>
    </Aglyn.ScreenLinkContext.Provider>
  )
  return props.search ? (
    <Aglyn.LinkTargetSearchContext.Provider value={props.search}>
      {picker}
    </Aglyn.LinkTargetSearchContext.Provider>
  ) : (
    picker
  )
}

/** The lookup is an Autocomplete (AGL-3119): its input IS the combobox. */
const input = () => screen.getByRole('combobox') as HTMLInputElement
/**
 * Clicking the field focuses it, and the focus is load-bearing: an
 * Autocomplete re-syncs an UNFOCUSED input's text to the chosen option on
 * every render, so a spec that types without focusing types into a box that
 * resets under it.
 */
const openPicker = () => {
  const box = input()
  box.focus()
  fireEvent.mouseDown(box)
}
const shown = () => input().value
const type = (text: string) => {
  const box = input()
  box.focus()
  fireEvent.change(box, { target: { value: text } })
}
const stored = () => screen.getByTestId('stored').textContent

describe('ScreenLinkValuePicker (AGL-1335)', () => {
  it('offers the site screens by name and path', () => {
    render(<Harness />)
    openPicker()
    expect(screen.getByRole('option', { name: 'Pricing (/pricing)' })).toBeTruthy()
    expect(
      screen.getByRole('option', { name: 'Contact (/company/contact)' }),
    ).toBeTruthy()
    // Root screens are `'/'` in the map, not `''` — the label must say so.
    expect(screen.getByRole('option', { name: 'Home (/)' })).toBeTruthy()
  })

  it('stores an ID for a picked screen, never the path', () => {
    // The entire point: a path would break on a rename, which is what the
    // plain text box did.
    render(<Harness />)
    openPicker()
    fireEvent.click(screen.getByRole('option', { name: 'Pricing (/pricing)' }))
    expect(stored()).toBe('screen:s1')
    expect(Aglyn.parseScreenLinkValue(stored())).toBe('s1')
  })

  it('narrows the screens as the author types', () => {
    // A site with hundreds of pages is why this is a search: the list a
    // dropdown could scroll is not a list anyone can read.
    render(<Harness />)
    openPicker()
    type('contac')
    expect(
      screen.getByRole('option', { name: 'Contact (/company/contact)' }),
    ).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Pricing (/pricing)' })).toBeNull()
  })

  it('round-trips the external-URL escape hatch', () => {
    render(<Harness />)
    openPicker()
    fireEvent.click(screen.getByRole('option', { name: /External URL/ }))
    const box = screen.getByLabelText('External URL')
    fireEvent.change(box, { target: { value: 'https://status.example.com' } })
    expect(stored()).toBe('https://status.example.com')
    // Still there, still editable — the mode must not collapse under the
    // cursor when the value round-trips back in.
    expect((screen.getByLabelText('External URL') as HTMLInputElement).value).toBe(
      'https://status.example.com',
    )
  })

  it('takes an address typed into the lookup as the address', () => {
    // Pasting a URL into the one control on screen must not be a dead end
    // (AGL-3119): the typed-address choice offers what was typed.
    render(<Harness />)
    openPicker()
    type('https://status.example.com')
    fireEvent.click(
      screen.getByRole('option', {
        name: 'Use the address https://status.example.com',
      }),
    )
    expect(stored()).toBe('https://status.example.com')
    expect((screen.getByLabelText('External URL') as HTMLInputElement).value).toBe(
      'https://status.example.com',
    )
  })

  it('warns while the typed address is only a #fragment (AGL-2867)', () => {
    render(<Harness />)
    openPicker()
    fireEvent.click(screen.getByRole('option', { name: /External URL/ }))
    const box = screen.getByLabelText('External URL')
    fireEvent.change(box, { target: { value: '#watch' } })
    expect(stored()).toBe('#watch')
    expect(
      screen.getByText(/so #watch goes nowhere on the published page/),
    ).toBeTruthy()
    expect(screen.getByText(/Scroll to element/)).toBeTruthy()

    // A real address clears it back to the general note.
    fireEvent.change(box, { target: { value: '/pricing#faq' } })
    expect(screen.queryByText(/goes nowhere/)).toBeNull()
    expect(
      screen.getByText('Typed addresses do not follow a screen rename.'),
    ).toBeTruthy()
  })

  it('opens a legacy raw-string value in URL mode, unchanged', () => {
    // The nine live `/product/*` CTAs. Opening the panel must not rewrite
    // them, and must not present them as "nothing chosen".
    render(<Harness initial="/pricing" />)
    expect((screen.getByLabelText('External URL') as HTMLInputElement).value).toBe(
      '/pricing',
    )
    expect(stored()).toBe('/pricing')
  })

  it('opens a picked screen with that screen selected', () => {
    render(<Harness initial="screen:s2" />)
    expect(shown()).toBe('Contact (/company/contact)')
    expect(screen.queryByLabelText('External URL')).toBeNull()
  })

  it('keeps a screen the routing map no longer knows, rather than clearing it', () => {
    // An unpublished or deleted screen must not silently become "unset" the
    // moment someone opens the dialog.
    render(<Harness initial="screen:gone" />)
    // And it says which of the two it is (AGL-1893): "unknown" read as "we
    // could not look it up", so the author had no reason to act. This is
    // the same wording the plain Screen picker uses for the same condition.
    expect(shown()).toMatch(/Unavailable screen \(gone\)/)
    expect(shown()).toMatch(/unpublished or deleted/)
    expect(stored()).toBe('screen:gone')
  })

  it('clears to unset, which is what falls back to the default', () => {
    render(<Harness initial="screen:s1" />)
    openPicker()
    fireEvent.click(screen.getByRole('option', { name: 'Not set' }))
    // `''` here genuinely means unset — the graft reads it as "use the
    // component's default", so the AGL-1191 rule that a persisted choice
    // needs a real sentinel does not apply to this option.
    expect(stored()).toBe('')
  })

  it('does not print its label over the option it renders when unset', () => {
    // Same shape as the Styles panel's Background Fill (AGL-2486): a control
    // showing "Not set" still reports itself unfilled to MUI, so the field
    // name floated on top of the value and neither could be read.
    render(<Harness />)
    expect(shown()).toBe('Not set')
    const label = screen
      .getAllByText('Default')
      .find((element) => element.classList.contains('MuiInputLabel-root'))
    expect(label?.getAttribute('data-shrink')).toBe('true')
  })

  it('names the component default by SCREEN, not by its stored id', () => {
    // `Use the component default (screen:s2)` is not a sentence an author
    // can act on, and it is the shape the graft stores.
    render(
      <Aglyn.ScreenLinkContext.Provider
        value={{ screens: SCREENS, labels: LABELS }}
      >
        <ScreenLinkValuePicker
          value=""
          defaultValue="screen:s2"
          onChange={() => undefined}
        />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(shown()).toBe('Use the component default (Contact)')
  })
})

/**
 * The `Link` prop picker offers collection listings (AGL-2799) and their RSS
 * feeds (AGL-3119) — the same targets, from the same builder, as the
 * attributes panel's Screen picker.
 */
describe('ScreenLinkValuePicker and collection listings (AGL-2799)', () => {
  const ROUTES = {
    ...SCREENS,
    'collection:blog': 'blog',
    'feed:blog': 'blog/rss.xml',
  }
  const NAMES = { ...LABELS, 'collection:blog': 'Blog' }
  const LISTING = 'Blog (/blog) — collection listing'
  const FEED = 'Blog (/blog/rss.xml) — RSS feed'

  const renderWithListings = (initial?: string) =>
    render(<Harness initial={initial} screens={ROUTES} labels={NAMES} />)

  it('offers the listing beside the screens, marked as a listing', () => {
    renderWithListings()
    openPicker()
    expect(screen.getByRole('option', { name: LISTING })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Pricing (/pricing)' })).toBeTruthy()
  })

  it('offers the feed under its own heading, named after the collection', () => {
    renderWithListings()
    openPicker()
    expect(screen.getByRole('option', { name: FEED })).toBeTruthy()
    for (const group of ['Pages', 'Collection listings', 'RSS feeds']) {
      expect(screen.getByText(group)).toBeTruthy()
    }
  })

  it('stores the collection id, never the path', () => {
    renderWithListings()
    openPicker()
    fireEvent.click(screen.getByRole('option', { name: LISTING }))
    expect(stored()).toBe('collection:blog')
    expect(screen.queryByLabelText('External URL')).toBeNull()
  })

  it('stores the feed under its own key', () => {
    renderWithListings()
    openPicker()
    fireEvent.click(screen.getByRole('option', { name: FEED }))
    expect(stored()).toBe('feed:blog')
  })

  it('reopens a stored listing with that listing selected', () => {
    renderWithListings('collection:blog')
    expect(shown()).toBe(LISTING)
    expect(stored()).toBe('collection:blog')
  })

  it('names a listing whose collection is gone, and keeps the value', () => {
    renderWithListings('collection:gone')
    expect(shown()).toBe(
      '⚠ Unavailable collection listing (gone) — deleted or has no slug',
    )
    expect(stored()).toBe('collection:gone')
  })

  it('turns a typed /blog into the listing it was standing in for', () => {
    renderWithListings('/blog')
    openPicker()
    fireEvent.click(screen.getByRole('option', { name: LISTING }))
    expect(stored()).toBe('collection:blog')
  })
})

/**
 * Entries as link targets (AGL-3119).
 *
 * The routing map holds a site's screens, listings and feeds — tens of
 * targets, filtered in memory. Its entries are thousands, so they are not in
 * the map at all: the picker asks `LinkTargetSearchContext` for the few that
 * match what the author typed, and stores `entry:<collectionId>/<entryId>` so
 * a renamed post keeps every link to it.
 */
describe('ScreenLinkValuePicker and collection entries (AGL-3119)', () => {
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

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  /** Advances past the debounce and lets the search's promise settle. */
  const settleSearch = async () => {
    await act(async () => {
      jest.advanceTimersByTime(Aglyn.LINK_TARGET_SEARCH_DEBOUNCE_MS + 10)
    })
  }

  it('searches as the author types, once per burst, and offers what it finds', async () => {
    const search = seam()
    render(<Harness search={search} />)
    openPicker()
    type('hel')
    type('hello')
    // Still inside the debounce window: a held key is not five searches.
    act(() => {
      jest.advanceTimersByTime(Aglyn.LINK_TARGET_SEARCH_DEBOUNCE_MS - 10)
    })
    expect(search.searchEntries).not.toHaveBeenCalled()
    await settleSearch()
    expect(search.searchEntries).toHaveBeenCalledTimes(1)
    expect((search.searchEntries as jest.Mock).mock.calls[0][0]).toBe('hello')
    expect(screen.getByRole('option', { name: ENTRY.label })).toBeTruthy()
    expect(screen.getByText('Entries')).toBeTruthy()
  })

  it('abandons the search the author has already typed past', async () => {
    const signals: AbortSignal[] = []
    const search = seam({
      searchEntries: jest.fn(
        (_query: string, options?: { signal?: AbortSignal }) => {
          if (options?.signal) signals.push(options.signal)
          // Never settles: what matters is that it is abandoned.
          return new Promise<Aglyn.LinkTargetOption[]>(() => undefined)
        },
      ),
    })
    render(<Harness search={search} />)
    openPicker()
    type('hel')
    await settleSearch()
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)
    type('hello')
    expect(signals[0].aborted).toBe(true)
    await settleSearch()
    expect(signals).toHaveLength(2)
    expect((search.searchEntries as jest.Mock).mock.calls[1][0]).toBe('hello')
  })

  it('stores the entry REFERENCE, so a renamed slug cannot break it', async () => {
    const search = seam()
    render(<Harness search={search} />)
    openPicker()
    await settleSearch()
    fireEvent.click(screen.getByRole('option', { name: ENTRY.label }))
    expect(stored()).toBe('entry:blog/9fKqR')
    expect(Aglyn.parseEntryLinkValue(stored())).toEqual({
      collectionId: 'blog',
      entryId: '9fKqR',
    })
  })

  it('shows a stored entry by its title, never by its ids', async () => {
    const search = seam()
    render(<Harness initial="entry:blog/9fKqR" search={search} />)
    // Not the raw reference, not blank, not "unavailable": the map holds no
    // entries, so the seam is what names this one.
    await act(async () => undefined)
    expect(search.describeTarget).toHaveBeenCalledWith('entry:blog/9fKqR')
    expect(shown()).toBe(ENTRY.label)
    expect(shown()).not.toContain('9fKqR')
    expect(stored()).toBe('entry:blog/9fKqR')
    expect(screen.queryByLabelText('External URL')).toBeNull()
  })

  it('works with no provider at all: no entries offered, nothing searched', () => {
    // Every surface that renders this picker without the console's provider —
    // an isolated spec, a besigner surface outside a host — keeps working.
    render(<Harness />)
    openPicker()
    expect(screen.queryByText('Entries')).toBeNull()
    expect(screen.getByRole('option', { name: 'Pricing (/pricing)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: /External URL/ })).toBeTruthy()
  })
})

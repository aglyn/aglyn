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
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import { ScreenLinkValuePicker } from './screen-link-field.component'

const SCREENS = { s1: 'pricing', s2: 'company/contact', s3: '/' }
const LABELS = { s1: 'Pricing', s2: 'Contact', s3: 'Home' }

/** A controlled host, so what the picker emits is what it reads back. */
function Harness(props: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(props.initial ?? '')
  return (
    <Aglyn.ScreenLinkContext.Provider
      value={{ screens: SCREENS, labels: LABELS }}
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
}

const openSelect = () => fireEvent.mouseDown(screen.getByRole('combobox'))
const stored = () => screen.getByTestId('stored').textContent

describe('ScreenLinkValuePicker (AGL-1335)', () => {
  it('offers the site screens by name and path', () => {
    render(<Harness />)
    openSelect()
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
    openSelect()
    fireEvent.click(screen.getByRole('option', { name: 'Pricing (/pricing)' }))
    expect(stored()).toBe('screen:s1')
    expect(Aglyn.parseScreenLinkValue(stored())).toBe('s1')
  })

  it('round-trips the external-URL escape hatch', () => {
    render(<Harness />)
    openSelect()
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
    expect(screen.getByRole('combobox').textContent).toBe(
      'Contact (/company/contact)',
    )
    expect(screen.queryByLabelText('External URL')).toBeNull()
  })

  it('keeps a screen the routing map no longer knows, rather than clearing it', () => {
    // An unpublished or deleted screen must not silently become "unset" the
    // moment someone opens the dialog.
    render(<Harness initial="screen:gone" />)
    expect(screen.getByRole('combobox').textContent).toMatch(/Unknown screen/)
    expect(stored()).toBe('screen:gone')
  })

  it('clears to unset, which is what falls back to the default', () => {
    render(<Harness initial="screen:s1" />)
    openSelect()
    fireEvent.click(screen.getByRole('option', { name: 'Not set' }))
    // `''` here genuinely means unset — the graft reads it as "use the
    // component's default", so the AGL-1191 rule that a persisted choice
    // needs a real sentinel does not apply to this option.
    expect(stored()).toBe('')
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
    expect(screen.getByRole('combobox').textContent).toBe(
      'Use the component default (Contact)',
    )
  })
})

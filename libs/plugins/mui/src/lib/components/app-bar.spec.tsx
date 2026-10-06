/**
 * @jest-environment jsdom
 */
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

import AppBar from '@mui/material/AppBar'
import { act, fireEvent, render } from '@testing-library/react'
import { FIELD_COLOR_ALT1 } from '../constants/field-presets'
import AglynAppBar, { schema } from './app-bar'

/**
 * AGL-1191: picking "Theme color → Default" on an App Bar silently reverted
 * after save + reload. The option's value was `''`, and the attributes form
 * stack strips an empty string on change (ddf's enhancedOnChange maps an
 * emptied field to its clearedValue; react-final-form's default parse turns
 * `''` into `undefined`), so the prop key never reached the document. The
 * option must carry MUI's real `'default'` sentinel instead.
 */
describe('App Bar "Theme color" options (AGL-1191)', () => {
  const options: Array<{ value: unknown; label: string }> =
    FIELD_COLOR_ALT1.options ?? []

  it('offers Default as the persistable MUI sentinel, not an empty string', () => {
    const defaultOption = options.find((option) => option.label === 'Default')
    expect(defaultOption).toBeDefined()
    expect(defaultOption?.value).toBe('default')
  })

  it('never offers a value the attributes form cannot persist', () => {
    // `''` (and any other falsy non-value) is unpersistable by construction
    // in the form stack — a picked option must survive the round trip.
    for (const option of options) {
      expect(typeof option.value).toBe('string')
      expect(option.value).not.toBe('')
    }
  })

  it('the App Bar schema carries this theme-color attribute', () => {
    expect(schema.attributes).toContain(FIELD_COLOR_ALT1)
  })
})

/**
 * The premise that makes `'default'` the right sentinel, proved against real
 * MUI rather than asserted: `color="default"` is a DISTINCT rendered color,
 * not a synonym for leaving the prop off (which yields `primary`). If either
 * half of this ever changes, the option list needs rethinking.
 */
describe('MUI AppBar color premise (AGL-1191)', () => {
  it('renders colorDefault when the author picked Default', () => {
    const { container } = render(<AppBar color="default" />)
    expect(container.querySelector('.MuiAppBar-colorDefault')).not.toBeNull()
  })

  it('renders colorPrimary when the prop is absent — why "" could not mean Default', () => {
    const { container } = render(<AppBar />)
    expect(container.querySelector('.MuiAppBar-colorPrimary')).not.toBeNull()
  })
})

/**
 * "Shrink when scrolled": a pinned bar compacts to the dense toolbar height
 * once the page scrolls, and restores at the top. The state is a data
 * attribute so the server render and every scroll position share one class.
 */
describe('App Bar scroll reactions: shrink and hide', () => {
  function scrollTo(y: number) {
    act(() => {
      Object.defineProperty(window, 'pageYOffset', {
        configurable: true,
        value: y,
      })
      fireEvent.scroll(window)
    })
  }

  afterEach(() => scrollTo(0))

  it('is an authorable switch on the schema', () => {
    const attribute = schema.attributes?.find(
      (field) => field.name === 'shrinkOnScroll',
    )
    expect(attribute?.component).toBe('switch')
  })

  it('marks the bar scrolled past the threshold, and clears it at the top', () => {
    const { container } = render(<AglynAppBar shrinkOnScroll />)
    const bar = container.querySelector('header') as HTMLElement
    expect(bar.hasAttribute('data-scrolled')).toBe(false)

    scrollTo(200)
    expect(bar.hasAttribute('data-scrolled')).toBe(true)

    scrollTo(0)
    expect(bar.hasAttribute('data-scrolled')).toBe(false)
  })

  it('hides while scrolling down past the threshold, and returns on the way up', () => {
    const { container } = render(<AglynAppBar hideOnScroll />)
    const bar = container.querySelector('header') as HTMLElement

    scrollTo(60)
    expect(bar.hasAttribute('data-scroll-hidden')).toBe(false)

    scrollTo(400)
    expect(bar.hasAttribute('data-scroll-hidden')).toBe(true)
    // Hiding is its own switch: this bar never shrinks.
    expect(bar.hasAttribute('data-scrolled')).toBe(false)

    scrollTo(350)
    expect(bar.hasAttribute('data-scroll-hidden')).toBe(false)
  })

  it('offers hiding as its own authorable switch', () => {
    const attribute = schema.attributes?.find(
      (field) => field.name === 'hideOnScroll',
    )
    expect(attribute?.component).toBe('switch')
  })

  it('never reaches the DOM as a prop, and leaves an unshrinking bar alone', () => {
    const { container } = render(<AglynAppBar />)
    const bar = container.querySelector('header') as HTMLElement
    scrollTo(200)
    expect(bar.hasAttribute('data-scrolled')).toBe(false)
    expect(bar.hasAttribute('shrinkonscroll')).toBe(false)
    expect(bar.hasAttribute('data-scroll-hidden')).toBe(false)
  })
})

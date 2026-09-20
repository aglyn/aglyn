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
 * The canvas measures a box the way the published page does (AGL-3146).
 *
 * A published page gets `CssBaseline`, whose `box-sizing` pair is declared on
 * the root element and inherited by everything under it. The canvas is a
 * CLOSED shadow root whose `:host { all: initial }` cuts that inheritance, so
 * the baseline has to be re-declared inside — and the half that was missing
 * is the half no one looks at, because it changes no color and no font: an
 * element that sets a height and padding is `content-box` on the canvas and
 * `border-box` on the site, i.e. taller in the editor by exactly its padding.
 *
 * Asserted on the style object the viewport hands `GlobalStyles`, because
 * jsdom performs no layout and a closed shadow root is unreachable from a
 * test: `el.shadowRoot` is null by construction.
 */

import { VIEWPORT_BASELINE_STYLES } from './viewport-frame.component'

describe('the canvas baseline (AGL-3146)', () => {
  it('declares the box model CssBaseline declares', () => {
    expect(VIEWPORT_BASELINE_STYLES[':host'].boxSizing).toBe('border-box')
    expect(VIEWPORT_BASELINE_STYLES['*, *::before, *::after'].boxSizing).toBe(
      'inherit',
    )
  })

  it('keeps the reset that cuts the console’s own styles', () => {
    // `all: initial` FIRST: a later declaration in the same block wins, so
    // the box model has to be re-stated after the reset rather than before.
    const host = Object.keys(VIEWPORT_BASELINE_STYLES[':host'])
    expect(host.indexOf('all')).toBeLessThan(host.indexOf('boxSizing'))
  })
})

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

import { render } from '@testing-library/react'
import AglynTypography from './typography'

/**
 * MUI's own `variantMapping` sends `subtitle1` and `subtitle2` to `<h6>`. On a
 * page builder that is a document-outline decision made by somebody who has
 * never seen the page — and it is what Lighthouse's `heading-order` was
 * reporting on the marketing site, from a card label whose author had
 * selected Subtitle 1 and nothing else.
 */
describe('subtitles are not headings', () => {
  const render1 = (props: Record<string, unknown>) =>
    render(<AglynTypography {...props}>{'Label'}</AglynTypography>)

  it('renders a subtitle as a paragraph, not an h6', () => {
    for (const variant of ['subtitle1', 'subtitle2']) {
      const { container, unmount } = render1({ variant })
      expect(container.querySelector('h6')).toBeNull()
      expect(container.querySelector('p')).toBeTruthy()
      unmount()
    }
  })

  it('still renders every heading variant as its heading', () => {
    for (const variant of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      const { container, unmount } = render1({ variant })
      expect(container.querySelector(variant)).toBeTruthy()
      unmount()
    }
  })

  // The Component field is the control for exactly this question, and an
  // author who wants a heading on a subtitle keeps saying so with it.
  it('lets an explicit component win over the variant', () => {
    const { container } = render1({ variant: 'subtitle1', component: 'h3' })
    expect(container.querySelector('h3')).toBeTruthy()
    expect(container.querySelector('p')).toBeNull()
  })

  it('leaves body and caption where they were', () => {
    const { container } = render1({ variant: 'body1' })
    expect(container.querySelector('p')).toBeTruthy()
  })
})

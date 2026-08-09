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
import { ListingReadme } from './listing-content.component'

/**
 * Renderer parity for the markdown-lite block set (AGL-1315): every block
 * the parser can emit must render as an element here, or a publisher's
 * README leaks raw markdown text into the listing page.
 */
describe('ListingReadme (markdown-lite parity)', () => {
  it('renders a `> ` group as a blockquote, not literal text (AGL-1315)', () => {
    const { container } = render(
      <ListingReadme readme={'Intro.\n\n> A **quoted** note\n> continues.'} />,
    )
    const quote = container.querySelector('blockquote')
    expect(quote?.textContent).toBe('A quoted note continues.')
    expect(quote?.querySelector('strong')?.textContent).toBe('quoted')
    expect(container.textContent).not.toContain('>')
  })
})

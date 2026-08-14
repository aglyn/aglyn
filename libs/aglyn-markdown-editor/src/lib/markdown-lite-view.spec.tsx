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
import { MarkdownLiteView } from './markdown-lite-view.component'

/**
 * Renderer parity for the markdown-lite block set (AGL-1315): the console's
 * read-only surface must render every block the parser emits, or a `> ` line
 * shows up as literal text here while styling correctly on the tenant.
 */
describe('MarkdownLiteView (markdown-lite parity)', () => {
  it('renders a `> ` group as a blockquote, not literal text (AGL-1315)', () => {
    const { container } = render(
      <MarkdownLiteView source={'Intro.\n\n> A **quoted** line\n> more.'} />,
    )
    const quote = container.querySelector('blockquote')
    expect(quote?.textContent).toBe('A quoted line more.')
    expect(quote?.querySelector('strong')?.textContent).toBe('quoted')
    expect(container.textContent).not.toContain('>')
  })

  it('renders a numbered group as an <ol> with its start (AGL-1320)', () => {
    const { container } = render(
      <MarkdownLiteView source={'Steps:\n\n5. do **this**\n6. then that'} />,
    )
    const list = container.querySelector('ol')
    expect(list?.getAttribute('start')).toBe('5')
    expect(list?.querySelectorAll('li')).toHaveLength(2)
    expect(list?.querySelector('strong')?.textContent).toBe('this')
    // The console preview must not show the raw markers as prose either.
    expect(container.textContent).toBe('Steps:do thisthen that')
  })
})

/**
 * AGL-1686. The console preview is the surface an author checks a document
 * against before publishing, so it has to resolve what the tenant resolves —
 * otherwise a correct document looks broken here and nobody publishes it.
 *
 * No `hostId`: the console has no site context, so the scope the picker baked
 * into the reference is what resolves. The console serves `/api/media/cdn/…`
 * itself, so the relative URL is fetchable from this origin.
 */
describe('MarkdownLiteView images (AGL-1686)', () => {
  it('resolves a media reference to the CDN url', () => {
    const { container } = render(
      <MarkdownLiteView source={'![Chart](media:org:acme/med1)'} />,
    )
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/api/media/cdn/org:acme/med1')
    expect(image?.getAttribute('alt')).toBe('Chart')
  })

  it('passes a plain URL through and renders nothing for a bad reference', () => {
    const { container } = render(
      <MarkdownLiteView source={'![a](https://x.example/a.png)'} />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://x.example/a.png',
    )
    const bad = render(<MarkdownLiteView source={'![a](media:junk)'} />)
    expect(bad.container.querySelector('img')).toBeNull()
  })
})

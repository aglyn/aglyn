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
import { render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import Image, { schema } from './image'

describe('Image element (AGL-579 SSR hardening)', () => {
  it('is flagged self-closing so renderers never pass it children', () => {
    expect(
      Boolean((schema.flags?.selfClosing ?? 0) & Aglyn.FEATURE_FLAG.ENABLED),
    ).toBe(true)
  })

  it('server-renders with a src without throwing', () => {
    expect(() =>
      renderToString(<Image src="https://example.com/a.png" alt="a" />),
    ).not.toThrow()
  })

  it('survives a children prop leaking through a renderer (AGL-579)', () => {
    // The tenant Leaf used to pass `[undefined, false]` children to every
    // component; forwarding ANY children value onto <img> makes React throw
    // "img is a self-closing tag..." and 500s the whole page. The component
    // must discard children rather than spread them onto the img.
    const props = {
      src: 'https://example.com/a.png',
      alt: 'a',
      children: [undefined, false],
    } as React.ComponentProps<typeof Image>
    expect(() => renderToString(<Image {...props} />)).not.toThrow()
    expect(() => render(<Image {...props} />)).not.toThrow()
  })

  it('renders the placeholder when src is empty', () => {
    const { getByText } = render(<Image />)
    expect(getByText(/choose a source/i)).toBeTruthy()
  })
})

describe('Image src resolution (AGL-1215)', () => {
  const img = (element: JSX.Element) =>
    render(element).container.querySelector('img') as HTMLImageElement

  it('resolves a stored media reference to a CDN url with variants', () => {
    const element = img(<Image src="media:site-a/med123" alt="a" />)
    expect(element.getAttribute('src')).toBe('/api/media/cdn/site-a/med123')
    expect(element.getAttribute('srcset')).toContain(
      '/api/media/cdn/site-a/med123?w=320 320w',
    )
  })

  it('names the rendering site in an org reference', () => {
    const element = img(
      <Aglyn.SiteContext.Provider value={{ hostId: 'site-b' }}>
        <Image src="media:org:acme:site-a/med123" alt="a" />
      </Aglyn.SiteContext.Provider>,
    )
    expect(element.getAttribute('src')).toBe(
      '/api/media/cdn/org:acme:site-b/med123',
    )
  })

  it('renders a legacy raw storage URL unchanged, without a srcSet', () => {
    const legacy =
      'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=t'
    const element = img(
      <Aglyn.SiteContext.Provider value={{ hostId: 'site-a' }}>
        <Image src={legacy} alt="a" />
      </Aglyn.SiteContext.Provider>,
    )
    expect(element.getAttribute('src')).toBe(legacy)
    expect(element.getAttribute('srcset')).toBeNull()
  })

  it('renders a legacy CDN path unchanged, keeping its variants', () => {
    const element = img(<Image src="/api/media/cdn/org:acme/med123" alt="a" />)
    expect(element.getAttribute('src')).toBe('/api/media/cdn/org:acme/med123')
    expect(element.getAttribute('srcset')).toContain('?w=1280 1280w')
  })

  it('falls back to the placeholder for an unparseable reference', () => {
    const { getByText } = render(<Image src="media:nonsense" />)
    expect(getByText(/choose a source/i)).toBeTruthy()
  })
})

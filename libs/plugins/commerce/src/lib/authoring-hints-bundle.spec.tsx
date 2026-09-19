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
import { COMMERCE_BUNDLE } from './plugin'

/**
 * An empty storefront element's authoring hint is for the person editing the
 * page (AGL-3067).
 *
 * Most of these blocks draw their hint only without a site identity, which
 * the tenant always has. The Reservation widget's second hint — the one for a
 * block with no resource picked — was drawn wherever the site was known, so a
 * published page showed its visitors an instruction to open the console. It
 * reads the same signal the mui elements do: `suppressNavigation`, which the
 * besigner canvas and Preview set and the tenant never does.
 */

/** Each surface, as it provides the two contexts a node reads. */
const SURFACES: Record<
  'published' | 'preview' | 'canvas',
  { site: Aglyn.SiteContextValue; links: Aglyn.ScreenLinkContextValue }
> = {
  // The tenant page: the site's identity and routing map, no editing flag.
  published: { site: { hostId: 'host-1' }, links: { screens: {} } },
  // The console's Preview: the real site identity, navigation suppressed.
  preview: {
    site: { hostId: 'host-1', preview: true },
    links: { screens: {}, suppressNavigation: true },
  },
  // The besigner canvas: no site identity, and inert.
  canvas: {
    site: {},
    links: { screens: {}, suppressNavigation: true, editorInert: true },
  },
}

type Surface = keyof typeof SURFACES

/** A registered element rendered on one surface with nothing authored. */
const renderEmpty = (surface: Surface, id: string) => {
  const entry = COMMERCE_BUNDLE.find((candidate) => candidate.schema.$id === id)
  if (!entry) throw new Error(`No registered element "${id}"`)
  const { site, links } = SURFACES[surface]
  const Component = entry.component as JSX.ElementType
  return render(
    <Aglyn.SiteContext.Provider value={site}>
      <Aglyn.ScreenLinkContext.Provider value={links}>
        <Component />
      </Aglyn.ScreenLinkContext.Provider>
    </Aglyn.SiteContext.Provider>,
  )
}

/** Whether anything rendered wears the dashed frame placeholders are drawn in. */
const drawsDashedFrame = (container: HTMLElement) =>
  [...container.querySelectorAll('*')].some((element) =>
    getComputedStyle(element).borderStyle.includes('dashed'),
  )

/** Wording only an author can act on; a store's own copy never uses it. */
const AUTHORING_WORDS =
  /\battributes?\b|renders? here|\bthis block\b|\bconsole\b|— (?:add|set|pick|choose|paste)\b/i

describe('storefront authoring hints are for the author only (AGL-3067)', () => {
  let realFetch: typeof fetch

  beforeEach(() => {
    realFetch = globalThis.fetch
    // A site identity starts each block's data read; nothing here is about
    // what the read returns, so it never settles.
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => undefined))
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  describe('an empty Reservation widget', () => {
    const text = (surface: Surface) => {
      const { container, unmount } = renderEmpty(surface, 'reservation-widget')
      const content = container.textContent ?? ''
      unmount()
      return content
    }

    it('says what it is in the besigner canvas', () => {
      expect(text('canvas')).toMatch(/Reservation widget — .* render here/)
    })

    it('asks for a resource in Preview', () => {
      expect(text('preview')).toMatch(/Set a resource id on this block/)
    })

    it('renders nothing on a published page', () => {
      expect(text('published')).toBe('')
    })
  })

  it('renders every element empty on a published page with no hint and no placeholder frame', () => {
    const leaks: string[] = []
    for (const entry of COMMERCE_BUNDLE) {
      const id = entry.schema.$id
      const { container, unmount } = renderEmpty('published', id)
      const text = container.textContent ?? ''
      if (drawsDashedFrame(container)) leaks.push(`${id}: a dashed placeholder frame`)
      if (AUTHORING_WORDS.test(text)) leaks.push(`${id}: "${text}"`)
      unmount()
    }
    expect(leaks).toEqual([])
  })

  it('recognizes the hints it is looking for on an editing surface', () => {
    // The control for the sweep above: a clean published render means the
    // hint is gone, not that the checks could not see it.
    for (const surface of ['canvas', 'preview'] as const) {
      const { container, unmount } = renderEmpty(surface, 'reservation-widget')
      expect(
        drawsDashedFrame(container) ||
          AUTHORING_WORDS.test(container.textContent ?? ''),
      ).toBe(true)
      unmount()
    }
  })
})

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
import { loadMuiBundle, type MuiBundleEntry } from './plugin'

/** The whole library, resolved once — the bundle loads on demand (AGL-3141). */
let MUI_BUNDLE: MuiBundleEntry[] = []

beforeAll(async () => {
  MUI_BUNDLE = await loadMuiBundle()
})

/**
 * An empty element's authoring hint is for the person editing the page
 * (AGL-3067).
 *
 * Social Links, Table and Custom HTML drew theirs — "add … in Attributes" — on
 * every published page they were left empty on, and a sweep of the bundle
 * found nine more elements doing the same. The elements that already got it
 * right (Markdown, the collection blocks, the Language Switcher) all read one
 * signal for the surface they draw on: `ScreenLinkContext.suppressNavigation`,
 * which the besigner canvas and Preview set and the tenant never does.
 *
 * The sweep runs over the REGISTERED BUNDLE, the way
 * `cleared-props-bundle.spec.tsx` does, so an element registered later is
 * covered without anyone remembering to list it.
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
const renderEmpty = (
  surface: Surface,
  id: string,
  props: Record<string, unknown> = {},
) => {
  const entry = MUI_BUNDLE.find((candidate) => candidate.schema.$id === id)
  if (!entry) throw new Error(`No registered element "${id}"`)
  const { site, links } = SURFACES[surface]
  const Component = entry.component
  return render(
    <Aglyn.SiteContext.Provider value={site}>
      <Aglyn.ScreenLinkContext.Provider value={links}>
        <Component {...props} />
      </Aglyn.ScreenLinkContext.Provider>
    </Aglyn.SiteContext.Provider>,
  )
}

/** Whether anything rendered wears the dashed frame placeholders are drawn in. */
const drawsDashedFrame = (container: HTMLElement) =>
  [...container.querySelectorAll('*')].some((element) =>
    getComputedStyle(element).borderStyle.includes('dashed'),
  )

/**
 * Wording only an author can act on.
 *
 * Deliberately narrow. The text an element renders before it is configured —
 * a "Card title", a "Menu" label, a "Share" heading — is the site's own
 * content, styled as content, and is not what this guards.
 */
const AUTHORING_WORDS =
  /\battributes?\b|renders? here|\bthis block\b|\bconsole\b|— (?:add|set|pick|choose|paste)\b|layout-slot/i

/** Every element that draws a hint when empty, and how to recognize it. */
const HINTS: Array<{
  name: string
  id: string
  hint: RegExp | 'dashed frame'
  props?: Record<string, unknown>
}> = [
  { name: 'Social Links', id: 'socialLinks', hint: /add profile URLs in Attributes/ },
  { name: 'Table', id: 'dataTable', hint: /add rows in Attributes/ },
  { name: 'Custom HTML', id: 'custom-html', hint: /add markup in the attributes panel/ },
  { name: 'Video embed', id: 'videoEmbed', hint: /paste a YouTube or Vimeo URL/ },
  { name: 'Video, no source', id: 'video', hint: /set a source URL/ },
  {
    name: 'Video, Wistia with no poster',
    id: 'video',
    hint: /add a poster image/,
    props: { src: 'https://aglyn.wistia.com/medias/e4a27b971d' },
  },
  { name: 'Image', id: 'image', hint: /choose a source/ },
  { name: 'Icon', id: 'icon', hint: /^Icon$/ },
  { name: 'Table of Contents', id: 'tableOfContents', hint: /add ## headings/ },
  { name: 'Function Widget', id: 'functionWidget', hint: /set the Function name attribute/ },
  { name: 'Plugin', id: 'marketplacePlugin', hint: /pick an installed plugin/ },
  { name: 'Layout Slot', id: 'layoutSlot', hint: /Screen content renders here/ },
  // The instance's label is CSS generated content, which jsdom does not lay
  // out; the dashed `:empty` frame it hangs on is what is left to see.
  { name: 'Reusable Component', id: 'reusableInstance', hint: 'dashed frame' },
  // Editor-only before AGL-3067, and held there.
  { name: 'Markdown', id: 'markdown', hint: /paste the document/ },
  { name: 'Entry Body', id: 'collectionEntryBody', hint: /markdown renders here/ },
  { name: 'Category Pills', id: 'collectionCategories', hint: /render here/ },
  { name: 'Language Switcher', id: 'languageSwitcher', hint: /set screen translations/ },
]

describe('an empty element draws its authoring hint for the author only (AGL-3067)', () => {
  describe.each(HINTS)('$name', ({ id, hint, props }) => {
    const shows = (surface: Surface) => {
      const { container, unmount } = renderEmpty(surface, id, props)
      const shown =
        hint === 'dashed frame'
          ? drawsDashedFrame(container)
          : hint.test(container.textContent ?? '')
      unmount()
      return shown
    }

    it('shows it in the besigner canvas', () => {
      expect(shows('canvas')).toBe(true)
    })

    it('shows it in Preview', () => {
      expect(shows('preview')).toBe(true)
    })

    it('renders nothing of it on a published page', () => {
      expect(shows('published')).toBe(false)
    })
  })
})

describe('no registered element addresses the author on a published page (AGL-3067)', () => {
  it('renders every element empty with no hint and no placeholder frame', () => {
    const leaks: string[] = []
    // An element whose children fill fixed slots (MUI's Accordion is
    // `[summary, ...details]`) cannot render without them, and the besigner
    // never places one without them.
    const slotted: string[] = []

    for (const entry of MUI_BUNDLE) {
      const id = entry.schema.$id
      if ((entry.schema.flags?.positionalChildren ?? 0) & Aglyn.FEATURE_FLAG.ENABLED) {
        slotted.push(id)
        continue
      }
      const { container, unmount } = renderEmpty('published', id)
      const text = container.textContent ?? ''
      if (drawsDashedFrame(container)) leaks.push(`${id}: a dashed placeholder frame`)
      if (AUTHORING_WORDS.test(text)) leaks.push(`${id}: "${text}"`)
      unmount()
    }

    expect(leaks).toEqual([])
    // A new entry here is an element the sweep stopped seeing, which is a
    // loss of coverage rather than a pass.
    expect(slotted).toEqual(['muiAccordion'])
  })

  it('recognizes every hint it is looking for on an editing surface', () => {
    // The control for the sweep above: its words and its frame check find
    // each known hint where hints belong, so a clean published render means
    // the hint is gone rather than unrecognized.
    const missed = HINTS.filter(({ id, props }) => {
      const { container, unmount } = renderEmpty('preview', id, props)
      const recognized =
        drawsDashedFrame(container) ||
        AUTHORING_WORDS.test(container.textContent ?? '')
      unmount()
      return !recognized
    }).map(({ name }) => name)
    expect(missed).toEqual([])
  })
})

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
import Image, { firstImageNodeId, schema } from './image'

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

describe('Image metadata (AGL-1305)', () => {
  const img = (element: JSX.Element) =>
    render(element).container.querySelector('img') as HTMLImageElement

  it('renders absent alt exactly as before — alt="", no title, lazy', () => {
    // Existing-content invariance: unset alt has ALWAYS rendered alt=""
    // and loading="lazy"; no new attributes may appear on old documents.
    const element = img(<Image src="https://example.com/a.png" />)
    expect(element.getAttribute('alt')).toBe('')
    expect(element.hasAttribute('title')).toBe(false)
    expect(element.getAttribute('loading')).toBe('lazy')
  })

  it('puts alt text and the tooltip on the img', () => {
    const element = img(
      <Image
        src="https://example.com/a.png"
        alt="A red barn at dusk"
        title="The old barn"
      />,
    )
    expect(element.getAttribute('alt')).toBe('A red barn at dusk')
    expect(element.getAttribute('title')).toBe('The old barn')
  })

  it('decorative forces alt="" and drops the tooltip over set values', () => {
    const element = img(
      <Image
        src="https://example.com/a.png"
        alt="ignored"
        title="ignored"
        decorative
      />,
    )
    expect(element.getAttribute('alt')).toBe('')
    expect(element.hasAttribute('title')).toBe(false)
    // The intent marker itself must never leak into the DOM.
    expect(element.hasAttribute('decorative')).toBe(false)
  })

  it('honors an eager loading choice', () => {
    const element = img(
      <Image src="https://example.com/a.png" loading="eager" />,
    )
    expect(element.getAttribute('loading')).toBe('eager')
  })

  it('exposes alt, decorative, tooltip and loading in the schema', () => {
    const names = (schema.attributes ?? []).map((a) => a.name)
    expect(names).toEqual(
      expect.arrayContaining(['alt', 'decorative', 'title', 'loading']),
    )
    const altField = (schema.attributes ?? []).find((a) => a.name === 'alt')
    // The alt field hides while Decorative is on, but the value stays on
    // the node — toggling back restores it.
    expect(altField?.condition).toEqual({
      when: 'decorative',
      is: true,
      notMatch: true,
    })
  })
})

describe('Image node styles (AGL-1240)', () => {
  it('merges the node sx over the component defaults instead of dropping it', () => {
    // The literals are composed AFTER `{...rest}`, so leaving `sx` in the
    // spread REPLACED everything the author set from the Styles panel. Every
    // hero mockup on the marketing site lost its 16px radius and drop shadow.
    const { container } = render(
      <Image
        src="https://example.com/a.png"
        alt="mockup"
        {...({ sx: { borderRadius: '16px', boxShadow: '0 8px 24px rgba(0,0,0,.2)', maxWidth: '920px' } } as any)}
      />,
    )
    const style = getComputedStyle(container.querySelector('img')!)
    expect(style.borderRadius).toBe('16px')
    expect(style.boxShadow).toContain('rgba')
    expect(style.maxWidth).toBe('920px')
  })

  it('still applies its own defaults where the node says nothing', () => {
    const { container } = render(<Image src="https://example.com/b.png" alt="plain" />)
    const style = getComputedStyle(container.querySelector('img')!)
    expect(style.display).toBe('block')
    expect(style.width).toBe('100%')
  })
})

/**
 * A screen tree the way every render surface holds one: a flat node map
 * filled into the shared canvas singleton. Same helper shape as
 * `markdown.spec.tsx`, which resolves its document from the tree the same way.
 */
const fillCanvas = (
  nodes: Array<{ $id: string; componentId?: string; props?: any }>,
) => {
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      type: Aglyn.NodeType.NODE,
      componentId: 'box',
      nodes: nodes.map((node) => node.$id),
    },
    ...Object.fromEntries(
      nodes.map((node) => [
        node.$id,
        {
          $id: node.$id,
          type: Aglyn.NodeType.NODE,
          parentId: Aglyn.NODE_ROOT_ID,
          componentId: node.componentId ?? 'image',
          props: node.props ?? {},
        },
      ]),
    ),
  } as any)
}

/** Render an Image as the renderer does: under its node's identity. */
const renderAsNode = (nodeId: string, element: React.ReactElement) =>
  render(
    <Aglyn.NodeIdentityContext.Provider value={nodeId}>
      {element}
    </Aglyn.NodeIdentityContext.Provider>,
  )

describe('Image loading priority (AGL-2486)', () => {
  afterEach(() => Aglyn.canvas.clearNodes())

  it('finds the first image in DOCUMENT order, not map order', () => {
    fillCanvas([
      { $id: 'text1', componentId: 'muiTypography' },
      { $id: 'hero', props: { src: 'https://example.com/hero.png' } },
      { $id: 'footer', props: { src: 'https://example.com/footer.png' } },
    ])
    expect(firstImageNodeId(Aglyn.canvas.rootNode as any)).toBe('hero')
  })

  it('skips an image with no src — it renders no <img> to prioritise', () => {
    fillCanvas([
      { $id: 'placeholder', props: {} },
      { $id: 'real', props: { src: 'https://example.com/real.png' } },
    ])
    expect(firstImageNodeId(Aglyn.canvas.rootNode as any)).toBe('real')
  })

  it('returns undefined for a page with no images at all', () => {
    fillCanvas([{ $id: 'text1', componentId: 'muiTypography' }])
    expect(firstImageNodeId(Aglyn.canvas.rootNode as any)).toBeUndefined()
  })

  it('loads the first image eagerly at high priority', () => {
    fillCanvas([
      { $id: 'hero', props: { src: 'https://example.com/hero.png' } },
      { $id: 'below', props: { src: 'https://example.com/below.png' } },
    ])
    const { container } = renderAsNode(
      'hero',
      <Image src="https://example.com/hero.png" alt="hero" />,
    )
    const img = container.querySelector('img')!
    expect(img.getAttribute('loading')).toBe('eager')
    expect(img.getAttribute('fetchpriority')).toBe('high')
    // The eager image keeps the browser default so it can decode in time to
    // paint; forcing async here would be the same mistake in a new place.
    expect(img.getAttribute('decoding')).toBeNull()
  })

  it('defers every LATER image at low priority', () => {
    // The bug this exists for: with everything lazy and nothing ranked, an
    // image four sections down could be fetched before the one on screen.
    fillCanvas([
      { $id: 'hero', props: { src: 'https://example.com/hero.png' } },
      { $id: 'below', props: { src: 'https://example.com/below.png' } },
    ])
    const { container } = renderAsNode(
      'below',
      <Image src="https://example.com/below.png" alt="below" />,
    )
    const img = container.querySelector('img')!
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('fetchpriority')).toBe('low')
    expect(img.getAttribute('decoding')).toBe('async')
  })

  it('lets an explicit author choice win in BOTH directions', () => {
    fillCanvas([
      { $id: 'hero', props: { src: 'https://example.com/hero.png' } },
      { $id: 'below', props: { src: 'https://example.com/below.png' } },
    ])
    // Author deferred the hero deliberately: it stays lazy.
    const lazyHero = renderAsNode(
      'hero',
      <Image src="https://example.com/hero.png" alt="hero" loading="lazy" />,
    )
    expect(lazyHero.container.querySelector('img')!.getAttribute('loading')).toBe(
      'lazy',
    )
    // Author marked a later image eager: it stays eager.
    const eagerBelow = renderAsNode(
      'below',
      <Image src="https://example.com/below.png" alt="below" loading="eager" />,
    )
    const img = eagerBelow.container.querySelector('img')!
    expect(img.getAttribute('loading')).toBe('eager')
    expect(img.getAttribute('fetchpriority')).toBe('high')
  })

  it('stays lazy outside the renderer, where there is no node identity', () => {
    // A component mounted directly (a test, a console surface) has an empty
    // node id. Guessing "eager" there would make every isolated preview
    // claim to be somebody's LCP element.
    fillCanvas([{ $id: 'hero', props: { src: 'https://example.com/hero.png' } }])
    const { container } = render(<Image src="https://example.com/hero.png" alt="x" />)
    expect(container.querySelector('img')!.getAttribute('loading')).toBe('lazy')
  })
})

describe('Image sizes (AGL-2486)', () => {
  const CDN = '/api/media/cdn/org123/asset456'

  it('describes a pinned pixel slot instead of claiming the full viewport', () => {
    const { container } = render(<Image src={CDN} alt="thumb" width="320px" />)
    expect(container.querySelector('img')!.getAttribute('sizes')).toBe('320px')
  })

  it('lets the browser measure a fluid slot on a lazy image', () => {
    // `sizes="auto"` resolves to the element's REAL laid-out width, which is
    // the only correct answer for a width we cannot read statically. Measured
    // against the live CDN in a 158px slot at DPR 1.75: `100vw` selected the
    // bare original (366 KB, no WebP variant at that width), `auto` selected
    // `?w=320` — the variant that actually exists.
    for (const width of [undefined, '100%', '50vw', 'calc(100% - 2rem)']) {
      const { container } = render(<Image src={CDN} alt="fluid" width={width} />)
      expect(container.querySelector('img')!.getAttribute('loading')).toBe('lazy')
      expect(container.querySelector('img')!.getAttribute('sizes')).toBe('auto')
    }
  })

  it('keeps 100vw on an EAGER fluid image, because auto is inert there', () => {
    // Not an oversight and not symmetry for its own sake: `sizes="auto"` is
    // only defined for `loading="lazy"`. Verified in Chrome against the live
    // CDN — an eager image with `sizes="auto"` fell back to the bare original
    // exactly as `100vw` did. So the LCP image, which is deliberately eager,
    // has to keep an explicit answer, and `100vw` is the only safe one until
    // it can be told its real slot.
    fillCanvas([{ $id: 'hero', props: { src: CDN } }])
    const { container } = renderAsNode('hero', <Image src={CDN} alt="hero" />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('loading')).toBe('eager')
    expect(img.getAttribute('sizes')).toBe('100vw')
  })

  it('prefers a pinned pixel slot over auto, on a lazy image too', () => {
    const { container } = render(<Image src={CDN} alt="thumb" width="240px" />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('sizes')).toBe('240px')
  })

  it('sets no sizes at all for a non-CDN url, which has no variants', () => {
    const { container } = render(
      <Image src="https://example.com/a.png" alt="ext" width="320px" />,
    )
    expect(container.querySelector('img')!.getAttribute('sizes')).toBeNull()
  })
})

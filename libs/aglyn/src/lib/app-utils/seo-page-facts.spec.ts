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
 * What a page says (AGL-2910): its text, its headings and its images, read
 * from the content region the page's Markdown is served from — never from
 * its navigation — with each heading marked as one a fix can rewrite or not.
 */

import { SEO_PAGE_TEXT_MAX_CHARS, seoPageFacts } from './seo-page-facts'

type NodeMap = Record<string, { componentId: string; props?: Record<string, unknown>; nodes?: string[] }>

const nodes: NodeMap = {
  root: { componentId: 'div', nodes: ['header', 'main', 'footer'] },
  header: { componentId: 'section', props: { component: 'header' }, nodes: ['brand'] },
  brand: { componentId: 'muiTypography', props: { variant: 'h1', children: 'Acme' }, nodes: [] },
  main: { componentId: 'section', props: { component: 'main' }, nodes: ['title', 'rich', 'intro', 'photo', 'md', 'html', 'loop'] },
  title: { componentId: 'muiTypography', props: { component: 'h1', variant: 'h3', children: 'Brass desk lamps' }, nodes: [] },
  rich: { componentId: 'muiTypography', props: { variant: 'h2', html: '<b>Made</b> by hand' }, nodes: [] },
  intro: { componentId: 'muiTypography', props: { variant: 'body1', children: 'Every lamp is finished by hand.' }, nodes: [] },
  photo: { componentId: 'image', props: { src: 'media:host-1/lamp', alt: '' }, nodes: [] },
  md: { componentId: 'markdown', props: { content: '## Care\nWipe with a dry cloth.' }, nodes: [] },
  html: { componentId: 'custom-html', props: { html: '<h3>Shipping</h3><p>Two weeks.</p>' }, nodes: [] },
  // A child that names its parent back: the walk stops rather than recursing forever.
  loop: { componentId: 'muiBox', nodes: ['main'] },
  footer: { componentId: 'section', props: { component: 'footer' }, nodes: ['footImage'] },
  footImage: { componentId: 'image', props: { src: 'media:host-1/logo' }, nodes: [] },
}

describe('seoPageFacts', () => {
  const facts = seoPageFacts(nodes, { rootId: 'root' })

  it('reads headings from the content region only, by element over style', () => {
    expect(facts.contentRootId).toBe('main')
    expect(facts.headings).toEqual([
      { nodeId: 'title', level: 1, text: 'Brass desk lamps', editable: true },
      { nodeId: 'rich', level: 2, text: 'Made by hand', editable: false },
      { nodeId: null, level: 2, text: 'Care', editable: false },
      { nodeId: null, level: 3, text: 'Shipping', editable: false },
    ])
    expect(facts.h1s.map((heading) => heading.nodeId)).toEqual(['title'])
  })

  it('reads images with the text before them, and which have no description', () => {
    expect(facts.images).toEqual([
      {
        nodeId: 'photo',
        src: 'media:host-1/lamp',
        alt: '',
        decorative: false,
        editable: true,
        context: 'Every lamp is finished by hand.',
      },
    ])
    expect(facts.imagesMissingAlt.map((image) => image.nodeId)).toEqual(['photo'])
  })

  it('does not count an image the author marked decorative as missing a description', () => {
    const decorative = seoPageFacts(
      {
        root: { componentId: 'div', nodes: ['hero', 'photo'] },
        hero: { componentId: 'image', props: { src: 'media:host-1/backdrop', alt: '', decorative: true } },
        photo: { componentId: 'image', props: { src: 'media:host-1/lamp', alt: '' } },
      } as NodeMap,
      { rootId: 'root' },
    )
    expect(decorative.images.map((image) => [image.nodeId, image.decorative])).toEqual([
      ['hero', true],
      ['photo', false],
    ])
    expect(decorative.imagesMissingAlt.map((image) => image.nodeId)).toEqual(['photo'])
  })

  it('carries the page’s Markdown as its text, capped', () => {
    expect(facts.text).toContain('Every lamp is finished by hand.')
    expect(facts.text).not.toContain('Acme')
    expect(facts.wordCount).toBeGreaterThan(5)
    const long = seoPageFacts(
      { root: { componentId: 'div', nodes: ['p'] }, p: { componentId: 'muiTypography', props: { children: 'word '.repeat(2_000) } } } as NodeMap,
      { rootId: 'root' },
    )
    expect(long.text.length).toBe(SEO_PAGE_TEXT_MAX_CHARS)
  })

  it('does not read a token as copy: a bound heading counts but says nothing, and no fix may rewrite it', () => {
    const bound = seoPageFacts(
      {
        root: { componentId: 'div', nodes: ['title', 'card', 'photo'] },
        title: { componentId: 'muiTypography', props: { component: 'h1', children: '{{item.name}}' } },
        card: { componentId: 'muiTypography', props: { children: 'From {{item.city}} with care' } },
        photo: { componentId: 'image', props: { src: '{{item.photo}}', alt: '{{item.caption}}' } },
      } as NodeMap,
      { rootId: 'root' },
    )
    expect(bound.h1s).toEqual([{ nodeId: 'title', level: 1, text: '', editable: false }])
    expect(bound.text).not.toContain('{{')
    expect(bound.text).toContain('From with care')
    // Described at render by a value this read cannot see: not reported, not offered to a fix.
    expect(bound.imagesMissingAlt).toEqual([])
    expect(bound.images[0]).toMatchObject({ nodeId: 'photo', editable: false })
  })

  it('answers empty for a page with no nodes', () => {
    expect(seoPageFacts(null)).toMatchObject({ text: '', headings: [], images: [], contentRootId: null })
  })
})

/**
 * The page as it publishes (AGL-3501): a heading, copy or image a reusable
 * component renders is the page's — pointed at the component's placement, and
 * never offered to a fix that would rewrite the page — and so is a row a
 * repeat shows.
 */
describe('seoPageFacts on a composed page', () => {
  const pageNodes: NodeMap = {
    root: { componentId: 'div', nodes: ['main'] },
    main: { componentId: 'section', props: { component: 'main' }, nodes: ['hero', 'intro', 'list'] },
    hero: { componentId: 'reusableInstance', props: { refId: 'sectionHeading', propValues: { title: 'Book a free on-site estimate' } } },
    intro: { componentId: 'muiTypography', props: { component: 'h1', children: 'Contact us' } },
    list: { componentId: 'muiStack', props: { repeatDataset: 'services' }, nodes: ['item'] },
    item: { componentId: 'muiTypography', props: { component: 'h2', children: '{{item.name}}' } },
  }
  // What the graft and the repeat make of it: the placement IS the component's
  // root, its inside is prefixed by the placement, and each row is a copy.
  const composed: NodeMap = {
    ...pageNodes,
    main: { ...pageNodes['main'], nodes: ['hero', 'intro', 'list'] },
    hero: { componentId: 'muiStack', nodes: ['cmp__hero__title', 'cmp__hero__photo'] },
    cmp__hero__title: { componentId: 'muiTypography', props: { component: 'h1', children: 'Book a free on-site estimate' } },
    cmp__hero__photo: { componentId: 'image', props: { src: 'media:host-1/truck', alt: '' } },
    list: { componentId: 'muiStack', nodes: ['rep__list__0__item', 'rep__list__1__item'] },
    rep__list__0__item: { componentId: 'muiTypography', props: { component: 'h2', children: 'Roofing' } },
    rep__list__1__item: { componentId: 'muiTypography', props: { component: 'h2', children: 'Siding' } },
  }
  const facts = seoPageFacts(composed, { rootId: 'root', pageNodes })

  it('reads the headings a component renders, pointed at its placement and not editable', () => {
    expect(facts.headings).toEqual([
      { nodeId: 'hero', level: 1, text: 'Book a free on-site estimate', editable: false, inComponent: true },
      { nodeId: 'intro', level: 1, text: 'Contact us', editable: true },
      { nodeId: 'item', level: 2, text: 'Roofing', editable: false },
      { nodeId: 'item', level: 2, text: 'Siding', editable: false },
    ])
    expect(facts.h1s.map((heading) => heading.nodeId)).toEqual(['hero', 'intro'])
  })

  it('carries a component’s copy and a repeat’s rows in the text', () => {
    expect(facts.text).toContain('Book a free on-site estimate')
    expect(facts.text).toContain('Roofing')
    expect(facts.text).not.toContain('{{')
  })

  it('reports a component’s image at its placement, as one no page fix can describe', () => {
    expect(facts.imagesMissingAlt).toEqual([
      expect.objectContaining({ nodeId: 'hero', src: 'media:host-1/truck', editable: false, inComponent: true }),
    ])
  })

  it('keeps the page’s own content region for a heading a fix adds', () => {
    expect(facts.contentRootId).toBe('main')
  })
})

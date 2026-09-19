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

import { AI_SEO_PAGE_TEXT_MAX_CHARS, aiSeoPageFacts } from './seo-page-facts'

const nodes = {
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

describe('aiSeoPageFacts', () => {
  const facts = aiSeoPageFacts(nodes, { rootId: 'root' })

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
      { nodeId: 'photo', src: 'media:host-1/lamp', alt: '', context: 'Every lamp is finished by hand.' },
    ])
    expect(facts.imagesMissingAlt.map((image) => image.nodeId)).toEqual(['photo'])
  })

  it('carries the page’s Markdown as its text, capped', () => {
    expect(facts.text).toContain('Every lamp is finished by hand.')
    expect(facts.text).not.toContain('Acme')
    expect(facts.wordCount).toBeGreaterThan(5)
    const long = aiSeoPageFacts(
      { root: { componentId: 'div', nodes: ['p'] }, p: { componentId: 'muiTypography', props: { children: 'word '.repeat(2_000) } } },
      { rootId: 'root' },
    )
    expect(long.text.length).toBe(AI_SEO_PAGE_TEXT_MAX_CHARS)
  })

  it('answers empty for a page with no nodes', () => {
    expect(aiSeoPageFacts(null)).toMatchObject({ text: '', headings: [], images: [], contentRootId: null })
  })
})

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
 * A site audit's content fixes (AGL-2910), applied to a COPY of a page: each
 * fix checked against the page as it is now, a heading's text held to the AI
 * node-tree validator, and the map it was handed left exactly as it was.
 */

import { AI_TEXT_LIMITS } from './ai-palette'
import { applyAiSeoContentFixes } from './seo-content-fixes'

const page = () => ({
  root: { $id: 'root', componentId: 'div', parentId: null, props: {}, nodes: ['main'] },
  main: { $id: 'main', componentId: 'section', parentId: 'root', props: { component: 'main' }, nodes: ['h1', 'h1b', 'rich', 'img', 'described'] },
  h1: { $id: 'h1', componentId: 'muiTypography', parentId: 'main', props: { variant: 'h1', children: 'Home' }, nodes: [] },
  h1b: { $id: 'h1b', componentId: 'muiTypography', parentId: 'main', props: { variant: 'h1', children: 'Also a title' }, nodes: [] },
  rich: { $id: 'rich', componentId: 'muiTypography', parentId: 'main', props: { variant: 'h2', html: '<b>Rich</b>' }, nodes: [] },
  img: { $id: 'img', componentId: 'image', parentId: 'main', props: { src: 'media:host-1/lamp' }, nodes: [] },
  described: { $id: 'described', componentId: 'image', parentId: 'main', props: { src: 'media:host-1/desk', alt: 'A desk' }, nodes: [] },
})

describe('applyAiSeoContentFixes', () => {
  it('applies each fix to a copy, and leaves the map it was given untouched', () => {
    const original = page()
    const before = JSON.parse(JSON.stringify(original))
    const result = applyAiSeoContentFixes(
      original,
      [
        { kind: 'image-alt', nodeId: 'img', alt: '  A brass desk lamp  ' },
        { kind: 'h1-set', nodeId: 'h1', text: 'Brass desk lamps made to order' },
        { kind: 'h1-demote', nodeId: 'h1b' },
      ],
      'main',
    )
    expect(original).toEqual(before)
    expect(result.applied).toHaveLength(3)
    expect(result.skipped).toEqual([])
    expect(result.nodes['img'].props).toEqual({ src: 'media:host-1/lamp', alt: 'A brass desk lamp' })
    expect(result.nodes['h1'].props).toEqual({ variant: 'h1', children: 'Brass desk lamps made to order', component: 'h1' })
    expect(result.nodes['h1b'].props).toEqual({ variant: 'h1', children: 'Also a title', component: 'h2' })
  })

  it('checks every fix against the page as it is now, and says why it skipped one', () => {
    const result = applyAiSeoContentFixes(
      page(),
      [
        { kind: 'image-alt', nodeId: 'described', alt: 'Something else' },
        { kind: 'image-alt', nodeId: 'gone', alt: 'A lamp' },
        { kind: 'h1-set', nodeId: 'rich', text: 'A heading' },
        { kind: 'h1-demote', nodeId: 'gone' },
      ],
      'main',
    )
    expect(result.applied).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      'The image has been given a description since the audit.',
      'The image is no longer on the page.',
      'The heading is rich text, which a fix does not rewrite.',
      'The heading is no longer on the page.',
    ])
    // A skipped image keeps the description a person wrote.
    expect(result.nodes['described'].props).toEqual({ src: 'media:host-1/desk', alt: 'A desk' })
  })

  it('adds a validated main heading first in the content region, under a fresh id', () => {
    const result = applyAiSeoContentFixes(page(), [{ kind: 'h1-insert', text: 'Brass desk lamps' }], 'main')
    expect(result.applied).toHaveLength(1)
    const main = result.nodes['main'] as { nodes: string[] }
    const [id, ...rest] = main.nodes
    expect(rest).toEqual(['h1', 'h1b', 'rich', 'img', 'described'])
    expect(Object.keys(page())).not.toContain(id)
    expect(result.nodes[id]).toMatchObject({
      $id: id,
      componentId: 'muiTypography',
      parentId: 'main',
      nodes: [],
      props: { variant: 'h1', children: 'Brass desk lamps' },
    })
  })

  it('holds a heading to a headline’s length, and skips one that says nothing', () => {
    const long = 'Lamp '.repeat(40)
    const result = applyAiSeoContentFixes(page(), [{ kind: 'h1-set', nodeId: 'h1', text: long }], 'main')
    expect(String(result.nodes['h1'].props?.['children']).length).toBeLessThanOrEqual(AI_TEXT_LIMITS.headline)
    const empty = applyAiSeoContentFixes(page(), [{ kind: 'h1-insert', text: '   ' }], 'main')
    expect(empty.skipped.map((entry) => entry.reason)).toEqual(['The proposed heading could not be used.'])
    const noRegion = applyAiSeoContentFixes(page(), [{ kind: 'h1-insert', text: 'Lamps' }], null)
    expect(noRegion.skipped[0].reason).toBe('The page has no content region to add a heading to.')
  })
})

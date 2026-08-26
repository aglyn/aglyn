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
 * What depends on a SCREEN (AGL-703).
 *
 * The kind `/api/hosts/where-used` could not answer, and the one whose
 * dependents are hardest to recall from memory — because a screen is
 * referenced three unrelated ways and only one of them looks like a
 * reference:
 *
 * - a LINK, stored as a screen id so renames cannot break it (AGL-1335);
 * - a CHILD screen, whose path is built out of this one's;
 * - a COLLECTION, which renders its list and entry pages through it.
 *
 * The third is the one that takes a live route off the site, and the reason
 * `relation` exists at all: copy that could not tell the three apart would
 * have to describe the worst case every time, on a path where it is almost
 * never the truth.
 */
import {
  scanScreenUsage,
  type CollectionCandidate,
  type UsageCandidate,
} from '../utils/server/scan-artifact-usage'

const linkNode = (value: unknown) => ({
  root: { componentId: 'button', props: { screenId: value } },
})

const screen = (
  id: string,
  overrides: Partial<UsageCandidate> = {},
): UsageCandidate => ({ id, displayName: id, ...overrides })

const collection = (
  overrides: Partial<CollectionCandidate> & { id: string },
): CollectionCandidate => ({ displayName: overrides.id, ...overrides })

const empty = {
  screens: [] as UsageCandidate[],
  layouts: [] as UsageCandidate[],
  components: [] as UsageCandidate[],
  collections: [] as CollectionCandidate[],
}

describe('scanScreenUsage (AGL-703)', () => {
  it('finds the marked link form a picker writes', () => {
    const found = scanScreenUsage('pricing', {
      ...empty,
      screens: [screen('home', { nodes: linkNode('screen:pricing') as never })],
    })
    expect(found).toEqual([
      expect.objectContaining({ id: 'home', type: 'screen', relation: 'link' }),
    ])
  })

  it('finds the legacy BARE id too', () => {
    // Everything authored before AGL-1335 stores the id unmarked. A scan that
    // read only the marked form would report the oldest, most-linked screens
    // on a site as linked from nowhere.
    const found = scanScreenUsage('pricing', {
      ...empty,
      layouts: [screen('chrome', { nodes: linkNode('pricing') as never })],
    })
    expect(found.map((item) => item.type)).toEqual(['layout'])
  })

  it('walks INTO item arrays, where a site\'s navigation actually lives', () => {
    // A nav strip, a tab set, a mega menu: the targets are inside an array of
    // item objects, not at a known prop key. A shallow walk finds none of
    // them, which is every internal link on a typical site.
    const nodes = {
      nav: {
        componentId: 'tabs',
        props: {
          items: [
            { label: 'Home', link: 'screen:home' },
            { label: 'Pricing', link: 'screen:pricing' },
          ],
        },
      },
    }
    expect(
      scanScreenUsage('pricing', {
        ...empty,
        components: [screen('site-nav', { nodes: nodes as never })],
      }).map((item) => item.id),
    ).toEqual(['site-nav'])
  })

  it('counts a child screen, which a link scan would never see', () => {
    const found = scanScreenUsage('company', {
      ...empty,
      screens: [screen('about', { parentId: 'company' })],
    })
    expect(found).toEqual([
      expect.objectContaining({ id: 'about', relation: 'child' }),
    ])
  })

  it('counts every field a collection can bind a template with', () => {
    // Three fields, including a `templateScreenId` superseded by a newer
    // `entryScreenId`: a superseded pointer still renders pages.
    for (const field of [
      'listScreenId',
      'entryScreenId',
      'templateScreenId',
    ] as const) {
      const found = scanScreenUsage('tpl', {
        ...empty,
        collections: [collection({ id: 'blog', [field]: 'tpl' })],
      })
      expect(found).toEqual([
        expect.objectContaining({ type: 'collection', relation: 'template' }),
      ])
    }
  })

  it('keeps the most consequential relation when one thing does two', () => {
    // A child that also links back to its parent is ONE row, and the child
    // relation is the one that survives: it costs a moved path, where the
    // link costs a click.
    const found = scanScreenUsage('company', {
      ...empty,
      screens: [
        screen('about', {
          parentId: 'company',
          nodes: linkNode('screen:company') as never,
        }),
      ],
    })
    expect(found).toHaveLength(1)
    expect(found[0].relation).toBe('child')
  })

  it('never reports the screen as its own dependent', () => {
    // A page linking to itself is legal — a logo in its own header.
    expect(
      scanScreenUsage('home', {
        ...empty,
        screens: [
          screen('home', {
            nodes: linkNode('screen:home') as never,
            parentId: undefined,
          }),
        ],
      }),
    ).toEqual([])
  })

  it('skips deleted documents on both sides', () => {
    expect(
      scanScreenUsage('pricing', {
        ...empty,
        screens: [
          screen('gone', {
            nodes: linkNode('screen:pricing') as never,
            deletedAt: 'yes',
          }),
        ],
        collections: [
          collection({ id: 'old', entryScreenId: 'pricing', deletedAt: 'yes' }),
        ],
      }),
    ).toEqual([])
  })

  it('does not mistake a plain address for a screen reference', () => {
    // `/pricing` is a literal href, not this screen — `splitLinkValue` reads
    // it that way and so must this.
    expect(
      scanScreenUsage('pricing', {
        ...empty,
        screens: [screen('home', { nodes: linkNode('/pricing') as never })],
      }),
    ).toEqual([])
  })
})

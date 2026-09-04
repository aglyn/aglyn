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

import { breadcrumbListJsonLd } from './breadcrumb-json-ld'

const ORIGIN = 'https://aglyn.com'

describe('breadcrumbListJsonLd (AGL-2535)', () => {
  it('numbers the trail from one and absolutizes every item', () => {
    expect(
      breadcrumbListJsonLd(
        [
          { name: 'Blog', path: '/blog' },
          { name: 'From a form to a dataset', path: '/blog/from-a-form' },
        ],
        ORIGIN,
      ),
    ).toEqual({
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Blog',
          item: 'https://aglyn.com/blog',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'From a form to a dataset',
          item: 'https://aglyn.com/blog/from-a-form',
        },
      ],
    })
  })

  it('publishes DISPLAY names, not url segments', () => {
    // The reason this takes names rather than a path. The screen-path builder
    // splits the routing map and publishes "company"/"about"; a content route
    // has the real headline in hand and must use it.
    const crumbs = breadcrumbListJsonLd(
      [
        { name: 'Newsroom', path: '/press' },
        { name: 'Aglyn opens early access', path: '/press/aglyn-opens-early-access' },
      ],
      ORIGIN,
    )
    const names = (crumbs?.['itemListElement'] as { name: string }[]).map(
      (item) => item.name,
    )
    expect(names).toEqual(['Newsroom', 'Aglyn opens early access'])
  })

  it('emits NOTHING for a single crumb', () => {
    // Not a trail — the page restating its own title. Google treats a
    // one-element list as ineligible, so emitting it is noise that also
    // invites a rich-result warning.
    expect(
      breadcrumbListJsonLd([{ name: 'Blog', path: '/blog' }], ORIGIN),
    ).toBeUndefined()
    expect(breadcrumbListJsonLd([], ORIGIN)).toBeUndefined()
    expect(breadcrumbListJsonLd(null, ORIGIN)).toBeUndefined()
  })

  it('emits nothing with no origin, rather than relative items', () => {
    // A crawler reads this without a page to resolve against, so a relative
    // `item` is silently ignored — worse than an absent breadcrumb, because
    // it reads as coverage.
    expect(
      breadcrumbListJsonLd(
        [
          { name: 'Blog', path: '/blog' },
          { name: 'Post', path: '/blog/post' },
        ],
        undefined,
      ),
    ).toBeUndefined()
  })

  it('drops a crumb with no name or no path, and re-numbers', () => {
    // A half-filled crumb would publish an unnamed step or a link to the
    // site root. Dropping it can take the list below two, which then emits
    // nothing at all — the honest outcome.
    const crumbs = breadcrumbListJsonLd(
      [
        { name: 'Blog', path: '/blog' },
        { name: '  ', path: '/blog/ghost' },
        { name: 'Real post', path: '/blog/real' },
      ],
      ORIGIN,
    )
    expect(crumbs?.['itemListElement']).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Blog', item: 'https://aglyn.com/blog' },
      { '@type': 'ListItem', position: 2, name: 'Real post', item: 'https://aglyn.com/blog/real' },
    ])
    expect(
      breadcrumbListJsonLd(
        [
          { name: 'Blog', path: '/blog' },
          { name: 'Nameless', path: '   ' },
        ],
        ORIGIN,
      ),
    ).toBeUndefined()
  })

  it('does not double a slash however the caller spells the parts', () => {
    const crumbs = breadcrumbListJsonLd(
      [
        { name: 'Blog', path: 'blog' },
        { name: 'Post', path: '/blog/post' },
      ],
      'https://aglyn.com/',
    )
    expect(
      (crumbs?.['itemListElement'] as { item: string }[]).map((i) => i.item),
    ).toEqual(['https://aglyn.com/blog', 'https://aglyn.com/blog/post'])
  })
})

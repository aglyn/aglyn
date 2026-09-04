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

import type { ContentAuthorRecord } from './content-authors'
import {
  CONTENT_AUTHOR_PROFILE_COMPONENT_ID,
  contentAuthorTokens,
  expandContentAuthorProfile,
} from './content-author-profile'

const author: ContentAuthorRecord = {
  $id: 'a1',
  slug: 'zg',
  name: 'Zach Gover',
  bio: 'Building the open web platform.',
  image: 'media:host-1/portrait',
  jobTitle: 'Founder',
  worksFor: 'Aglyn',
  url: 'https://zach.example',
  links: [{ platform: 'x', url: 'https://x.com/aglyn' }],
}

const profileNodes = (props: Record<string, unknown> = {}) =>
  ({
    root: { $id: 'root', componentId: 'div', nodes: ['profile'] },
    profile: {
      $id: 'profile',
      componentId: CONTENT_AUTHOR_PROFILE_COMPONENT_ID,
      parentId: 'root',
      props,
    },
  }) as never

describe('the author page’s tokens (AGL-2518)', () => {
  it('carries every field of the record', () => {
    const tokens = contentAuthorTokens(author, { entryCount: 12 })
    expect(tokens['author.name']).toBe('Zach Gover')
    expect(tokens['author.bio']).toBe('Building the open web platform.')
    expect(tokens['author.jobTitle']).toBe('Founder')
    expect(tokens['author.worksFor']).toBe('Aglyn')
    // RAW, like every image field in this codebase: resolving a media
    // reference to a fetchable src needs the rendering host, and a token map
    // has none.
    expect(tokens['author.image']).toBe('media:host-1/portrait')
  })

  it('keeps their own site distinct from their page here', () => {
    const tokens = contentAuthorTokens(author)
    // Two destinations. Conflating them is how a byline ends up sending a
    // reader off-site from every article.
    expect(tokens['author.url']).toBe('https://zach.example')
    expect(tokens['author.pageUrl']).toBe('/author/zg')
  })

  it('empties every token off an author page', () => {
    // What lets a designed screen bind them unconditionally: a heading bound
    // to `{{author.name}}` has nothing to print elsewhere, and a template has
    // no runtime conditional to vary itself with.
    const tokens = contentAuthorTokens(null)
    for (const key of [
      'author.name',
      'author.bio',
      'author.image',
      'author.jobTitle',
      'author.worksFor',
      'author.url',
      'author.pageUrl',
    ]) {
      expect([key, tokens[key]]).toEqual([key, ''])
    }
  })

  it('pluralizes the post count, because a template cannot', () => {
    expect(contentAuthorTokens(author, { entryCount: 1 })[
      'author.entryCountLabel'
    ]).toBe('1 post')
    expect(contentAuthorTokens(author, { entryCount: 0 })[
      'author.entryCountLabel'
    ]).toBe('0 posts')
    expect(contentAuthorTokens(author, { entryCount: 12 })[
      'author.entryCountLabel'
    ]).toBe('12 posts')
  })

  it('reads a missing or nonsense count as zero rather than NaN', () => {
    expect(contentAuthorTokens(author)['author.entryCount']).toBe('0')
    expect(
      contentAuthorTokens(author, { entryCount: -3 })['author.entryCount'],
    ).toBe('0')
  })
})

describe('filling the Author Profile block (AGL-2518)', () => {
  it('stamps the record, so nothing has to be typed as literal text', () => {
    const nodes = expandContentAuthorProfile(profileNodes(), author)
    expect((nodes as never as Record<string, any>)['profile'].props).toEqual({
      name: 'Zach Gover',
      bio: 'Building the open web platform.',
      image: 'media:host-1/portrait',
      jobTitle: 'Founder',
      worksFor: 'Aglyn',
      url: 'https://zach.example',
      links: [{ platform: 'x', url: 'https://x.com/aglyn' }],
    })
  })

  it('never overwrites an authored value or a token awaiting substitution', () => {
    const nodes = expandContentAuthorProfile(
      profileNodes({ name: 'Guest curator', bio: '{{author.bio}}' }),
      author,
    ) as never as Record<string, any>
    expect(nodes['profile'].props.name).toBe('Guest curator')
    // Substitution runs later and must win.
    expect(nodes['profile'].props.bio).toBe('{{author.bio}}')
    expect(nodes['profile'].props.jobTitle).toBe('Founder')
  })

  it('fills links regardless, since there is no authored form of them', () => {
    // A row carries a platform or a picked icon, both chosen in the console's
    // author editor — so there is no authored value to defer to, and `Show
    // links` is the template's control over them.
    const nodes = expandContentAuthorProfile(
      profileNodes({ links: [] }),
      author,
    ) as never as Record<string, any>
    expect(nodes['profile'].props.links).toEqual([
      { platform: 'x', url: 'https://x.com/aglyn' },
    ])
  })

  it('drops a link the store should never have held', () => {
    // Normalized on the way through rather than trusted: this is a boundary a
    // stored document crosses to become props.
    const nodes = expandContentAuthorProfile(profileNodes(), {
      name: 'Zach Gover',
      links: [{ label: 'Bad', url: 'javascript:alert(1)' }],
    } as ContentAuthorRecord) as never as Record<string, any>
    expect(nodes['profile'].props.links).toBeUndefined()
  })

  it('leaves the tree untouched when no author is routed', () => {
    const before = profileNodes()
    expect(expandContentAuthorProfile(before, null)).toBe(before)
  })

  it('leaves a tree with no profile block untouched', () => {
    const before = {
      root: { $id: 'root', componentId: 'div', nodes: [] },
    } as never
    expect(expandContentAuthorProfile(before, author)).toBe(before)
  })
})

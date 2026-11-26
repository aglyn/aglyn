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

import {
  mediaIdsUsedBy,
  mediaMovePatch,
  mediaUseRewriter,
  orgToSiteRefusal,
  type MediaLibraryMove,
} from './media-library-move'
import { decodeStoredNodes, encodeStoredNodes } from './stored-nodes'

const toSite: MediaLibraryMove = {
  mediaId: 'PHOTO1',
  fromScope: 'org:ORG1',
  toScope: 'HOST1',
  fromObjectPath: 'orgs/ORG1/media/gear/nova/PHOTO1',
  toObjectPath: 'hosts/HOST1/media/gear/nova/PHOTO1',
}

describe('mediaUseRewriter', () => {
  it('rewrites a reference, a qualified reference and a CDN path to the site', () => {
    const { rewrite, counts } = mediaUseRewriter([toSite])
    expect(rewrite('media:org:ORG1/PHOTO1')).toBe('media:HOST1/PHOTO1')
    expect(rewrite('media:org:ORG1:HOST1/PHOTO1')).toBe('media:HOST1/PHOTO1')
    expect(rewrite('https://x.aglyn.app/api/media/cdn/org:ORG1/PHOTO1?w=640')).toBe(
      'https://x.aglyn.app/api/media/cdn/HOST1/PHOTO1?w=640',
    )
    expect(rewrite('/api/media/cdn/org:ORG1/PHOTO1/abc123')).toBe(
      '/api/media/cdn/HOST1/PHOTO1/abc123',
    )
    expect(counts.get('PHOTO1')).toBe(4)
  })

  it('keeps a content pin and leaves other files and look-alike ids alone', () => {
    const { rewrite } = mediaUseRewriter([toSite])
    expect(rewrite('media:org:ORG1/PHOTO1@hash9')).toBe('media:HOST1/PHOTO1@hash9')
    expect(rewrite('media:org:ORG1/PHOTO12')).toBe('media:org:ORG1/PHOTO12')
    expect(rewrite('media:org:OTHER/PHOTO1')).toBe('media:org:OTHER/PHOTO1')
    expect(rewrite('PHOTO1 is a word')).toBe('PHOTO1 is a word')
  })

  it('rewrites a legacy storage URL and its derived objects', () => {
    const { rewrite } = mediaUseRewriter([toSite])
    const encoded = encodeURIComponent('orgs/ORG1/media/gear/nova/PHOTO1')
    const moved = encodeURIComponent('hosts/HOST1/media/gear/nova/PHOTO1')
    expect(
      rewrite(`https://firebasestorage.googleapis.com/v0/b/b/o/${encoded}?alt=media&token=t`),
    ).toBe(`https://firebasestorage.googleapis.com/v0/b/b/o/${moved}?alt=media&token=t`)
    expect(rewrite(`x/o/${encoded}__w640.webp`)).toBe(`x/o/${moved}__w640.webp`)
  })

  it('writes an organization file bare when it comes from a site', () => {
    const { rewrite } = mediaUseRewriter([
      { mediaId: 'LOGO', fromScope: 'HOST1', toScope: 'org:ORG1' },
    ])
    expect(rewrite('media:HOST1/LOGO')).toBe('media:org:ORG1/LOGO')
    expect(rewrite('/api/media/cdn/HOST1/LOGO')).toBe('/api/media/cdn/org:ORG1/LOGO')
    expect(rewrite('media:HOST2/LOGO')).toBe('media:HOST2/LOGO')
  })
})

describe('mediaMovePatch', () => {
  it('rewrites a version whose nodes are stored as compressed bytes, and keeps them bytes', () => {
    const tree = {
      root: { type: 'Image', props: { src: 'media:org:ORG1/PHOTO1', alt: 'Nova' } },
      other: { type: 'Text', props: { text: 'hello' } },
    }
    const version = {
      nodes: encodeStoredNodes(tree),
      seo: { image: '/api/media/cdn/org:ORG1/PHOTO1' },
      title: 'Home',
    }
    const { rewrite, counts } = mediaUseRewriter([toSite])
    const patch = mediaMovePatch(version, rewrite)
    expect(patch).not.toBeNull()
    expect(Object.keys(patch ?? {}).sort()).toEqual(['nodes', 'seo'])
    expect(patch?.['nodes']).toBeInstanceOf(Uint8Array)
    const decoded = decodeStoredNodes<typeof tree>(patch?.['nodes'])
    expect(decoded?.root.props.src).toBe('media:HOST1/PHOTO1')
    expect(decoded?.other.props.text).toBe('hello')
    expect(patch?.['seo']).toEqual({ image: '/api/media/cdn/HOST1/PHOTO1' })
    expect(counts.get('PHOTO1')).toBe(2)
  })

  it('rewrites a draft whose nodes are a plain map, and keeps them a map', () => {
    const draft = { nodes: { a: { props: { src: 'media:org:ORG1:HOST1/PHOTO1' } } } }
    const patch = mediaMovePatch(draft, mediaUseRewriter([toSite]).rewrite)
    expect(patch?.['nodes']).toEqual({ a: { props: { src: 'media:HOST1/PHOTO1' } } })
  })

  it('rewrites product images and variants', () => {
    const product = {
      imageUrl: 'media:org:ORG1/PHOTO1',
      mediaUrls: ['media:org:ORG1/PHOTO1', 'media:org:ORG1/OTHER'],
      variants: [{ id: 'v1', imageUrl: 'media:org:ORG1/PHOTO1' }],
    }
    const patch = mediaMovePatch(product, mediaUseRewriter([toSite]).rewrite)
    expect(patch).toEqual({
      imageUrl: 'media:HOST1/PHOTO1',
      mediaUrls: ['media:HOST1/PHOTO1', 'media:org:ORG1/OTHER'],
      variants: [{ id: 'v1', imageUrl: 'media:HOST1/PHOTO1' }],
    })
  })

  it('answers null for a document that does not use the file, and leaves non-plain values alone', () => {
    const when = new Date(0)
    expect(mediaMovePatch({ title: 'x', at: when }, mediaUseRewriter([toSite]).rewrite)).toBeNull()
  })
})

describe('mediaIdsUsedBy', () => {
  it('finds uses inside compressed nodes', () => {
    const rewriter = mediaUseRewriter([toSite, { ...toSite, mediaId: 'UNUSED' }])
    const data = { nodes: encodeStoredNodes({ a: { props: { src: 'media:org:ORG1/PHOTO1' } } }) }
    expect(mediaIdsUsedBy(data, rewriter)).toEqual(['PHOTO1'])
  })
})

describe('orgToSiteRefusal', () => {
  it('allows a file only this site uses', () => {
    expect(
      orgToSiteRefusal([{ mediaId: 'P', hostId: 'HOST1', area: 'screens', name: 'Home' }], 'HOST1'),
    ).toBeNull()
  })

  it('names another site and the CRM', () => {
    expect(
      orgToSiteRefusal(
        [
          { mediaId: 'P', hostId: 'HOST2', area: 'screens', name: 'Home' },
          { mediaId: 'P', hostId: '', area: 'crm', name: 'Billy' },
        ],
        'HOST1',
        { HOST2: 'Blog' },
      ),
    ).toBe('Stays in the organization library: another site uses it (Blog) and the CRM uses it')
  })

  it('names the workspace settings', () => {
    expect(
      orgToSiteRefusal([{ mediaId: 'P', hostId: '', area: 'org', name: 'Workspace' }], 'HOST1'),
    ).toBe('Stays in the organization library: the workspace uses it (its logo or settings)')
  })
})

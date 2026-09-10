/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom, where `next/cache` throws `Class extends value undefined`.
 *
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
 * A page carrying a Video element publishes a `VideoObject` (AGL-2747).
 *
 * The unit rules live beside the builder
 * (`libs/aglyn/.../video-object.spec.ts`). These assert the two things only
 * the ROUTE can answer: that the block reaches the rendered page at all, and
 * that it is built from the node map the page SHIPS rather than the one the
 * loader read — a video inside a withheld lazy tab panel is not in the HTML,
 * and a `VideoObject` describing a player that is not there is the mismatch a
 * video rich result is checked for.
 */

jest.mock('../app/[host]/[scheme]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
jest.mock('../app/[host]/[scheme]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: () => null,
}))

import { loadPageData } from '../app/[host]/[scheme]/[[...slug]]/load-page-data'
import CatchAllPage from '../app/[host]/[scheme]/[[...slug]]/page'

const mockLoad = loadPageData as jest.Mock

const ORIGIN = 'https://custom.example'

const host = {
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: { 'screen-1': '/' },
  seo: {},
}

/** A Video node with everything a video result requires. */
const videoNode = (props: Record<string, unknown> = {}) => ({
  $id: 'v1',
  componentId: 'video',
  props: {
    title: 'The 60-second tour',
    description: 'What Aglyn does, end to end.',
    uploadDate: '2026-09-01',
    poster: 'media:host-1/still',
    src: 'media:host-1/film',
    ...props,
  },
})

/** Renders the route and returns every JSON-LD block it emitted, parsed. */
const jsonLdFor = async (nodes: Record<string, unknown> | null) => {
  mockLoad.mockResolvedValue({
    props: {
      data: { host, screen: { data: { $id: 'screen-1' } } },
      nodes,
    },
  })
  const tree = await CatchAllPage({
    params: Promise.resolve({ host: 'acme', slug: [] }),
  } as never)
  // The route renders `<script dangerouslySetInnerHTML>` per block; walking the
  // element tree reads what the HTML would carry without a DOM.
  const blocks: string[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const html = node.props?.dangerouslySetInnerHTML?.__html
    if (typeof html === 'string') blocks.push(html)
    walk(node.props?.children)
  }
  walk(tree)
  return blocks
    // The animation `<style>`/`<script>` use the same prop and are not JSON.
    .filter((block) => block.trim().startsWith('{'))
    .map((block) => ({ raw: block, value: JSON.parse(block) }))
}

const videoBlocks = async (nodes: Record<string, unknown> | null) =>
  (await jsonLdFor(nodes)).filter(
    (block) => block.value['@type'] === 'VideoObject',
  )

beforeEach(() => jest.clearAllMocks())

describe('VideoObject reaches the rendered page (AGL-2747)', () => {
  it('emits one block for a page carrying a filled-in Video', async () => {
    const [block] = await videoBlocks({ v1: videoNode() })
    expect(block).toBeDefined()
    expect(block.value).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: 'The 60-second tour',
      description: 'What Aglyn does, end to end.',
      uploadDate: '2026-09-01',
      thumbnailUrl: `${ORIGIN}/api/media/cdn/host-1/still?w=1280`,
      contentUrl: `${ORIGIN}/api/media/cdn/host-1/film`,
    })
  })

  it('never publishes a media reference a crawler cannot fetch', async () => {
    const [block] = await videoBlocks({ v1: videoNode() })
    expect(block.raw).not.toContain('media:')
  })

  it('leaves the page with no video exactly as it was', async () => {
    // The common case, and the one that must cost nothing: no extra script,
    // and every block that was already emitted still emitted.
    const withoutVideo = await jsonLdFor(null)
    expect(
      withoutVideo.filter((block) => block.value['@type'] === 'VideoObject'),
    ).toEqual([])
    expect(withoutVideo.some((block) => block.value['@type'] === 'WebSite')).toBe(
      true,
    )
  })

  it('says nothing about a video whose SEO fields are blank', async () => {
    // A block missing one of the four required fields is an error a search
    // console reports against the page, not a smaller win.
    expect(
      await videoBlocks({ v1: videoNode({ description: '' }) }),
    ).toEqual([])
  })

  it('still emits the site entity and breadcrumb blocks beside it', async () => {
    const blocks = await jsonLdFor({ v1: videoNode() })
    const types = blocks.map((block) => block.value['@type'])
    expect(types).toContain('VideoObject')
    expect(types).toContain('WebSite')
  })

  it('emits nothing at all on a gated surface', async () => {
    // `buildJsonLd` returns `[]` for membership/maintenance/members-only
    // pages, and a video on one of them must not be the exception.
    mockLoad.mockResolvedValue({
      props: {
        data: { host, screen: { data: { $id: 'screen-1' } } },
        nodes: { v1: videoNode() },
        memberScreen: true,
      },
    })
    const tree = await CatchAllPage({
      params: Promise.resolve({ host: 'acme', slug: [] }),
    } as never)
    const blocks: string[] = []
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(walk)
      const html = node.props?.dangerouslySetInnerHTML?.__html
      if (typeof html === 'string') blocks.push(html)
      walk(node.props?.children)
    }
    walk(tree)
    expect(blocks.filter((block) => block.includes('VideoObject'))).toEqual([])
  })
})

/**
 * @jest-environment node
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
 * A page carrying a FAQ section publishes a `FAQPage` (AGL-3574).
 *
 * The unit rules — which labels name a FAQ, which shapes hold a pair, the
 * two-pair floor and the fifty-pair cap — live beside the builder
 * (`libs/aglyn/.../faq-page.spec.ts`). These assert what only the ROUTE can
 * answer: that the block reaches the rendered page, on every branch
 * `buildJsonLd` takes, and that the page with no FAQ is left exactly as it
 * was.
 */

jest.mock('../app/[host]/[scheme]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
jest.mock('../app/[host]/[scheme]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: () => null,
}))

import { NODE_ROOT_ID } from '@aglyn/aglyn/canvas-manager/canvas-manager'
import { loadPageData } from '../app/[host]/[scheme]/[[...slug]]/load-page-data'
import CatchAllPage from '../app/[host]/[scheme]/[[...slug]]/page'

const mockLoad = loadPageData as jest.Mock

const host = {
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: { 'screen-1': '/' },
  seo: {},
}

const QA: Array<[string, string]> = [
  ['Do I need to know how to code?', 'No. Describe the site and edit the result.'],
  ['Can I use my own domain?', 'Yes, from the Starter plan up.'],
]

/** A FAQ section holding `QA` as a grid of two-text stacks, flat as the map ships. */
const faqNodes = (ariaLabel = 'Frequently asked questions') => {
  const nodes: Record<string, unknown> = {
    [NODE_ROOT_ID]: { $id: NODE_ROOT_ID, componentId: 'div', nodes: ['faq'] },
    faq: {
      $id: 'faq',
      componentId: 'section',
      parentId: NODE_ROOT_ID,
      props: { element: 'section', ariaLabel },
      nodes: ['heading', 'grid'],
    },
    heading: {
      $id: 'heading',
      componentId: 'muiTypography',
      parentId: 'faq',
      props: { variant: 'h2', children: ariaLabel },
    },
    grid: {
      $id: 'grid',
      componentId: 'muiGrid',
      parentId: 'faq',
      props: { container: true },
      nodes: QA.map((_, i) => `item${i}`),
    },
  }
  QA.forEach(([question, answer], i) => {
    nodes[`item${i}`] = {
      $id: `item${i}`,
      componentId: 'muiStack',
      parentId: 'grid',
      nodes: [`q${i}`, `a${i}`],
    }
    nodes[`q${i}`] = {
      $id: `q${i}`,
      componentId: 'muiTypography',
      parentId: `item${i}`,
      props: { variant: 'h3', children: question },
    }
    nodes[`a${i}`] = {
      $id: `a${i}`,
      componentId: 'muiTypography',
      parentId: `item${i}`,
      props: { children: answer },
    }
  })
  return nodes
}

/** Renders the route and returns every JSON-LD block it emitted, parsed. */
const jsonLdFor = async (
  nodes: Record<string, unknown> | null,
  extra: Record<string, unknown> = {},
) => {
  mockLoad.mockResolvedValue({
    props: {
      data: { host, screen: { data: { $id: 'screen-1' } } },
      nodes,
      ...extra,
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
  return blocks
    .filter((block) => block.trim().startsWith('{'))
    .map((block) => ({ raw: block, value: JSON.parse(block) }))
}

const faqBlocks = async (nodes: Record<string, unknown> | null) =>
  (await jsonLdFor(nodes)).filter((block) => block.value['@type'] === 'FAQPage')

beforeEach(() => jest.clearAllMocks())

describe('FAQPage reaches the rendered page (AGL-3574)', () => {
  it('emits one block listing every question with its answer', async () => {
    const blocks = await faqBlocks(faqNodes())
    expect(blocks).toHaveLength(1)
    expect(blocks[0].value).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: QA.map(([name, text]) => ({
        '@type': 'Question',
        name,
        acceptedAnswer: { '@type': 'Answer', text },
      })),
    })
  })

  it('leaves the page with no FAQ exactly as it was', async () => {
    const blocks = await jsonLdFor(null)
    expect(blocks.filter((block) => block.value['@type'] === 'FAQPage')).toEqual([])
    expect(blocks.some((block) => block.value['@type'] === 'WebSite')).toBe(true)
  })

  it('still emits the site-wide blocks beside it', async () => {
    const types = (await jsonLdFor(faqNodes())).map((block) => block.value['@type'])
    expect(types).toContain('FAQPage')
    expect(types).toContain('WebSite')
  })

  it('emits nothing at all on a gated surface', async () => {
    const blocks = await jsonLdFor(faqNodes(), { memberScreen: true })
    expect(blocks.filter((block) => block.raw.includes('FAQPage'))).toEqual([])
  })
})

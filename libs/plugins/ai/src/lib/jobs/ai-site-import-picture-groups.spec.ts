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
 * A group of photos is a gallery (AGL-4152). On a live import a row of three
 * job photos under each heading was read as a list and every photo of it
 * dropped, 7 of a page's 13 pictures drawn; a gallery page of 39 photos was
 * drawn as a strip of logos 40 px high. Invented pages, read, built and
 * scored with no model.
 */

import type { SiteImportLayout, SiteImportLayoutGroup, SiteImportLayoutNode } from '../model/ai-site-import'
import { siteImportFidelity, siteImportFidelityHolds, type SiteImportFidelityNode } from '../model/ai-site-import-fidelity'
import { siteImportReplayBuild, siteImportReplayDocumentOf, type SiteImportReplayPage } from '../site-import/fixtures/site-import-fidelity-replay'
import { extractSiteImportPage } from '../site-import/site-import-html'
import { siteImportLayout } from '../site-import/site-import-layout'

const URL_OF_PAGE = 'https://www.larkspur-paving.example/work'
const sameSite = (url: URL) => url.hostname === 'www.larkspur-paving.example'
const RULES = '.row { display: flex; flex-direction: row; gap: 20px; } .row > div { flex: 1; } .gallery { display: grid; gap: 20px; } .strip { display: flex; flex-direction: row; } .strip img { height: 40px; }'
const page = (body: string) => `<!doctype html><html><head><title>Our work</title><style>${RULES}</style></head><body><main><section><h1>Our work</h1><p>Every job we pour, from the first form to the last finish.</p></section>${body}</main></body></html>`
const photo = (name: string, extra = '') => `<img src="https://www.larkspur-paving.example/media/${name}.jpg" alt="" width="1200" height="900" ${extra}>`
const trio = (heading: string, names: string[]) => `<h3>${heading}</h3><div class="row">${names.map((name) => `<div>${photo(name)}</div>`).join('')}</div>`
const jobs = page(`<section><h2>What we handle</h2>${trio('Sidewalks', ['walk-1', 'walk-2', 'walk-3'])}<p>Curbs, gutters and walks to the city's specs.</p>${trio('Trenches', ['trench-1', 'trench-2', 'trench-3'])}</section>`)
const NAMES = Array.from({ length: 9 }, (_, at) => `job-${at + 1}`)
const gallery = page(`<section><h2>Recent projects</h2><div class="gallery">${NAMES.map((name) => `<figure>${photo(name, 'sizes="(max-width:768px) 46vw, 28vw" style="object-fit: cover; width: 100%; height: 100%"')}</figure>`).join('')}</div></section>`)
const logos = page(`<section><h2>Who we work with</h2><div class="strip">${['one', 'two', 'three', 'four'].map((name) => `<div><img src="https://www.larkspur-paving.example/media/${name}-logo.png" alt="Partner ${name}" width="240" height="80"></div>`).join('')}</div></section>`)

function layoutOf(html: string): SiteImportLayout {
  const extract = extractSiteImportPage(html, URL_OF_PAGE, sameSite, { structure: true })
  return siteImportLayout(extract as Parameters<typeof siteImportLayout>[0]) as SiteImportLayout
}
function groupsOf(layout: SiteImportLayout): SiteImportLayoutGroup[] {
  const out: SiteImportLayoutGroup[] = []
  const visit = (nodes: readonly SiteImportLayoutNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'group') out.push(node)
      if (node.kind === 'row') for (const cell of node.cells) visit(cell.nodes)
    }
  }
  for (const section of layout.sections) visit(section.nodes)
  return out
}
const built = (html: string, finish: 'keep' | 'improve' = 'keep'): SiteImportReplayPage => siteImportReplayBuild(siteImportReplayDocumentOf(html, URL_OF_PAGE, sameSite), '/work', false, { finish, words: 'kept' })
const isGrid = (node: SiteImportFidelityNode | undefined) => node?.componentId === 'muiGrid' && (node.props?.['container'] === true || node.props?.['container'] === 'true')

/** The galleries a page draws: each Grid of pictures, by how many it holds and the size each column takes. */
function galleriesOf(page_: SiteImportReplayPage): Array<{ pictures: number; size: unknown; cover: boolean }> {
  const nodes = page_.tree.nodes as Record<string, SiteImportFidelityNode>
  return Object.values(nodes)
    .filter((node) => isGrid(node) && (node.nodes ?? []).length > 0 && (node.nodes ?? []).every((id) => (nodes[id]?.nodes ?? []).some((child) => nodes[child]?.componentId === 'image')))
    .map((node) => {
      const images = (node.nodes ?? []).flatMap((id) => (nodes[id]?.nodes ?? []).filter((child) => nodes[child]?.componentId === 'image'))
      return { pictures: images.length, size: nodes[(node.nodes ?? [])[0] as string]?.props?.['size'], cover: images.every((id) => nodes[id]?.props?.['objectFit'] === 'cover') }
    })
}

describe('a group of photos is read as a gallery', () => {
  it('three photos under a heading, in the row the source sets them', () => {
    const groups = groupsOf(layoutOf(jobs))
    expect(groups.map((group) => [group.group, group.gallery, group.columns, group.items.length])).toEqual([
      ['logos', true, 3, 3],
      ['logos', true, 3, 3],
    ])
  })

  it('a gallery in the columns its pictures are sized to', () => {
    const groups = groupsOf(layoutOf(gallery))
    expect(groups.map((group) => [group.group, group.gallery, group.columns, group.items.length])).toEqual([['logos', true, 3, 9]])
  })

  it('a strip of small marks stays logos', () => {
    const groups = groupsOf(layoutOf(logos))
    expect(groups.map((group) => [group.group, group.gallery ?? false])).toEqual([['logos', false]])
  })
})

describe('a gallery is drawn as its photos in their columns', () => {
  it.each(['keep', 'improve'] as const)('every photo of a row of three, as %s', (finish) => {
    const page_ = built(jobs, finish)
    expect(page_.violations).toEqual([])
    expect(galleriesOf(page_)).toEqual([
      { pictures: 3, size: 'xs:12 sm:6 md:4', cover: true },
      { pictures: 3, size: 'xs:12 sm:6 md:4', cover: true },
    ])
    const report = siteImportFidelity(page_.source, page_.tree, { finish, words: 'kept' })
    expect(report.pictures).toMatchObject({ source: 6, built: 6 })
    expect(report.galleries).toMatchObject({ source: 2, built: 2 })
    expect(siteImportFidelityHolds(report)).toBe(true)
  })

  it('a gallery of nine in three columns', () => {
    const page_ = built(gallery)
    expect(galleriesOf(page_)).toEqual([{ pictures: 9, size: 'xs:12 sm:6 md:4', cover: true }])
    const report = siteImportFidelity(page_.source, page_.tree, { finish: 'keep', words: 'kept' })
    expect(report.galleries).toMatchObject({ source: 1, built: 1 })
    expect(report.pictures).toMatchObject({ source: 9, built: 9 })
  })

  it('logos stay a strip of marks', () => {
    const page_ = built(logos)
    expect(galleriesOf(page_)).toEqual([])
    const report = siteImportFidelity(page_.source, page_.tree, { finish: 'keep', words: 'kept' })
    expect(report.galleries).toBeUndefined()
  })

  it('the fidelity goes red on a gallery drawn as marks', () => {
    const page_ = built(gallery)
    // The same photos drawn as a strip of marks, as a build that knows no gallery draws them.
    const nodes = Object.fromEntries(
      Object.entries(page_.tree.nodes as Record<string, SiteImportFidelityNode>).map(([id, node]) => [id, node.componentId === 'image' ? { ...node, props: { ...node.props, objectFit: 'contain', width: 'auto' } } : node]),
    )
    const report = siteImportFidelity(page_.source, { ...page_.tree, nodes }, { finish: 'keep', words: 'kept' })
    expect(report.galleries).toMatchObject({ source: 1, built: 0 })
    expect(siteImportFidelityHolds(report)).toBe(false)
  })
})

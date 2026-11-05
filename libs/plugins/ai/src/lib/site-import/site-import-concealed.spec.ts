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
 * What a visitor cannot see is not the page (AGL-4152). On a live import a
 * page opened on a huge grey picture its source never shows, "View fullsize"
 * sat under its pictures, its opening's columns were one stack, a block of
 * paragraphs came out as one with its heading in it, and a whole page was one
 * section. These hold the general rules, over HTML and CSS, on invented pages.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { siteImportLayoutLines, type SiteImportLayout, type SiteImportLayoutNode } from '../model/ai-site-import'
import { siteImportFidelity, siteImportFidelityHolds, siteImportFidelityTreeOf, type SiteImportFidelityNode, type SiteImportFidelitySource } from '../model/ai-site-import-fidelity'
import { siteImportReplayBuild, siteImportReplayDocumentOf } from './fixtures/site-import-fidelity-replay'
import { extractSiteImportPage, type SiteImportBlock, type SiteImportExtract } from './site-import-html'
import { siteImportLayout } from './site-import-layout'

const URL_OF_PAGE = 'https://www.larkspur-paving.example/'
const sameSite = (url: URL) => url.hostname === 'www.larkspur-paving.example'

const FIXTURES = join(__dirname, 'fixtures', 'site-layout')
const HIDDEN_PARTS = readFileSync(join(FIXTURES, 'hidden-parts.html'), 'utf8')
const HIDDEN_PARTS_CSS = readFileSync(join(FIXTURES, 'hidden-parts.css'), 'utf8')

const read = (html: string, stylesheets: readonly string[] = []): SiteImportExtract => extractSiteImportPage(html, URL_OF_PAGE, sameSite, { structure: true, stylesheets })
const page = (body: string, style = '') => `<!doctype html><html><head><title>A page</title><style>${style}</style></head><body><main>${body}</main></body></html>`
const words = (extract: SiteImportExtract) => extract.blocks.filter((block) => block.kind !== 'image').map((block) => (block as { text: string }).text)
const pictures = (extract: SiteImportExtract) => extract.blocks.flatMap((block) => (block.kind === 'image' ? [block.url.split('/').pop()] : []))
const picture = (name: string, attrs = '') => `<img src="https://www.larkspur-paving.example/media/${name}.jpg" alt="" ${attrs}>`

function layoutOf(html: string, stylesheets: readonly string[] = []): { extract: SiteImportExtract; layout: SiteImportLayout; main: SiteImportBlock[] } {
  const extract = read(html, stylesheets)
  const layout = siteImportLayout(extract as Parameters<typeof siteImportLayout>[0], stylesheets) as SiteImportLayout
  return { extract, layout, main: extract.blocks.filter((block) => block.region === 'main') }
}

describe('a picture a visitor cannot see is not a page picture', () => {
  it.each([
    ['the hidden attribute', `<div hidden>${picture('gone')}</div>`, ''],
    ['display none, on a wrapper', `<div class="off">${picture('gone')}</div>`, '.off { display: none; }'],
    ['visibility hidden, on the picture', picture('gone', 'class="off"'), '.off { visibility: hidden; }'],
    ['visibility hidden, inherited', `<div class="off"><span>${picture('gone')}</span></div>`, '.off { visibility: hidden; }'],
    ['an inline style', picture('gone', 'style="display:none"'), ''],
    ['a one-pixel tracker', picture('gone', 'width="1" height="1"'), ''],
    ['a zero box', picture('gone', 'class="off"'), '.off { width: 0; height: 0; }'],
    ['off-canvas', `<div class="off">${picture('gone')}</div>`, '.off { position: absolute; left: -9999px; }'],
    ['an off-canvas drawer', `<div class="off">${picture('gone')}</div>`, '.off { position: fixed; transform: translateX(-100%); }'],
    ['a lightbox template', `<div class="box" role="dialog" hidden>${picture('gone')}<button>Close</button></div>`, ''],
    ['an overlay template with words', `<div class="box"><h3>Sign up for the newsletter today</h3>${picture('gone')}</div>`, '.box { display: none; position: fixed; }'],
  ])('%s', (_name, body, style) => {
    const extract = read(page(`<p>Words a visitor reads.</p>${body}${picture('shown')}`, style))
    expect(pictures(extract)).toEqual(['shown.jpg'])
    expect(extract.images.map((image) => image.url.split('/').pop())).toEqual(['shown.jpg'])
  })

  it.each([
    ['a lazy picture its own rule hides until it loads', '<img data-src="https://www.larkspur-paving.example/media/stays.jpg" class="lazy" alt="">', '.lazy { visibility: hidden; }'],
    ['a lazy picture with a placeholder', '<img src="data:image/gif;base64,R0lGOD" data-src="https://www.larkspur-paving.example/media/stays.jpg" class="lazy" alt="">', '.lazy { display: none; }'],
    ['a picture waiting on its entrance', `<div class="is-invisible">${picture('stays')}</div>`, '.is-invisible { visibility: hidden; }'],
    ['a slide beside the one showing', `<div class="slides"><div class="slide on">${picture('first')}</div><div class="slide">${picture('stays')}</div></div>`, '.slide { display: none; } .slide.on { display: block; }'],
    ['a tab panel', `<div role="tabpanel" hidden>${picture('stays')}</div>`, ''],
    ['an accordion that holds words too', `<div class="fold"><p>The answer to the question, in full sentences a visitor opens.</p>${picture('stays')}</div>`, '.fold { display: none; }'],
    ['an aria-hidden picture a visitor still sees', `<div aria-hidden="true">${picture('stays')}</div>`, ''],
    ['a box that a padding draws', `<div class="ratio">${picture('stays')}</div>`, '.ratio { height: 0; padding-bottom: 56%; overflow: hidden; }'],
  ])('%s stays', (_name, body, style) => {
    expect(pictures(read(page(body, style)))).toContain('stays.jpg')
  })

  it('reads a hidden copy once, where it shows', () => {
    const extract = read(page(`<div class="phone">${picture('one')}</div><div class="desk">${picture('one')}</div><h2>Words after it</h2>`, '.phone { display: none; }'))
    expect(pictures(extract)).toEqual(['one.jpg'])
  })

  it('says what it left out, for the fidelity', () => {
    const extract = read(page(`<div hidden>${picture('gone')}</div>${picture('shown')}<p>Words<span class="sr-only"> and a label</span></p>`))
    expect(extract.concealed?.pictures.map((url) => url.split('/').pop())).toEqual(['gone.jpg'])
    expect(extract.concealed?.words).toEqual(['and a label'])
  })

  it('reads through the stylesheets it is given', () => {
    const html = page(picture('gone', 'class="fx"') + picture('shown'))
    expect(pictures(read(html))).toEqual(['gone.jpg', 'shown.jpg'])
    expect(pictures(read(html, ['.fx { visibility: hidden; }']))).toEqual(['shown.jpg'])
  })
})

describe('words only a screen reader hears are not page words', () => {
  it.each([
    ['a clip', '.quiet { position: absolute; clip: rect(0, 0, 0, 0); width: 1px; height: 1px; overflow: hidden; }', 'quiet'],
    ['a clip-path', '.quiet { position: absolute; clip-path: inset(50%); }', 'quiet'],
    ['a one-pixel box', '.quiet { position: absolute; width: 1px; height: 1px; overflow: hidden; }', 'quiet'],
    ['off-screen', '.quiet { position: absolute; left: -10000px; }', 'quiet'],
    ['a text indent', '.quiet { text-indent: -9999px; }', 'quiet'],
    ['the convention, with no sheet to say so', '', 'sr-only'],
    ['the convention, by another name', '', 'visually-hidden'],
    ['the convention, by a third', '', 'screen-reader-text'],
  ])('%s', (_name, style, name) => {
    const extract = read(page(`<h2>A heading<span class="${name}"> for a reader</span></h2><p><span class="${name}">Label only.</span></p><p>Words a visitor reads.</p>`, style))
    expect(words(extract)).toEqual(['A heading', 'Words a visitor reads.'])
  })

  it('aria-hidden words', () => {
    expect(words(read(page('<p>Shown words here.</p><p aria-hidden="true">Decoration only</p>')))).toEqual(['Shown words here.'])
  })

  it('a heading split for an animation keeps its accessible name', () => {
    const extract = read(page('<h1 aria-label="Paving done well"><span aria-hidden="true">P</span><span aria-hidden="true">aving</span></h1>'))
    expect(extract.blocks[0]).toMatchObject({ kind: 'heading', text: 'Paving done well' })
  })

  it('an aria-hidden slide beside the one showing keeps its words', () => {
    const extract = read(page('<div class="slide"><p>The first slide says this.</p></div><div class="slide" aria-hidden="true"><p>The second slide says that.</p></div>'))
    expect(words(extract)).toEqual(['The first slide says this.', 'The second slide says that.'])
  })

  it('a link around a picture has only the picture', () => {
    const extract = read(page(`<a href="/big.jpg"><span class="sr-only">View fullsize</span>${picture('thumb')}</a><button><span class="sr-only">Open image</span>${picture('other')}</button>`))
    expect(words(extract)).toEqual([])
    expect(pictures(extract)).toEqual(['thumb.jpg', 'other.jpg'])
    expect(extract.blocks.some((block) => block.kind === 'link')).toBe(false)
  })

  it('a link around an icon keeps its name: it has no other', () => {
    const extract = read(page('<a href="https://social.example/us"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg><span class="sr-only">Our profile</span></a>'))
    expect(extract.blocks).toEqual([expect.objectContaining({ kind: 'link', text: 'Our profile', href: 'https://social.example/us' })])
  })

  it('a skip link is gone', () => {
    expect(words(read(page('<a class="sr-only" href="#main">Skip to content</a><p>Words a visitor reads.</p>')))).toEqual(['Words a visitor reads.'])
  })

  it('leaves a menu as it is', () => {
    const html = `<!doctype html><html><body><nav><a href="/a"><span class="sr-only">Home of</span> Work</a><div style="display:none"><a href="/b">Hidden entry</a></div></nav><main><p>Words here.</p></main></body></html>`
    expect(read(html).navLinks.map((link) => link.text)).toEqual(['Home of Work', 'Hidden entry'])
  })

  it('leaves a footer as it is', () => {
    const html = `<!doctype html><html><body><main><p>Words here.</p></main><footer><a href="https://social.example/us"><span class="sr-only">Our profile</span></a></footer></body></html>`
    expect(words(read(html))).toContain('Our profile')
  })
})

describe('a ticker reads once', () => {
  it.each([
    ['repeated siblings', '<div><h2>Need a slab?</h2><h2>Need a slab?</h2><h2>Need a slab?</h2><h2>Need a slab?</h2></div>', ['Need a slab?']],
    ['two lines going round', '<div><span>Slabs </span><span>Patios </span><span>Slabs </span><span>Patios </span><span>Slabs </span><span>Patios </span></div>', ['Slabs Patios']],
    ['copies inside one heading', '<h2><span>Need a slab?</span> <span>Need a slab?</span> <span>Need a slab?</span></h2>', ['Need a slab?']],
    ['aria-hidden copies', '<div><span>Need a slab?</span><span aria-hidden="true">Need a slab?</span><span aria-hidden="true">Need a slab?</span></div>', ['Need a slab?']],
  ])('%s', (_name, body, expected) => {
    expect(words(read(page(body)))).toEqual(expected)
  })

  it('cards that say the same beside different pictures stay', () => {
    const body = `<div><div>${picture('a')}<p>Learn more</p></div><div>${picture('b')}<p>Learn more</p></div><div>${picture('c')}<p>Learn more</p></div></div>`
    expect(pictures(read(page(body)))).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(words(read(page(body)))).toEqual(['Learn more', 'Learn more', 'Learn more'])
  })

  it('a table that says the same in its cells stays', () => {
    const body = '<table><tr><td>Included</td><td>Included</td></tr><tr><td>Included</td><td>Included</td></tr></table>'
    expect(words(read(page(body))).length).toBeGreaterThan(0)
    expect(read(page(body)).structure?.elements.filter((element) => element.tag === 'td').length).toBe(4)
  })
})

describe('a text block keeps its heading, its paragraphs and its buttons', () => {
  const blocksOf = (body: string, style = '') => read(page(body, style)).blocks.map((block) => (block.kind === 'heading' ? `h${block.level}: ${block.text}` : block.kind === 'link' ? `link${block.inline ? ':inline' : ''}: ${block.text}` : block.kind === 'image' ? 'picture' : block.text))

  it('a line break divides paragraphs', () => {
    expect(blocksOf('<p>The first sentence stands alone.<br>The second one does too.<br><br>The third, after a gap.</p>')).toEqual(['The first sentence stands alone.', 'The second one does too.', 'The third, after a gap.'])
  })

  it('a bold first line is the block’s heading', () => {
    expect(blocksOf('<p><strong>About us</strong><br>We are a family firm.<br>We pour concrete across the county, in every season, for every kind of job.<br>Call us for a quote.</p>')).toEqual(['h2: About us', 'We are a family firm.', 'We pour concrete across the county, in every season, for every kind of job.', 'Call us for a quote.'])
  })

  it('a short block under a bold line takes a lesser heading', () => {
    expect(blocksOf('<p><b>Hours</b><br>Monday to Friday, eight to five.</p>')).toEqual(['h3: Hours', 'Monday to Friday, eight to five.'])
  })

  it('a bold word in a sentence is no heading', () => {
    expect(blocksOf('<p><strong>Note:</strong> the office is closed on Monday.<br>Call on Tuesday.</p>')).toEqual(['Note: the office is closed on Monday.', 'Call on Tuesday.'])
  })

  it('a line broken mid-sentence is still one sentence', () => {
    expect(blocksOf('<p>We build patios and<br>driveways across the county.</p>')).toEqual(['We build patios and driveways across the county.'])
  })

  it('a heading broken over two lines is one heading', () => {
    expect(blocksOf('<h1>Paving for<br>The Whole County</h1>')).toEqual(['h1: Paving for The Whole County'])
  })

  it('a list item keeps its break as a space', () => {
    expect(blocksOf('<ul><li>Slabs<br>Patios</li></ul>')).toEqual(['Slabs Patios'])
  })

  it('a line that is only a link is a button of its own; one in a sentence stays in it', () => {
    expect(blocksOf('<p>Ask us anything.<br><a href="/contact">Get in touch</a></p>')).toEqual(['Ask us anything.', 'link: Get in touch'])
    expect(blocksOf('<p>Read <a href="/about">our story</a> first.<br>Then call.</p>')).toEqual(['Read our story first.', 'link:inline: our story', 'Then call.'])
  })

  it('a span set on its own line is a line', () => {
    expect(blocksOf('<p><span class="line">The first line stands alone.</span><span class="line">The second one does too.</span></p>', '.line { display: block; }')).toEqual(['The first line stands alone.', 'The second one does too.'])
  })

  it('a line break the source writes in preserved white space is a line', () => {
    expect(blocksOf('<p style="white-space: pre-wrap">The first line stands alone.\nThe second one does too.</p>')).toEqual(['The first line stands alone.', 'The second one does too.'])
  })

  it('an sms link is a link: the same number', () => {
    expect(read(page('<div><a href="sms:5550100200">Text us</a></div>')).blocks).toEqual([expect.objectContaining({ kind: 'link', text: 'Text us', href: 'tel:5550100200' })])
    expect(read(page('<div><a href="sms:+15550100200?&body=Hello">Text us</a></div>')).blocks).toEqual([expect.objectContaining({ kind: 'link', href: 'tel:+15550100200' })])
  })
})

describe('a page laid on one placed grid', () => {
  const { extract, layout, main } = layoutOf(HIDDEN_PARTS, [HIDDEN_PARTS_CSS])
  const said = (ref: number) => {
    const block = main[ref]
    return block?.kind === 'image' ? `picture ${block.url.split('/').pop()}` : (block as { text?: string } | undefined)?.text
  }
  const linesOf = (nodes: readonly SiteImportLayoutNode[]) => siteImportLayoutLines(nodes).map(said)

  it('opens on what a visitor sees, and has no label in its words', () => {
    const firstPicture = main.find((block) => block.kind === 'image')
    expect(firstPicture).toMatchObject({ url: expect.stringContaining('pour.jpg') })
    expect(extract.images.map((image) => image.url.split('/').pop())).toEqual(['logo.png', 'pour.jpg', 'slab.jpg'])
    expect(words(extract).join(' ')).not.toMatch(/fullsize/i)
    expect(extract.concealed?.pictures).toEqual([expect.stringContaining('grey-texture.jpg')])
    expect(extract.concealed?.words).toEqual(['View fullsize'])
  })

  it('reads its opening in the columns the source sets: words left, picture right', () => {
    const hero = layout.sections[0]
    expect(hero?.hero?.picture).toBe('beside')
    const row = hero?.nodes.find((node) => node.kind === 'row')
    expect(row).toBeDefined()
    if (row?.kind !== 'row') return
    expect(row.cols).toEqual([1, 1])
    expect(linesOf(row.cells[0]?.nodes ?? [])).toEqual(['Paving contractor for the whole county', 'Request a quote', 'Call us', 'We pour driveways and patios for homeowners and builders across the county.'])
    expect(linesOf(row.cells[1]?.nodes ?? [])).toEqual(['picture pour.jpg'])
  })

  it('draws no drawing of a plain box as an icon', () => {
    expect(layout.icons).toEqual([])
  })

  it('cuts its sections where the grid draws them', () => {
    expect(layout.sections.map((section) => section.name)).toEqual(['Paving contractor for the whole county', 'What we pour', 'About Larkspur Paving', 'Need a slab?', 'From our customers'])
  })

  it('reads the box drawn behind the opening as its band, by the words on it', () => {
    expect(layout.sections.map((section) => section.band)).toEqual(['dark', 'soft', 'soft', 'soft', 'plain'])
  })

  it('keeps a stray button with the block it stands over', () => {
    const about = layout.sections[2]
    expect(linesOf(about?.nodes ?? [])[0]).toBe('Text us')
    expect(about?.nodes[0]).toMatchObject({ kind: 'line', button: 'primary' })
    expect(linesOf(about?.nodes ?? []).slice(1)).toEqual([
      'About Larkspur Paving',
      'Larkspur is a family firm.',
      'We came up laying forms for other crews, and that taught us how a job actually gets done: schedule, crew, inspections, and a finish that holds up for years.',
      'We take on driveways, patios and larger pours across the whole county, and we handle the permits ourselves.',
      'Show up. Pour it right. Stand behind it.',
    ])
  })

  it('reads its ticker once', () => {
    expect(words(extract).filter((line) => line === 'Need a slab?')).toHaveLength(1)
    expect(linesOf(layout.sections[3]?.nodes ?? [])).toEqual(['Need a slab?'])
  })

  it('a box with a fill it can read is that fill’s band', () => {
    const html = page(
      '<div class="grid"><div class="box"></div><div class="a"><h1>The opening of a page</h1></div><div class="b"><h2>The next part of a page</h2></div></div>',
      '.grid { display: grid; grid-template-columns: repeat(10, 1fr); } .box { grid-area: 1 / 1 / 5 / 11; background-color: #14202b; } .a { grid-area: 2 / 2 / 4 / 10; } .b { grid-area: 6 / 2 / 8 / 10; }',
    )
    const { layout: drawn } = layoutOf(html)
    expect(drawn.sections.map((section) => [section.band, section.background])).toEqual([
      ['dark', '#14202b'],
      ['plain', null],
    ])
  })

  it('a block centered over two columns joins neither', () => {
    const html = page(
      '<div class="grid"><div class="p">' + picture('left') + '</div><div class="q"><a class="button" href="/one">First way</a></div><div class="c"><a class="button" href="/two">Second way</a></div></div>',
      '.grid { display: grid; grid-template-columns: repeat(20, 1fr); } .p { grid-area: 1 / 1 / 6 / 11; } .q { grid-area: 1 / 11 / 6 / 16; } .c { grid-area: 7 / 7 / 9 / 15; }',
    )
    const { layout: drawn, main: lines } = layoutOf(html)
    const order = siteImportLayoutLines(drawn.sections.flatMap((section) => section.nodes)).map((ref) => (lines[ref] as { text?: string }).text ?? 'picture')
    expect(order).toEqual(['picture', 'First way', 'Second way'])
  })
})

describe('the fidelity holds a build to what a visitor sees', () => {
  const { extract, layout, main } = layoutOf(HIDDEN_PARTS, [HIDDEN_PARTS_CSS])
  const hiddenUrl = extract.concealed?.pictures[0] as string
  const source: SiteImportFidelitySource = {
    layout,
    blocks: main,
    photos: [{ from: hiddenUrl, src: 'media:host/m-hidden' }, ...main.flatMap((block, at) => (block.kind === 'image' ? [{ from: block.url, src: `media:host/m${at}` }] : []))],
    ...(extract.concealed ? { concealed: extract.concealed } : {}),
  }
  const tree = (extra: Record<string, SiteImportFidelityNode>) =>
    siteImportFidelityTreeOf({
      '_@_': { nodes: ['s0'] },
      s0: { componentId: 'muiBox', props: {}, nodes: Object.keys(extra) },
      ...extra,
    })
  const at = (id: string, props: Record<string, unknown>, componentId: string): Record<string, SiteImportFidelityNode> => ({ [id]: { componentId, props } })

  it('is whole on a build that draws none of it', () => {
    expect(siteImportFidelity(source, tree({})).concealed).toEqual({ source: 0, built: 0, ratio: 1 })
  })

  it('goes red on a hidden picture leading the page', () => {
    const report = siteImportFidelity(source, tree(at('p', { src: 'media:host/m-hidden' }, 'image')))
    expect(report.concealed).toEqual({ source: 0, built: 1, ratio: 0 })
    expect(report.score).toBe(0)
    expect(siteImportFidelityHolds(report)).toBe(false)
  })

  it('goes red on a stray label', () => {
    const report = siteImportFidelity(source, tree(at('t', { children: 'View fullsize' }, 'muiTypography')))
    expect(report.concealed?.built).toBe(1)
    expect(report.score).toBe(0)
    expect(siteImportFidelityHolds(report, 0)).toBe(false)
  })

  it('stays quiet on a read that says of none', () => {
    expect(siteImportFidelity({ layout, blocks: main }, tree({})).concealed).toBeUndefined()
  })
})

describe('a page laid on one placed grid, built', () => {
  const read = siteImportReplayDocumentOf(HIDDEN_PARTS, URL_OF_PAGE, sameSite, [HIDDEN_PARTS_CSS])

  it.each(['keep', 'improve'] as const)('holds the bar as %s, with its opening side by side and nothing hidden drawn', (finish) => {
    const built = siteImportReplayBuild(read, '/', true, { finish, words: 'kept' })
    expect(built.violations).toEqual([])
    const report = siteImportFidelity(built.source, built.tree, { finish, words: 'kept' })
    expect(report.sections).toMatchObject({ source: 5, built: 5 })
    expect(report.rows.built).toBe(report.rows.source)
    expect(report.rows.source).toBeGreaterThanOrEqual(1)
    expect(report.pictures).toMatchObject({ source: 2, built: 2 })
    expect(report.words.missing).toBe(0)
    expect(report.words.extra).toBe(0)
  })

  it('takes the fidelity the read says of what it left out', () => {
    expect(read.blocks.some((block) => block.kind !== 'image' && /fullsize/i.test(block.text))).toBe(false)
    expect(siteImportReplayBuild(read, '/', true).source.concealed?.words).toEqual(['View fullsize'])
  })
})

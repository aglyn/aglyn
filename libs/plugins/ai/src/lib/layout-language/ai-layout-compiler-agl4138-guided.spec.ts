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

import { createHash } from 'node:crypto'
import { aiCompileLayoutPage, type AiLayoutPagePlan } from './ai-layout-compiler'
import type { AiLayoutBlock, AiLayoutItem, AiLayoutSection } from './ai-layout-language'
import type { AiLayoutTargets } from './ai-layout-links'

/**
 * A guided start's page is drawn exactly as it was before Bring my site
 * learned its sources' framing (AGL-4138). A page brought in now keeps its
 * pictures at their own shape, a pill eyebrow, its eyebrows' color, its large
 * statements, its cards' tiles, arrows, alignment and tablet columns, and its
 * steps' rule; each of those is read only on a verbatim page. A guided page,
 * whose answer can set an eyebrow's or a lede's style, never reaches them: its
 * compile is pinned here by a digest taken before the change, across kinds and
 * seeds, and is the same whether or not its blocks carry the import's fields.
 */

const TARGETS: AiLayoutTargets = {
  pageId: 'pg-home',
  pages: [
    { id: 'pg-home', label: 'Home', slug: '/' },
    { id: 'pg-services', label: 'Services', slug: '/services' },
    { id: 'pg-contact', label: 'Contact', slug: '/contact' },
  ],
  homeIds: ['pg-home'],
  forms: [{ id: 'form-contact', name: 'Contact form' }],
  formPageId: 'pg-contact',
  components: [],
  facts: 'A bakery in Portland. Call 503-555-0144.',
}

const items = (count: number, extra: Partial<AiLayoutItem> = {}): AiLayoutItem[] =>
  Array.from({ length: count }, (_, at) => ({ title: `Loaf number ${at + 1}`, text: `A slow loaf baked every morning, shape ${at + 1}.`, icon: 'star', ...extra }))

/** Every block a guided answer may write, the styles it may set on an eyebrow and a lede among them. */
function sections(withImportFields: boolean): AiLayoutSection[] {
  const imported = <T extends object>(value: T, fields: object): T => (withImportFields ? { ...value, ...fields } : value)
  const picture = { src: 'media:host/p1', alt: 'A loaf on a board', ratio: 1.5 }
  return [
    {
      band: 'plain',
      blocks: [
        imported<AiLayoutBlock>({ kind: 'eyebrow', text: 'FRESH EVERY MORNING', style: 'secondary' }, { chip: true, color: 'tertiary.main' }),
        { kind: 'heading', text: 'Bread worth the early alarm', style: 'large' },
        imported<AiLayoutBlock>({ kind: 'lede', text: 'Sourdough, rye and seeded loaves, baked before the sun is up and gone by noon.', style: 'large' }, {}),
        { kind: 'button', text: 'See the menu', to: 'page:pg-services' },
        imported<AiLayoutBlock>({ kind: 'image', text: 'A loaf on a board' }, { picture: { ...picture, fit: { ratio: '3 / 2', rounded: true, shadow: true } } }),
      ],
    },
    {
      band: 'soft',
      align: 'center',
      blocks: [
        imported<AiLayoutBlock>({ kind: 'eyebrow', text: 'WHAT WE BAKE' }, { color: 'text.secondary' }),
        { kind: 'heading', text: 'Three loaves, every day' },
        imported<AiLayoutBlock>({ kind: 'cards', items: items(3) }, { itemsAlign: 'start', columnsSm: 2 }),
      ],
    },
    {
      band: 'plain',
      blocks: [
        { kind: 'heading', text: 'How an order works' },
        imported<AiLayoutBlock>({ kind: 'steps', items: items(3, { figure: '01' }) }, { rule: { side: 'top', width: 3, color: 'primary.main' } }),
      ],
    },
    {
      band: 'plain',
      blocks: [
        { kind: 'heading', text: 'Why people come back' },
        imported<AiLayoutBlock>(
          { kind: 'cards', items: items(4).map((item) => (withImportFields ? { ...item, tile: { fill: 'action.hover', color: 'text.primary' }, markPath: 'M5 17.59 15.59 7H9V5h10v10h-2V8.41L6.41 19z', figureMuted: true } : item)) },
          {},
        ),
        { kind: 'stats', items: [{ title: '12', text: 'loaves an hour' }, { title: '4am', text: 'ovens on' }, { title: '30', text: 'years baking' }] },
        { kind: 'quotes', items: [{ title: 'The best rye in town.', text: 'A neighbor' }] },
      ],
    },
    {
      band: 'dark',
      align: 'center',
      blocks: [
        { kind: 'heading', text: 'Questions' },
        { kind: 'faq', items: [{ title: 'Do you deliver?', text: 'Within ten miles, on Saturdays.' }, { title: 'Can I order ahead?', text: 'Yes, until 6pm the day before.' }] },
        { kind: 'list', items: [{ title: 'Open daily from 7', text: '' }, { title: 'Closed on Mondays', text: '' }] },
        { kind: 'note', text: 'Prices change with the season.' },
        { kind: 'button', text: 'Get in touch', to: 'page:pg-contact', style: 'secondary' },
      ],
    },
  ]
}

const PLAN: AiLayoutPagePlan = {
  title: 'Home',
  sections: [
    { name: 'Hero', uses: [], items: 0 },
    { name: 'Loaves', uses: [], items: 3 },
    { name: 'How it works', uses: [], items: 3 },
    { name: 'Why us', uses: [], items: 4 },
    { name: 'Questions', uses: [], items: 2 },
  ],
}

const KINDS = ['business', 'restaurant', 'portfolio', 'trades', 'wellness'] as const
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]

/** Every kind and seed's compile of the page, guided (not verbatim), as one string. */
function compiledAll(withImportFields: boolean): string {
  const out: unknown[] = []
  for (const kind of KINDS) {
    for (const seed of SEEDS) {
      for (const reusableComponents of [false, true]) {
        const compiled = aiCompileLayoutPage(sections(withImportFields), PLAN, TARGETS, {
          reusableComponents,
          sectionIds: PLAN.sections.map((_, at) => `sec-${at + 1}`),
          design: { kind, seed, home: seed % 2 === 1 },
        })
        out.push(compiled.tree, compiled.settled)
      }
    }
  }
  return JSON.stringify(out)
}

describe("a guided start's page is drawn as before (AGL-4138)", () => {
  it('compiles to the digest taken before the import learned its sources’ framing', () => {
    const digest = createHash('sha256').update(compiledAll(false)).digest('hex')
    // Retaken once (AGL-4152) for one prop and nothing else: a filled button over a cover photo or on a dark band
    // goes back to the visitor's scheme. Without it the compile hashes to the digest taken before (0ee9fc9f…).
    expect(digest).toBe('8e0cb95f30c4d233b9b878b002a80ca5f4822fc55deb1395e861ea2436c1257d')
    const without = compiledAll(false).split(',"colorScheme":"visitor"').join('')
    expect(createHash('sha256').update(without).digest('hex')).toBe('0ee9fc9f37f35e7e32884ab7e3f0a5a1c21699edbb34123018423e7f2a22fc7e')
  })

  it("reads none of the import's fields: a page that carries them compiles the same", () => {
    expect(compiledAll(true)).toBe(compiledAll(false))
  })
})

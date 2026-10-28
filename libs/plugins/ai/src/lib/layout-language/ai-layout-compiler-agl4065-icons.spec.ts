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
  BERM_AND_BOLT_AREAS,
  BLUEBONNET_AREAS,
  BLUEBONNET_FACTS,
  HOLESHOT_TRUST,
  TWO_OAKS_TOWNS,
  TWO_OAKS_TRUST,
} from '../jobs/fixtures/ai-site-agl4065-plans'
import { AI_ICON_LIBRARY, AI_ICON_WORDS, aiIconOfId, aiIconOfWord } from '../runtime/ai-icon-library'
import { aiCompileLayoutPage, type AiLayoutPagePlan } from './ai-layout-compiler'
import { aiLayoutDesignChoices } from './ai-layout-design'
import type { AiLayoutItem, AiLayoutSection } from './ai-layout-language'
import type { AiLayoutTargets } from './ai-layout-links'
import { aiStorefrontItemIcons } from './ai-layout-storefront'

/**
 * A row's icons follow what its items mean (AGL-4065). The booth-kit sites
 * of 2026-10-25 drew their "Areas we serve" rows with a map marker for the
 * first town and a star, a heart, a sparkle and a lightning bolt for the
 * rest: a town's name matched no icon word, and a rule that no reason to buy
 * repeats an icon gave each town the next of a list of random ones. A row of
 * places now shows one place icon for every place; a reason's own words pick
 * its icon ("On time" a clock, "English and Spanish" the translate mark);
 * and a reason whose words name nothing takes one neutral icon, the same
 * along its row — never a heart or a sparkle on a trades or business site.
 */

const known = (word: string | undefined) => !!aiIconOfWord(word)
const HEART = AI_ICON_LIBRARY.heart.id
const SPARKLE = AI_ICON_LIBRARY.sparkle.id

const TARGETS: AiLayoutTargets = {
  pageId: 'pg-home',
  pages: [
    { id: 'pg-home', label: 'Home', slug: '/' },
    { id: 'pg-contact', label: 'Contact', slug: '/contact' },
  ],
  homeIds: ['pg-home'],
  forms: [],
  components: [],
  facts: BLUEBONNET_FACTS,
}

/** A short page whose second section is the row: a hero first, a closing call to action after. */
function page(name: string, rowItems: readonly AiLayoutItem[]): { sections: AiLayoutSection[]; plan: AiLayoutPagePlan } {
  return {
    sections: [
      { band: 'plain', blocks: [{ kind: 'heading', text: 'Yards that thrive in Texas heat', style: 'large' }, { kind: 'lede', text: 'Tidy, water-wise yards for busy homeowners.' }] },
      { band: 'plain', blocks: [{ kind: 'heading', text: name }, { kind: 'cards', items: [...rowItems] }] },
      { band: 'brand', align: 'center', blocks: [{ kind: 'heading', text: 'Ask for a free estimate' }, { kind: 'button', text: 'Get in touch', to: 'page:pg-contact' }] },
    ],
    plan: {
      title: 'Home',
      sections: [
        { name: 'Hero', uses: [], items: 0 },
        { name, uses: [], items: rowItems.length },
        { name: 'Call to action', uses: [], items: 0 },
      ],
    },
  }
}

/** The first seed that draws a kind's groups as icon columns. */
function iconSeed(kind: string): number {
  for (let seed = 1; seed < 2000; seed += 1) if (aiLayoutDesignChoices({ kind, seed, home: true }).group === 'icons') return seed
  throw new Error(`no seed draws ${kind} with icon columns`)
}

/** The icons the row's section draws, in order, compiled as a site of the kind would be. */
function rowIcons(kind: string, name: string, rowItems: readonly AiLayoutItem[], paid: boolean, seed = iconSeed(kind)): string[] {
  const { sections, plan } = page(name, rowItems)
  const compiled = aiCompileLayoutPage(sections, plan, TARGETS, {
    reusableComponents: paid,
    sectionIds: ['s1', 's2', 's3'],
    design: { kind, seed, home: true },
  })
  const nodes = compiled.tree.nodes
  const out: string[] = []
  const walk = (id: string) => {
    const node = nodes[id]
    if (!node) return
    if (node.componentId === 'icon') out.push(String(node.props?.['iconId']))
    for (const child of node.nodes ?? []) walk(child)
  }
  walk('s2')
  return out
}

describe('a row of places shows one place icon for every place (AGL-4065)', () => {
  it('gives every town of the Two Oaks "Towns we serve" the location icon', () => {
    expect(aiStorefrontItemIcons(TWO_OAKS_TOWNS, known, { section: 'Towns we serve', kind: 'trades' })).toEqual(TWO_OAKS_TOWNS.map(() => 'location'))
  })

  it('gives every town of the Berm & Bolt "Areas we serve" the location icon, the drive to Austin too', () => {
    expect(aiStorefrontItemIcons(BERM_AND_BOLT_AREAS, known, { section: 'Areas we serve', kind: 'store' })).toEqual(BERM_AND_BOLT_AREAS.map(() => 'location'))
  })

  it.each([
    ['business', 'Areas we serve', BLUEBONNET_AREAS],
    ['store', 'Areas we serve', BERM_AND_BOLT_AREAS],
    ['trades', 'Towns we serve', TWO_OAKS_TOWNS],
  ] as const)('draws a %s site’s "%s" row with the map marker for every town, free or paid', (kind, name, towns) => {
    for (const paid of [false, true]) {
      expect(rowIcons(kind, name, towns, paid)).toEqual(towns.map(() => AI_ICON_LIBRARY.location.id))
    }
  })

  it('reads a section about practice areas or focus areas as no row of places', () => {
    const areas = [
      { title: 'Family law', text: 'Divorce, custody and support.' },
      { title: 'Estate planning', text: 'Wills and trusts.' },
    ]
    expect(aiStorefrontItemIcons(areas, known, { section: 'Practice areas', kind: 'professional' })).not.toEqual(['location', 'location'])
  })
})

describe('a reason’s icon is the one its words mean (AGL-4065)', () => {
  const iconOf = (rows: readonly AiLayoutItem[], title: string, kind: string, section: string) =>
    aiStorefrontItemIcons(rows, known, { section, kind })[rows.findIndex((item) => item.title === title)]

  it('gives "On time" a clock and "English and Spanish" the translate mark (Two Oaks)', () => {
    expect(iconOf(TWO_OAKS_TRUST, 'On time', 'trades', 'Why homeowners and landlords trust us')).toBe('clock')
    expect(iconOf(TWO_OAKS_TRUST, 'English and Spanish', 'trades', 'Why homeowners and landlords trust us')).toBe('translate')
    // The library draws it: one of the compiler's own icons, read back by its id.
    expect(aiIconOfWord('translate')?.id).toBe('translate')
    expect(aiIconOfId('translate')).toBe(aiIconOfWord('translate'))
    // …and never a word the cached page prompt lists for the model, so no prompt changed.
    expect(AI_ICON_WORDS).not.toContain('translate')
  })

  it('gives "Straight answers" the chat mark and "English and Spanish" the translate mark (Holeshot)', () => {
    expect(iconOf(HOLESHOT_TRUST, 'Straight answers', 'trades', 'Why riders and racing parents trust the shop')).toBe('chat')
    expect(iconOf(HOLESHOT_TRUST, 'English and Spanish', 'trades', 'Why riders and racing parents trust the shop')).toBe('translate')
  })

  it('reads a reason by its title before its words: "One call, many trades" is the work, not the phone', () => {
    expect(iconOf(TWO_OAKS_TRUST, 'One call, many trades', 'trades', 'Why homeowners and landlords trust us')).toBe('tools')
  })

  it('keeps an icon the design named for an item', () => {
    expect(aiStorefrontItemIcons([{ title: 'On time', text: '', icon: 'calendar' }], known, { section: 'Why us', kind: 'trades' })).toEqual(['calendar'])
  })
})

describe('a reason whose words name nothing takes one neutral icon (AGL-4065)', () => {
  const plain = [
    { title: 'Open since 2014', text: 'Years of work on dirt bikes and street bikes.' },
    { title: 'Homeowners and HOAs', text: 'Single yards and shared grounds alike.' },
    { title: 'A crew you know', text: 'The same faces every visit.' },
  ]

  it('repeats the check along a trades, business or professional row, never a mix of random marks', () => {
    for (const kind of ['trades', 'business', 'professional']) {
      const icons = aiStorefrontItemIcons(plain, known, { section: 'Why choose us', kind })
      expect([kind, new Set(icons)]).toEqual([kind, new Set(['check'])])
    }
  })

  it('takes the sparkle only on a calm or celebratory site', () => {
    for (const kind of ['yoga', 'wellness', 'beauty', 'events']) {
      expect([kind, new Set(aiStorefrontItemIcons(plain, known, { section: 'Why choose us', kind }))]).toEqual([kind, new Set(['sparkle'])])
    }
  })

  it('draws no heart and no sparkle on any trades or business row of the booth kit', () => {
    const rows: Array<[string, readonly AiLayoutItem[]]> = [
      ['Why homeowners and landlords trust us', TWO_OAKS_TRUST],
      ['Why riders and racing parents trust the shop', HOLESHOT_TRUST],
      ['Towns we serve', TWO_OAKS_TOWNS],
      ['Areas we serve', BLUEBONNET_AREAS],
      ['Why choose us', plain],
    ]
    for (const kind of ['trades', 'business']) {
      for (const [name, row] of rows) {
        const words = aiStorefrontItemIcons(row, known, { section: name, kind })
        expect([kind, name, words.filter((word) => word === 'heart' || word === 'sparkle')]).toEqual([kind, name, []])
        for (const paid of [false, true]) {
          const drawn = rowIcons(kind, name, row, paid)
          expect([kind, name, drawn.filter((id) => id === HEART || id === SPARKLE)]).toEqual([kind, name, []])
        }
      }
    }
  })
})

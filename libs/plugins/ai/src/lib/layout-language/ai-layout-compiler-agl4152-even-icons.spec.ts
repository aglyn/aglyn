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

import { aiIconOfWord } from '../runtime/ai-icon-library'
import { aiCompileLayoutPage, type AiLayoutPagePlan } from './ai-layout-compiler'
import type { AiLayoutItem, AiLayoutSection } from './ai-layout-language'
import type { AiLayoutTargets } from './ai-layout-links'

/**
 * A row's icons are every card's or none (AGL-4152). A contractor's
 * redesigned services row drew icons on two cards of three: the third named
 * a word the icon library does not have, and drew nothing in its place.
 */

const UNKNOWN = 'concrete-slab-pour'

const TARGETS: AiLayoutTargets = {
  pageId: 'pg-home',
  pages: [
    { id: 'pg-home', label: 'Home', slug: '/' },
    { id: 'pg-contact', label: 'Contact', slug: '/contact' },
  ],
  homeIds: ['pg-home'],
  forms: [],
  components: [],
  facts: 'Northfield Paving, concrete contractor.',
}

const services = (icons: ReadonlyArray<string | undefined>): AiLayoutItem[] =>
  [
    { title: 'Commercial slabs', text: 'Warehouse floors and building pads poured to spec.' },
    { title: 'Parking lots', text: 'Layout, grading, pour and finish, built for traffic.' },
    { title: 'Patios and driveways', text: 'Stamped and colored concrete for the backyard.' },
  ].map((item, at) => ({ ...item, ...(icons[at] ? { icon: icons[at] } : {}) }))

/** The icon ids the row's section draws, compiled as a written page or as a page brought in. */
function rowIcons(items: readonly AiLayoutItem[], verbatim: boolean): string[] {
  const sections: AiLayoutSection[] = [
    { band: 'plain', blocks: [{ kind: 'heading', text: 'Concrete done right', style: 'large' }, { kind: 'lede', text: 'Flatwork and foundations.' }] },
    { band: 'plain', blocks: [{ kind: 'heading', text: 'Concrete services' }, { kind: 'cards', items: [...items] }] },
  ]
  const plan: AiLayoutPagePlan = {
    title: 'Home',
    sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Concrete services', uses: [], items: items.length },
    ],
  }
  const compiled = aiCompileLayoutPage(sections, plan, TARGETS, { reusableComponents: false, sectionIds: ['s1', 's2'], ...(verbatim ? { verbatim: true } : {}) })
  const nodes = compiled.tree.nodes
  const out: string[] = []
  const walk = (id: string) => {
    const node = nodes[id]
    if (!node) return
    if (node.componentId === 'icon') out.push(String(node.props?.['iconId'] ?? node.props?.['iconPath'] ?? ''))
    for (const child of node.nodes ?? []) walk(child)
  }
  walk('s2')
  return out
}

describe('a row of cards draws an icon on every card or on none (AGL-4152)', () => {
  it('names a word the library does not have, for the spec to mean anything', () => {
    expect(aiIconOfWord(UNKNOWN)).toBeNull()
    expect(aiIconOfWord('truck')).not.toBeNull()
    expect(aiIconOfWord('home')).not.toBeNull()
  })

  it.each([false, true])('gives the card whose word names no icon one of its own (brought in: %s)', (verbatim) => {
    const icons = rowIcons(services([UNKNOWN, 'truck', 'home']), verbatim)
    expect(icons).toHaveLength(3)
    expect(icons.every(Boolean)).toBe(true)
    expect(icons.slice(1)).toEqual([aiIconOfWord('truck')?.id, aiIconOfWord('home')?.id])
  })

  it.each([false, true])('draws none where fewer than half the cards name one (brought in: %s)', (verbatim) => {
    expect(rowIcons(services(['truck', undefined, undefined]), verbatim)).toEqual([])
  })

  it.each([false, true])('leaves a row that is already even as it was (brought in: %s)', (verbatim) => {
    expect(rowIcons(services(['truck', 'home', 'calendar']), verbatim)).toHaveLength(3)
    expect(rowIcons(services([undefined, undefined, undefined]), verbatim)).toEqual([])
  })
})

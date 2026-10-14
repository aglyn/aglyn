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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import { validateAiDoctrineTree } from '../runtime/ai-doctrine-validators'
import { aiCompileLayoutPage, type AiLayoutPagePlan } from './ai-layout-compiler'
import { aiLayoutDesignChoices, aiLayoutGroupVariant, type AiLayoutDesign } from './ai-layout-design'
import type { AiLayoutSection } from './ai-layout-language'
import type { AiLayoutTargets } from './ai-layout-links'
import { aiLayoutPictureSlots } from './ai-layout-pictures'
import { aiLayoutStoredTree } from './ai-layout-store'
import { aiCompileLayoutFrame } from './ai-layout-frame'

/**
 * The designer layer (AGL-3660): the same model answer drawn as a designer
 * site — a photo hero, pictures beside words, work as pictures, writing as
 * articles, dishes as a menu — chosen per kind and seed, every page still
 * one the doctrine admits as it is.
 */

const TARGETS: AiLayoutTargets = {
  pageId: 'pg-home',
  pages: [
    { id: 'pg-home', label: 'Home', slug: '/' },
    { id: 'pg-contact', label: 'Contact', slug: '/contact' },
  ],
  homeIds: ['pg-home'],
  forms: [{ id: 'form-contact', name: 'Contact form' }],
  formPageId: 'pg-contact',
  components: [],
  facts: 'A small studio.',
}

const items = (count: number, noun: string) =>
  Array.from({ length: count }, (_, index) => ({ title: `${noun} number ${index + 1}`, text: `A short line about ${noun} ${index + 1}.` }))

/** A home page as models write one: a words-only hero, a group, a story, a closing call to action. */
function page(groupHeading: string, groupItems: number): { sections: AiLayoutSection[]; plan: AiLayoutPagePlan } {
  const sections: AiLayoutSection[] = [
    {
      band: 'plain',
      align: 'center',
      blocks: [
        { kind: 'eyebrow', text: 'A quiet place' },
        { kind: 'heading', text: 'Your first visit, without the nerves', style: 'large' },
        { kind: 'lede', text: 'Come as you are and go at your own pace.' },
        { kind: 'button', text: 'Get in touch', to: 'page:pg-contact' },
      ],
    },
    { band: 'soft', blocks: [{ kind: 'heading', text: groupHeading }, { kind: 'cards', items: items(groupItems, 'piece') }] },
    {
      band: 'plain',
      blocks: [
        { kind: 'heading', text: 'About the studio' },
        { kind: 'text', text: 'One person runs the studio and answers every message personally.' },
      ],
    },
    {
      band: 'brand',
      align: 'center',
      blocks: [
        { kind: 'heading', text: 'Have a question?' },
        { kind: 'lede', text: 'Write and we will answer within a day.' },
        { kind: 'button', text: 'Get in touch', to: 'page:pg-contact' },
      ],
    },
  ]
  return {
    sections,
    plan: {
      title: 'Home',
      sections: [
        { name: 'Hero', uses: [], items: 0 },
        { name: groupHeading, uses: [], items: groupItems },
        { name: 'About', uses: [], items: 0 },
        { name: 'Closing call to action', uses: [], items: 0 },
      ],
    },
  }
}

function build(sections: AiLayoutSection[], plan: AiLayoutPagePlan, design?: AiLayoutDesign, paid = false) {
  const sectionIds = plan.sections.map((_, index) => `sec-${index + 1}`)
  const context = {
    screenIds: TARGETS.pages.map((entry) => entry.id),
    formIds: ['form-contact'],
    homeScreenIds: ['pg-home'],
    pageSections: plan.sections.map((section) => section.name),
    scrollTargetIds: sectionIds,
    ...(paid ? {} : { reusableComponents: false }),
    // As the language page check reads it (AGL-3660).
    repeatsCompiled: true,
    codeBuilt: true,
  }
  const compiled = aiCompileLayoutPage(sections, plan, TARGETS, { reusableComponents: paid, sectionIds, ...(design ? { design } : {}) })
  const stored = aiLayoutStoredTree(compiled.tree, 'screen', context, sectionIds)
  if (stored.ok === false) throw new Error(stored.error)
  const report = validateAiDoctrineTree({ rootId: CANVAS_ROOT_ELEMENT_ID, nodes: stored.nodes }, 'page', context)
  const slots = aiLayoutPictureSlots(stored.nodes, CANVAS_ROOT_ELEMENT_ID, { ids: sectionIds, names: plan.sections.map((section) => section.name) })
  return { compiled, stored, report, slots }
}

describe('a site design (AGL-3660)', () => {
  it('is the same for every page of one site, and differs between sites of one kind', () => {
    const one = aiLayoutDesignChoices({ kind: 'yoga', seed: 42, home: true })
    expect(aiLayoutDesignChoices({ kind: 'yoga', seed: 42, home: false })).toEqual(one)
    const heroes = new Set(Array.from({ length: 40 }, (_, seed) => aiLayoutDesignChoices({ kind: 'yoga', seed, home: true }).hero))
    expect([...heroes].sort()).toEqual(['cover', 'split'])
  })

  it('opens every kind with one of the heroes that kind suits', () => {
    for (const kind of AI_SITE_KINDS) {
      for (let seed = 0; seed < 20; seed += 1) {
        expect(['cover', 'split', 'editorial']).toContain(aiLayoutDesignChoices({ kind: kind.id, seed, home: true }).hero)
      }
    }
    for (let seed = 0; seed < 20; seed += 1) {
      expect(['cover', 'editorial']).toContain(aiLayoutDesignChoices({ kind: 'photography', seed, home: true }).hero)
    }
  })

  it('draws work as pictures, writing as articles and dishes as a menu, by the kind and the words', () => {
    const at = (kind: string, words: string) => {
      const design = { kind, seed: 7, home: true }
      return aiLayoutGroupVariant(design, aiLayoutDesignChoices(design), words)
    }
    expect(at('portfolio', 'Selected work')).toBe('pictures')
    expect(at('blog', 'Featured writing')).toBe('articles')
    expect(at('restaurant', 'Menu highlights')).toBe('menu')
    // A store's products are its Product grid's (AGL-3676): only how its range is grouped is drawn as pictures.
    expect(at('store', 'Shop by collection')).toBe('pictures')
    expect(at('store', 'Gift sets')).toBe('pictures')
    // A store's reasons to buy are icon-led columns, never a band of text alone (AGL-3676).
    expect(at('store', 'Candle care and burn notes')).toBe('icons')
    expect(['cards', 'ruled']).toContain(at('blog', 'What you will find'))
    expect(['cards', 'ruled']).toContain(at('professional', 'Practice areas'))
  })

  it('leaves a page compiled with no design exactly as before', () => {
    const { sections, plan } = page('Selected work', 3)
    const { slots, compiled } = build(sections, plan)
    expect(slots).toEqual([])
    expect(compiled.settled.some((entry) => /hero|picture/.test(entry.what))).toBe(false)
  })

  it.each(AI_SITE_KINDS.map((kind) => kind.id))('gives a %s home a photo hero, and admits every page it draws', (kind) => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const [heading, count] of [
        ['Selected work', 6],
        ['Featured writing', 3],
        ['Menu highlights', 4],
        ['Why people come', 3],
      ] as const) {
        const { sections, plan } = page(heading, count)
        const { report, stored, slots } = build(sections, plan, { kind, seed: seed * 977, home: seed % 2 === 1 })
        expect(stored.repairs).toEqual([])
        expect(report.violations.map((violation) => `${violation.code}: ${violation.message}`)).toEqual([])
        // The hero is a picture slot, a stand-in the owner never described: decorative.
        const hero = slots.find((slot) => slot.sectionIndex === 0)
        expect(hero).toBeDefined()
        expect((stored.nodes as unknown as Record<string, { props?: Record<string, unknown> }>)[hero?.imageId as string].props?.['decorative']).toBe(true)
      }
    }
  })

  it('shows a portfolio’s work as a picture each, under the page’s picture ceiling', () => {
    const { sections, plan } = page('Selected work', 6)
    const { slots, report } = build(sections, plan, { kind: 'portfolio', seed: 3, home: true })
    expect(report.violations).toEqual([])
    expect(slots.filter((slot) => slot.sectionIndex === 1)).toHaveLength(6)
    expect(slots.length).toBeLessThanOrEqual(8)
  })

  it('keeps the model’s own picture in the hero, with its words as the alt text', () => {
    const { sections, plan } = page('Why people come', 3)
    sections[0] = { ...sections[0], cols: [7, 5], blocks: [...sections[0].blocks.map((block) => ({ ...block, col: 0 })), { kind: 'image', col: 1, text: 'A sunlit studio with mats on a wooden floor' }] }
    const { slots, stored } = build(sections, plan, { kind: 'yoga', seed: 5, home: true })
    const hero = slots.find((slot) => slot.sectionIndex === 0)
    expect(hero?.alt).toBe('A sunlit studio with mats on a wooden floor')
    expect((stored.nodes as unknown as Record<string, { props?: Record<string, unknown> }>)[hero?.imageId as string].props?.['decorative']).toBeUndefined()
  })

  type Stored = Record<string, { componentId?: string; props?: Record<string, unknown> }>
  const sectionPictures = (stored: { nodes: unknown }, slots: ReturnType<typeof build>['slots'], index: number) =>
    slots
      .filter((slot) => slot.sectionIndex === index)
      .map((slot) => (stored.nodes as Stored)[slot.imageId as string].props ?? {})

  it.each(['portfolio', 'photography'])('opens a %s gallery in a lightbox, one gallery per section, captioned (AGL-3717)', (kind) => {
    const { sections, plan } = page('Selected work', 4)
    const { slots, stored, report } = build(sections, plan, { kind, seed: 3, home: true })
    expect(report.violations).toEqual([])
    const pictures = sectionPictures(stored, slots, 1)
    expect(pictures).toHaveLength(4)
    for (const [index, props] of pictures.entries()) {
      expect(props).toMatchObject({ lightbox: true, lightboxGallery: 'Selected work', lightboxCaption: `piece number ${index + 1}` })
    }
  })

  it('leaves another kind’s pictures plain unless the design asks (AGL-3717)', () => {
    const { sections, plan } = page('Shop by collection', 4)
    const { slots, stored } = build(sections, plan, { kind: 'store', seed: 3, home: true })
    for (const props of sectionPictures(stored, slots, 1)) expect(props['lightbox']).toBeUndefined()
  })

  it('opens an image block large when its to is lightbox (AGL-3717)', () => {
    const { sections, plan } = page('Why people come', 3)
    sections[2] = { ...sections[2], blocks: [...sections[2].blocks, { kind: 'image', text: 'The studio at dusk', to: 'lightbox' }] }
    const { slots, stored, report } = build(sections, plan, { kind: 'yoga', seed: 5, home: true })
    expect(report.violations).toEqual([])
    const [picture] = sectionPictures(stored, slots, 2)
    expect(picture).toMatchObject({ lightbox: true, lightboxGallery: 'About the studio' })
  })
})

describe('a site design on a workspace that keeps components (AGL-3660)', () => {
  it('still draws work as pictures, which rule 1 reads as compiled, and every other repeat compact', () => {
    const { sections, plan } = page('Selected work', 4)
    const { slots, report } = build(sections, plan, { kind: 'portfolio', seed: 3, home: true }, true)
    expect(report.violations).toEqual([])
    expect(slots.filter((slot) => slot.sectionIndex === 1)).toHaveLength(4)
    const ruled = build(page('Why people come', 3).sections, page('Why people come', 3).plan, { kind: 'yoga', seed: 3, home: true }, true)
    expect(ruled.report.violations).toEqual([])
    expect(Object.values(ruled.stored.nodes).filter((node) => (node as { componentId: string }).componentId === 'muiListItemText')).toHaveLength(3)
  })

  it('holds the same picture cards to rule 1 where nothing says the layout language drew them', () => {
    const { sections, plan } = page('Selected work', 4)
    const { stored } = build(sections, plan, { kind: 'portfolio', seed: 3, home: true }, true)
    const report = validateAiDoctrineTree({ rootId: CANVAS_ROOT_ELEMENT_ID, nodes: stored.nodes }, 'page', {
      screenIds: TARGETS.pages.map((entry) => entry.id),
      homeScreenIds: ['pg-home'],
      scrollTargetIds: plan.sections.map((_, index) => `sec-${index + 1}`),
      codeBuilt: true,
    })
    expect(report.violations.map((violation) => violation.code)).toContain('repeated-subtree')
  })
})

describe('the header over a photo cover, and a quiet footer under a dark close (AGL-3660)', () => {
  const cover = (): number => {
    for (let seed = 1; seed < 200; seed += 1) if (aiLayoutDesignChoices({ kind: 'restaurant', seed, home: true }).hero === 'cover') return seed
    throw new Error('no cover seed')
  }

  it('marks a page that opens on a photo cover to run under the header, and no other band', () => {
    const { sections, plan } = page('Menu highlights', 4)
    const { stored } = build(sections, plan, { kind: 'restaurant', seed: cover(), home: true })
    const under = Object.entries(stored.nodes).filter(([, node]) => (node as { props?: Record<string, unknown> }).props?.['underHeader'] === true)
    expect(under.map(([id]) => id)).toEqual(['sec-1'])
  })

  it('gives every header the offer to sit over such a page, and quiets a brand footer when pages close dark', () => {
    const frame = (closesDark: boolean) =>
      aiCompileLayoutFrame(
        { header: { blocks: [] }, footer: { band: 'brand', blocks: [{ kind: 'text', text: 'A small studio in town.' }] } },
        { siteName: 'Studio', homeId: 'pg-home', navPages: TARGETS.pages, closesDark },
        TARGETS,
      ).tree.nodes
    const bar = Object.values(frame(false)).find((node) => node.componentId === 'muiAppBar')
    expect(bar?.props?.['overHero']).toBe(true)
    const footerOf = (nodes: ReturnType<typeof frame>) => Object.values(nodes).find((node) => node.props?.['element'] === 'footer')
    expect(footerOf(frame(false))?.sx).toMatchObject({ bgcolor: 'primary.main' })
    expect(footerOf(frame(true))?.sx).toMatchObject({ bgcolor: 'background.paper' })
  })
})

describe('a restaurant’s dishes (AGL-3660)', () => {
  it('read as one ruled list on a phone: each dish under its rule, the two columns a line’s gap apart', () => {
    const { sections, plan } = page('Menu highlights', 4)
    const { stored, report } = build(sections, plan, { kind: 'restaurant', seed: 9, home: true })
    expect(report.violations).toEqual([])
    const nodes = Object.values(stored.nodes) as Array<{ componentId: string; props?: Record<string, unknown>; sx?: Record<string, unknown> }>
    const row = nodes.find((node) => node.componentId === 'muiGrid' && node.props?.['columnSpacing'] === '8')
    expect(row?.props).toMatchObject({ container: true, rowSpacing: '2' })
    // Every dish opens under its own rule, one style key an element.
    expect(nodes.filter((node) => node.componentId === 'muiBox' && JSON.stringify(node.sx) === JSON.stringify({ borderTop: 1 }))).toHaveLength(4)
  })
})

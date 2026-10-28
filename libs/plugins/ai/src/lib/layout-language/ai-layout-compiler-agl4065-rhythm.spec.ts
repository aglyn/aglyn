/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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

import { aiLayoutPageCheck } from '../jobs/ai-job-page-language'
import {
  HOLESHOT_HOME_PLAN,
  HOLESHOT_HOME_SECTIONS,
  HOLESHOT_TARGETS,
  PIT_ROW_IN_PICTURES,
  PIT_ROW_PICTURES_PLAN,
  PIT_ROW_PICTURES_SECTIONS,
  PIT_ROW_PICTURES_TARGETS,
  RUT_RUNNERS_IN_PICTURES,
  RUT_RUNNERS_PICTURES_PLAN,
  RUT_RUNNERS_PICTURES_SECTIONS,
  RUT_RUNNERS_PICTURES_TARGETS,
  TWO_OAKS_HOME_PLAN,
  TWO_OAKS_HOME_SECTIONS,
  TWO_OAKS_TARGETS,
} from '../jobs/fixtures/ai-site-agl4065-plans'
import type { AiBuildPlanScreen } from '../model/ai-build-plan'
import { aiCompileLayoutPage, type AiLayoutPagePlan } from './ai-layout-compiler'
import type { AiLayoutSection } from './ai-layout-language'
import type { AiLayoutTargets } from './ai-layout-links'

/**
 * No three text-only bands in a row (AGL-4065). The booth kit's trades homes
 * of 2026-10-25 ran their middles as bands of words: Holeshot Moto Repair's
 * numbered steps, its repair list (a dataset with no photos) and "Why riders
 * and racing parents trust the shop" stacked three thin, picture-less bands
 * under the hero, and Two Oaks Handyman's steps, questions and "Towns we
 * serve" did the same lower down. On a site drawn with a design — whose
 * stand-in pictures the stock library fills — the third such band in a run
 * is now set beside a photo, its words and its items in one half, a picture
 * of its subject in the other, at most twice a page. Steps and questions
 * stay text, as they read best; a page drawn with no design is unchanged.
 */

type Node = { componentId: string; props?: Record<string, unknown>; sx?: Record<string, unknown> | null; nodes?: string[] }

const SEEDS = Array.from({ length: 60 }, (_, index) => ((index + 1) * 2_654_435_761) >>> 0)

/** A section as the page tool writes it: every field present. */
function full(section: AiLayoutSection): Record<string, unknown> {
  return {
    band: section.band ?? 'plain',
    cols: section.cols ?? [],
    align: section.align ?? 'start',
    blocks: section.blocks.map((block) => ({
      kind: block.kind,
      col: block.col ?? -1,
      text: block.text ?? '',
      to: block.to ?? '',
      style: block.style ?? 'none',
      icon: block.icon ?? '',
      items: (block.items ?? []).map((item) => ({ title: item.title, text: item.text, to: item.to ?? '', icon: item.icon ?? '' })),
    })),
  }
}

/** The page compiled as the page step compiles it, through its own check: reader, compiler, store, copy check and doctrine. */
function check(plan: AiLayoutPagePlan, sections: AiLayoutSection[], targets: AiLayoutTargets, seed: number | null, paid: boolean, kind = 'trades') {
  const sectionIds = plan.sections.map((_, index) => `sec-${index + 1}`)
  const screen = { title: plan.title, slug: '/', layout: null, template: null, duplicateOf: null, nav: true, seoTitle: 'Home', seoDescription: 'Home.', record: null, sections: plan.sections } as unknown as AiBuildPlanScreen
  const result = aiLayoutPageCheck({
    screen,
    sectionIds,
    targets,
    context: {
      screenIds: [targets.pageId as string, ...targets.pages.map((page) => page.id)],
      formIds: targets.forms.map((form) => form.id),
      componentIds: [],
      datasetIds: (targets.listings ?? []).flatMap((listing) => (listing.datasetId ? [listing.datasetId] : [])),
      homeScreenIds: ['pg-home'],
      codeBuilt: true,
      repeatsCompiled: true,
      scrollTargetIds: sectionIds,
      ...(paid ? {} : { reusableComponents: false }),
    },
    reusableComponents: paid,
    design: seed === null ? null : { kind, seed, home: true },
  })({ sections: sections.map(full) })
  const nodes = (result.value?.nodes ?? {}) as unknown as Record<string, Node>
  const within = (id: string): Node[] => (nodes[id] ? [nodes[id], ...(nodes[id].nodes ?? []).flatMap(within)] : [])
  return {
    result,
    sectionIds,
    within,
    /** How many pictures each section shows: its photos, stand-ins and a dataset's record photos alike. */
    pictures: sectionIds.map((id) => within(id).filter((node) => node.componentId === 'image').length),
    settled: (result.value?.settled ?? []).map((entry) => `${entry.at}: ${entry.what}`),
  }
}

/** The longest run of sections in a row that show no picture. */
function longestBareRun(pictures: readonly number[]): number {
  let run = 0
  let longest = 0
  for (const count of pictures) {
    run = count ? 0 : run + 1
    longest = Math.max(longest, run)
  }
  return longest
}

const PAGES = [
  ['Holeshot Moto Repair', HOLESHOT_HOME_PLAN, HOLESHOT_HOME_SECTIONS, HOLESHOT_TARGETS, { steps: [1], questions: [4] }],
  ['Two Oaks Handyman', TWO_OAKS_HOME_PLAN, TWO_OAKS_HOME_SECTIONS, TWO_OAKS_TARGETS, { steps: [3], questions: [4] }],
] as const

describe.each(PAGES)('the %s home, drawn with a design (AGL-4065)', (_name, plan, sections, targets, exempt) => {
  it.each([
    ['free', false],
    ['paid', true],
  ])('shows no run of three sections without a picture, on %s, for every seed', (_label, paid) => {
    const failures: string[] = []
    for (const seed of SEEDS) {
      const built = check(plan, sections, targets, seed, paid)
      expect([seed, built.result.violations.map((violation) => `${violation.code}: ${violation.message}`)]).toEqual([seed, []])
      if (longestBareRun(built.pictures) >= 3) failures.push(`seed ${seed}: ${built.pictures.join(' ')}`)
    }
    expect(failures).toEqual([])
  })

  it('keeps its steps and its questions as text, and sets at most two bands beside a photo', () => {
    for (const seed of SEEDS) {
      for (const paid of [false, true]) {
        const built = check(plan, sections, targets, seed, paid)
        for (const index of [...exempt.steps, ...exempt.questions]) expect([seed, index, built.pictures[index]]).toEqual([seed, index, 0])
        expect(built.settled.filter((line) => line.endsWith('drawn beside a photo: third text-only band')).length).toBeLessThanOrEqual(2)
      }
    }
  })
})

describe('the band set beside a photo (AGL-4065)', () => {
  it('is Holeshot’s "Why riders and racing parents trust the shop": its heading, its three reasons and a photo of its subject', () => {
    for (const paid of [false, true]) {
      const built = check(HOLESHOT_HOME_PLAN, HOLESHOT_HOME_SECTIONS, HOLESHOT_TARGETS, SEEDS[0], paid)
      expect(built.settled).toContain('sections[3]: drawn beside a photo: third text-only band')
      const parts = built.within('sec-4')
      const photo = parts.filter((node) => node.componentId === 'image')
      expect(photo).toHaveLength(1)
      expect(photo[0].props?.['alt']).toBe('Why riders and racing parents trust the shop')
      const words = parts.flatMap((node) => [node.props?.['children'], node.props?.['primary']]).filter((value): value is string => typeof value === 'string')
      expect(words).toEqual(expect.arrayContaining(['Why riders and racing parents trust the shop', 'Open since 2014', 'Straight answers', 'English and Spanish']))
      expect(built.result.value?.items[3]).toBe(3)
    }
  })

  it('is Two Oaks’s "Towns we serve", every town still listed', () => {
    const built = check(TWO_OAKS_HOME_PLAN, TWO_OAKS_HOME_SECTIONS, TWO_OAKS_TARGETS, SEEDS[0], true)
    expect(built.settled).toContain('sections[5]: drawn beside a photo: third text-only band')
    expect(built.pictures[5]).toBe(1)
    expect(built.result.value?.items[5]).toBe(5)
  })
})

describe('a band "in pictures" is a gallery of picture slots (AGL-4065)', () => {
  /*
   * The Rut Runners Racing and Pit Row Tacos homes of 2026-10-25 each planned
   * a band of six pictures — "The team at the track in pictures", "The
   * trailer and the food in pictures" — and drew six caption pairs with no
   * picture slot, so no photo could ever fill them: the compiler read a
   * gallery only from "gallery", "portfolio" or "lookbook".
   */
  it.each([
    ['Rut Runners Racing', 'fitness', RUT_RUNNERS_PICTURES_PLAN, RUT_RUNNERS_PICTURES_SECTIONS, RUT_RUNNERS_PICTURES_TARGETS, RUT_RUNNERS_IN_PICTURES],
    ['Pit Row Tacos', 'restaurant', PIT_ROW_PICTURES_PLAN, PIT_ROW_PICTURES_SECTIONS, PIT_ROW_PICTURES_TARGETS, PIT_ROW_IN_PICTURES],
  ] as const)('draws the %s band as six picture slots captioned with its items, free or paid, for every seed', (_name, kind, plan, sections, targets, captions) => {
    for (const seed of SEEDS.slice(0, 30)) {
      for (const paid of [false, true]) {
        const built = check(plan, sections, targets, seed, paid, kind)
        expect([seed, paid, built.result.violations.map((violation) => `${violation.code}: ${violation.message}`)]).toEqual([seed, paid, []])
        const band = built.within('sec-3')
        const slots = band.filter((node) => node.componentId === 'image')
        // A stand-in slot each, described by its item, which the photo fill reads.
        expect([seed, paid, slots.map((node) => node.props?.['alt'])]).toEqual([seed, paid, captions.map((item) => item.title)])
        for (const slot of slots) expect(slot.props?.['decorative']).toBe(true)
        // Never caption pairs: the titles are the pictures' captions.
        expect([seed, paid, band.filter((node) => node.componentId === 'muiListItemText')]).toEqual([seed, paid, []])
        expect(built.result.value?.items[2]).toBe(6)
      }
    }
  })

  it('reads "photos" as it reads "pictures", and never a word that only holds one', () => {
    for (const name of ['Race day in pictures', 'The trailer in photos', 'Pictures from the track', 'Photos of our work']) {
      const sections: AiLayoutSection[] = [
        RUT_RUNNERS_PICTURES_SECTIONS[0] as AiLayoutSection,
        { band: 'plain', blocks: [{ kind: 'heading', text: name }, { kind: 'cards', items: [...RUT_RUNNERS_IN_PICTURES.slice(0, 3)] }] },
      ]
      const plan = { title: 'Home', sections: [RUT_RUNNERS_PICTURES_PLAN.sections[0], { name, uses: [], items: 3 }] } as AiLayoutPagePlan
      const built = check(plan, sections, RUT_RUNNERS_PICTURES_TARGETS, SEEDS[0], true, 'fitness')
      expect([name, built.pictures[1]]).toEqual([name, 3])
    }
    // "Photoshoot packages" and "Picture-perfect yards" name no showing of pictures.
    for (const name of ['Photoshoot packages', 'Picture-perfect yards']) {
      const sections: AiLayoutSection[] = [
        RUT_RUNNERS_PICTURES_SECTIONS[0] as AiLayoutSection,
        { band: 'plain', blocks: [{ kind: 'heading', text: name }, { kind: 'cards', items: [...RUT_RUNNERS_IN_PICTURES.slice(0, 3)] }] },
      ]
      const plan = { title: 'Home', sections: [RUT_RUNNERS_PICTURES_PLAN.sections[0], { name, uses: [], items: 3 }] } as AiLayoutPagePlan
      expect([name, check(plan, sections, RUT_RUNNERS_PICTURES_TARGETS, SEEDS[0], true, 'fitness').pictures[1]]).toEqual([name, 0])
    }
  })
})

describe('a page drawn with no design (AGL-4065)', () => {
  /** Each section's elements, in tree order, as the compiler drew them before AGL-4065. */
  const SHAPE = (plan: AiLayoutPagePlan, sections: AiLayoutSection[], targets: AiLayoutTargets, paid: boolean) => {
    const compiled = aiCompileLayoutPage(sections, plan, targets, { reusableComponents: paid })
    const nodes = compiled.tree.nodes as unknown as Record<string, Node>
    const walk = (id: string): string[] => [nodes[id].componentId, ...(nodes[id].nodes ?? []).flatMap(walk)]
    return { shape: compiled.sectionRoots.map((id) => walk(id).join(' ')), settled: compiled.settled }
  }

  it.each([
    ['Holeshot Moto Repair', HOLESHOT_HOME_PLAN, HOLESHOT_HOME_SECTIONS, HOLESHOT_TARGETS],
    ['Two Oaks Handyman', TWO_OAKS_HOME_PLAN, TWO_OAKS_HOME_SECTIONS, TWO_OAKS_TARGETS],
  ] as const)('leaves %s as it was: no photo placed, no band moved', (_name, plan, sections, targets) => {
    for (const paid of [false, true]) {
      const { shape, settled } = SHAPE(plan, sections, targets, paid)
      expect(shape.join(' ').split(' ').filter((id) => id === 'image')).toEqual(
        // A dataset whose records carry photos still lists them, as before.
        targets === TWO_OAKS_TARGETS ? ['image'] : [],
      )
      expect(settled.map((entry) => entry.what)).not.toContain('drawn beside a photo: third text-only band')
      expect(shape).toEqual(NO_DESIGN_SHAPES[`${_name}:${paid ? 'paid' : 'free'}`])
    }
  })
})

/**
 * The shape each page took with no design before AGL-4065, captured from
 * `origin/main` e95fcf3d90: each section's elements in tree order.
 */
const NO_DESIGN_SHAPES: Record<string, string[]> = {
  'Holeshot Moto Repair:free': [
    'section muiContainer muiStack muiTypography muiTypography muiTypography muiButton',
    'section muiContainer muiStack muiTypography muiGrid muiGrid muiStack muiTypography muiTypography muiTypography muiGrid muiStack muiTypography muiTypography muiTypography muiGrid muiStack muiTypography muiTypography muiTypography muiGrid muiStack muiTypography muiTypography muiTypography',
    'section muiContainer muiStack muiGrid muiGrid muiStack muiTypography muiTypography muiGrid muiButton muiBox muiStack muiTypography muiTypography',
    'section muiContainer muiStack muiTypography muiGrid muiGrid muiCard muiCardContent muiStack muiTypography muiTypography muiGrid muiCard muiCardContent muiStack muiTypography muiTypography muiGrid muiCard muiCardContent muiStack muiTypography muiTypography',
    'section muiContainer muiStack muiTypography muiStack muiAccordion muiAccordionSummary muiAccordionDetails muiTypography muiAccordion muiAccordionSummary muiAccordionDetails muiTypography muiAccordion muiAccordionSummary muiAccordionDetails muiTypography muiAccordion muiAccordionSummary muiAccordionDetails muiTypography',
    'section muiContainer muiStack muiTypography muiTypography muiButton',
  ],
  'Holeshot Moto Repair:paid': [
    'section muiContainer muiStack muiTypography muiTypography muiTypography muiButton',
    'section muiContainer muiStack muiTypography muiGrid muiGrid muiListItemText muiGrid muiListItemText muiGrid muiListItemText muiGrid muiListItemText',
    'section muiContainer muiStack muiGrid muiGrid muiStack muiTypography muiTypography muiGrid muiButton muiBox muiStack muiTypography muiTypography',
    'section muiContainer muiStack muiTypography muiGrid muiGrid muiListItemText muiGrid muiListItemText muiGrid muiListItemText',
    'section muiContainer muiStack muiTypography muiList muiListItem muiListItemText muiListItem muiListItemText muiListItem muiListItemText muiListItem muiListItemText',
    'section muiContainer muiStack muiTypography muiTypography muiButton',
  ],
  'Two Oaks Handyman:free': [
    'section muiContainer muiStack muiTypography muiTypography muiTypography muiButton',
    'section muiContainer muiStack muiTypography muiGrid muiGrid muiCard muiCardContent muiStack muiTypography muiTypography muiGrid muiCard muiCardContent muiStack muiTypography muiTypography muiGrid muiCard muiCardContent muiStack muiTypography muiTypography muiGrid muiCard muiCardContent muiStack muiTypography muiTypography',
    'section muiContainer muiStack muiGrid muiGrid muiStack muiTypography muiTypography muiGrid muiButton muiBox muiStack image muiTypography muiTypography muiTypography',
    'section muiContainer muiStack muiTypography muiGrid muiGrid muiStack muiTypography muiTypography muiTypography muiGrid muiStack muiTypography muiTypography muiTypography muiGrid muiStack muiTypography muiTypography muiTypography muiGrid muiStack muiTypography muiTypography muiTypography',
    'section muiContainer muiStack muiGrid muiGrid muiStack muiTypography muiTypography muiGrid muiButton muiBox muiStack muiTypography muiTypography',
    'section muiContainer muiStack muiTypography muiGrid muiGrid muiCard muiCardContent muiStack muiTypography muiTypography muiGrid muiCard muiCardContent muiStack muiTypography muiTypography muiGrid muiCard muiCardContent muiStack muiTypography muiTypography muiGrid muiCard muiCardContent muiStack muiTypography muiTypography muiGrid muiCard muiCardContent muiStack muiTypography muiTypography',
    'section muiContainer muiStack muiTypography muiTypography muiButton',
  ],
  'Two Oaks Handyman:paid': [
    'section muiContainer muiStack muiTypography muiTypography muiTypography muiButton',
    'section muiContainer muiStack muiTypography muiGrid muiGrid muiListItemText muiGrid muiListItemText muiGrid muiListItemText muiGrid muiListItemText',
    'section muiContainer muiStack muiGrid muiGrid muiStack muiTypography muiTypography muiGrid muiButton muiBox muiStack image muiTypography muiTypography muiTypography',
    'section muiContainer muiStack muiTypography muiGrid muiGrid muiListItemText muiGrid muiListItemText muiGrid muiListItemText muiGrid muiListItemText',
    'section muiContainer muiStack muiGrid muiGrid muiStack muiTypography muiTypography muiGrid muiButton muiBox muiStack muiTypography muiTypography',
    'section muiContainer muiStack muiTypography muiGrid muiGrid muiListItemText muiGrid muiListItemText muiGrid muiListItemText muiGrid muiListItemText muiGrid muiListItemText',
    'section muiContainer muiStack muiTypography muiTypography muiButton',
  ],
}

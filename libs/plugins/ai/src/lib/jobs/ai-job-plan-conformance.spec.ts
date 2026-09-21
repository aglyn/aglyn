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

import type { AiJobPlan } from '../model/ai-jobs.types'
import {
  aiLayoutRegionOf,
  aiRepeatedItemCount,
  aiTreeLayoutRegions,
  detectPlanUnreadableRegions,
  validateAiBuildPlan,
  type AiDoctrineTree,
} from '../runtime/ai-doctrine-validators'
import {
  aiPlanCopiedPageViolations,
  aiPlanItemCountViolations,
  aiPlanRegionViolations,
  aiPlanTemplateTokenViolations,
  aiPlannedLayoutRegions,
  aiPlannedTemplateTokens,
  aiTreeBoundTokens,
} from './ai-job-plan-conformance'
import { AI_TEMPLATE_SUBJECT_DEFINITIONS } from '../model/ai-template-subjects'

/**
 * The build held to the plan the member confirmed (AGL-3024): the three
 * shapes a plan promises structurally — a count of items, a layout's regions
 * and a template's binding tokens — measured against what was actually built.
 *
 * Every case here is a build that the doctrine validators admit: none of
 * these trees breaks a building rule, which is exactly why a plan that
 * under-delivers used to report `Done`.
 */

const NOW = new Date('2026-09-20T12:00:00.000Z')

function planWithLayoutFields(fields: string[]): AiJobPlan {
  return {
    reuse: [],
    create: [
      {
        kind: 'layout',
        name: 'harborline-interior-layout',
        why: 'Interior pages need section links beside the content, which the base layout lacks.',
        duplicateOf: 'lay-base',
        fields,
      },
    ],
    screens: [],
    status: 'confirmed',
    labels: {},
    proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
    confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
    confirmedBy: 'uid-1',
  }
}

/** A practice-areas section of `count` cards in a Grid, as a page stores it. */
function cardsSection(count: number): AiDoctrineTree {
  const nodes: AiDoctrineTree['nodes'] = {
    sec: { componentId: 'section', props: { element: 'section' }, nodes: ['grid'] },
    grid: {
      componentId: 'muiGrid',
      props: { container: true, spacing: 3 },
      nodes: Array.from({ length: count }, (_, index) => `cell-${index}`),
    },
  }
  for (let index = 0; index < count; index += 1) {
    nodes[`cell-${index}`] = { componentId: 'muiGrid', props: { size: 'xs:12 md:4' }, nodes: [`card-${index}`] }
    nodes[`card-${index}`] = { componentId: 'muiCard', props: { variant: 'outlined' }, nodes: [`body-${index}`] }
    nodes[`body-${index}`] = { componentId: 'muiCardContent', nodes: [`title-${index}`] }
    nodes[`title-${index}`] = {
      componentId: 'muiTypography',
      props: { variant: 'h3', component: 'h3', children: `Practice area ${index + 1}` },
    }
  }
  return { rootId: 'sec', nodes }
}

/** The base layout the measured job copied: an app bar, the slot, a footer — no aside. */
const BASE_LAYOUT: AiDoctrineTree = {
  rootId: '_@_',
  nodes: {
    '_@_': { componentId: 'div', nodes: ['bar', 'slot', 'foot'] },
    bar: { componentId: 'muiAppBar', nodes: ['toolbar'] },
    toolbar: { componentId: 'muiToolbar', nodes: [] },
    slot: { componentId: 'layoutSlot' },
    foot: { componentId: 'section', props: { element: 'footer' }, nodes: [] },
  },
}

/** The same layout with the sidebar the plan promised. */
const LAYOUT_WITH_SIDEBAR: AiDoctrineTree = {
  rootId: '_@_',
  nodes: {
    ...BASE_LAYOUT.nodes,
    '_@_': { componentId: 'div', nodes: ['bar', 'aside', 'slot', 'foot'] },
    aside: { componentId: 'section', props: { element: 'aside' }, nodes: [] },
  },
}

describe('a count the plan promised (AGL-3024)', () => {
  it('refuses a section that shows fewer items than the plan said, naming both numbers', () => {
    expect(
      aiPlanItemCountViolations({ name: 'practice areas', items: 4 }, cardsSection(3)),
    ).toEqual([
      {
        rule: null,
        code: 'plan-items-short',
        message:
          'The confirmed plan says the "practice areas" section shows 4 items, and this section shows 3. Build all 4.',
      },
    ])
  })

  it('keeps a section that shows every item the plan said, and one that shows more', () => {
    expect(aiPlanItemCountViolations({ name: 'practice areas', items: 4 }, cardsSection(4))).toEqual([])
    expect(aiPlanItemCountViolations({ name: 'practice areas', items: 4 }, cardsSection(6))).toEqual([])
  })

  it('promises nothing to count below two items, so a one-off section is never short', () => {
    expect(aiPlanItemCountViolations({ name: 'hero', items: 0 }, cardsSection(0))).toEqual([])
    expect(aiPlanItemCountViolations({ name: 'hero', items: 1 }, cardsSection(0))).toEqual([])
  })

  it('does not count a section whose items a collection fills at render', () => {
    const bound: AiDoctrineTree = {
      rootId: 'sec',
      nodes: {
        sec: { componentId: 'section', props: { element: 'section' }, nodes: ['entries'] },
        entries: { componentId: 'collectionEntries', props: { collectionSlug: 'areas' }, nodes: ['card'] },
        card: { componentId: 'muiCard', nodes: ['title'] },
        title: { componentId: 'muiTypography', props: { children: '{{entry.title}}' } },
      },
    }
    expect(aiPlanItemCountViolations({ name: 'practice areas', items: 4 }, bound)).toEqual([])
  })

  it('reads the count as generously as the tree allows: the widest fan-out, or the largest shared shape', () => {
    // Four cards in two rows of two: no parent has four children, and the
    // four cards share one shape.
    const twoRows: AiDoctrineTree = {
      rootId: 'sec',
      nodes: {
        sec: { componentId: 'section', props: { element: 'section' }, nodes: ['r1', 'r2'] },
        r1: { componentId: 'muiStack', props: { direction: 'row' }, nodes: ['a', 'b'] },
        r2: { componentId: 'muiStack', props: { direction: 'row' }, nodes: ['c', 'd'] },
        a: { componentId: 'muiCard', props: { variant: 'outlined' } },
        b: { componentId: 'muiCard', props: { variant: 'outlined' } },
        c: { componentId: 'muiCard', props: { variant: 'outlined' } },
        d: { componentId: 'muiCard', props: { variant: 'outlined' } },
      },
    }
    expect(aiRepeatedItemCount(twoRows)).toBe(4)
    expect(aiPlanItemCountViolations({ name: 'practice areas', items: 4 }, twoRows)).toEqual([])
  })
})

describe('a region the plan promised (AGL-3024)', () => {
  it('reads a layout field as a region the way a recorded plan writes one', () => {
    expect([
      aiLayoutRegionOf('layoutSlot:slot'),
      aiLayoutRegionOf('header:region (logo, nav links)'),
      aiLayoutRegionOf('footer: firm name, address, phone, copyright'),
      aiLayoutRegionOf('Sidebar region'),
      aiLayoutRegionOf('side-bar'),
      aiLayoutRegionOf('aside'),
      aiLayoutRegionOf('breadcrumbs'),
    ]).toEqual(['main', 'header', 'footer', 'sidebar', 'sidebar', 'sidebar', null])
  })

  it('finds the regions a built layout carries, by element and by palette element', () => {
    expect([...aiTreeLayoutRegions(BASE_LAYOUT)].sort()).toEqual(['footer', 'header', 'main'])
    expect([...aiTreeLayoutRegions(LAYOUT_WITH_SIDEBAR)].sort()).toEqual([
      'footer',
      'header',
      'main',
      'sidebar',
    ])
  })

  it('refuses a copy of the base layout against a plan that gives it a sidebar', () => {
    const plan = planWithLayoutFields(['header', 'sidebar', 'main', 'footer'])
    expect(aiPlannedLayoutRegions(plan)).toEqual({
      regions: ['header', 'sidebar', 'main', 'footer'],
      unreadable: [],
    })
    const found = aiPlanRegionViolations(plan, BASE_LAYOUT)
    expect(found.map((violation) => [violation.rule, violation.code])).toEqual([
      [null, 'plan-region-missing'],
    ])
    expect(found[0].message).toContain('"sidebar"')
  })

  it('keeps the same layout once the sidebar the plan named is built', () => {
    const plan = planWithLayoutFields(['header', 'sidebar', 'main', 'footer'])
    expect(aiPlanRegionViolations(plan, LAYOUT_WITH_SIDEBAR)).toEqual([])
  })

  it('promises nothing where the plan lists no region, and nothing where it creates no layout', () => {
    expect(aiPlanRegionViolations(planWithLayoutFields([]), BASE_LAYOUT)).toEqual([])
    expect(aiPlanRegionViolations(null, BASE_LAYOUT)).toEqual([])
  })

  it('says so rather than passing when the plan names a region nothing can look for', () => {
    const plan = planWithLayoutFields(['header', 'breadcrumbs'])
    expect(aiPlannedLayoutRegions(plan).unreadable).toEqual(['breadcrumbs'])
    expect(aiPlanRegionViolations(plan, BASE_LAYOUT).map((violation) => violation.code)).toEqual([
      'plan-region-unreadable',
    ])
  })

  it('refuses the unreadable region on the plan too, where a re-ask costs a sentence', () => {
    const found = detectPlanUnreadableRegions(planWithLayoutFields(['header', 'breadcrumbs']))
    expect(found.map((violation) => [violation.rule, violation.code, violation.paths])).toEqual([
      [2, 'plan-layout-region-unknown', ['create[0].fields[1]']],
    ])
    expect(detectPlanUnreadableRegions(planWithLayoutFields(['header', 'sidebar']))).toEqual([])
  })

  // The rule above is only reached through the plan doctrine, and the plan
  // step runs THAT, never the detector. Asserting the detector alone leaves
  // the one line that wires it in uncovered: drop it from `validateAiBuildPlan`
  // and every other assertion here still passes, while an unreadable region
  // reaches the build as a promise no check can settle.
  it('runs that rule as part of the plan doctrine, not only on its own', () => {
    expect(
      validateAiBuildPlan(planWithLayoutFields(['header', 'breadcrumbs']), null).map(
        (violation) => violation.code,
      ),
    ).toContain('plan-layout-region-unknown')
    expect(
      validateAiBuildPlan(planWithLayoutFields(['header', 'sidebar']), null).map(
        (violation) => violation.code,
      ),
    ).not.toContain('plan-layout-region-unknown')
  })
})

/**
 * The page kind's copy branch (AGL-3024): the same hole the layout copy had.
 * It generates nothing, so no model answers for the plan and the copy itself
 * has to — over the whole page, because a copy carries the SOURCE's nodes and
 * nothing maps the plan's sections onto them.
 */

describe('a token the plan promised for a template (AGL-3143 §11)', () => {
  const AUTHOR = AI_TEMPLATE_SUBJECT_DEFINITIONS.author

  const planWithTemplateFields = (fields: string[]): AiJobPlan => ({
    reuse: [],
    create: [
      {
        kind: 'template',
        name: 'attorney-profile-template-v2',
        why: 'The existing template lacks a bar-admissions block and a bound contact form.',
        duplicateOf: 'tpl-base',
        fields,
      },
    ],
    screens: [],
    status: 'confirmed',
    labels: {},
    proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
    confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
    confirmedBy: 'uid-1',
  })

  /** A template that binds the author's name and job title, and nothing else. */
  const NAME_AND_TITLE = {
    rootId: 'r',
    nodes: {
      r: { componentId: 'div', nodes: ['h', 't'] },
      h: { componentId: 'muiTypography', props: { children: '{{author.name}}', variant: 'h1' } },
      t: { componentId: 'muiTypography', props: { children: '{{author.jobTitle}}' } },
    },
  } as unknown as Parameters<typeof aiPlanTemplateTokenViolations>[2]

  it('reads the tokens a built template binds, however they are nested in props', () => {
    expect([...aiTreeBoundTokens(NAME_AND_TITLE)].sort()).toEqual(['author.jobtitle', 'author.name'])
  })

  it('reads a plan field as a token whether or not it wears its braces', () => {
    expect(aiPlannedTemplateTokens(planWithTemplateFields(['{{author.bio}}', 'author.name']), AUTHOR)).toEqual({
      tokens: ['{{author.bio}}', '{{author.name}}'],
      unreadable: [],
    })
  })

  it('refuses a template that binds less than the plan promised', () => {
    const plan = planWithTemplateFields(['{{author.name}}', '{{author.jobTitle}}', '{{author.bio}}'])
    const found = aiPlanTemplateTokenViolations(plan, AUTHOR, NAME_AND_TITLE)
    expect(found.map((violation) => [violation.rule, violation.code])).toEqual([
      [null, 'plan-token-missing'],
    ])
    expect(found[0].message).toContain('{{author.bio}}')
    // The two it DID bind are not named: the finding is what is missing.
    expect(found[0].message).not.toContain('{{author.name}}')
  })

  it('says nothing when the template binds everything the plan promised', () => {
    const plan = planWithTemplateFields(['{{author.name}}', '{{author.jobTitle}}'])
    expect(aiPlanTemplateTokenViolations(plan, AUTHOR, NAME_AND_TITLE)).toEqual([])
  })

  it('refuses a promise the subject cannot fill, which is the measured miss', () => {
    // The live AGL-3024 run: the brief asked for an attorney's bar admissions,
    // the plan promised "a bar-admissions block", the built template had none
    // and reported Done. `author` fills six tokens and no catalog anywhere
    // fills a bar admission, so the promise was unkeepable when it was made —
    // and read as a token list it cannot be made at all.
    const plan = planWithTemplateFields(['{{author.name}}', 'bar admissions'])
    expect(aiPlannedTemplateTokens(plan, AUTHOR).unreadable).toEqual(['bar admissions'])
    const found = aiPlanTemplateTokenViolations(plan, AUTHOR, NAME_AND_TITLE)
    expect(found.map((violation) => violation.code)).toEqual(['plan-token-unreadable'])
    expect(found[0].message).toContain('bar admissions')
    // It names what the page CAN fill, so the re-ask has somewhere to go.
    expect(found[0].message).toContain('{{author.bio}}')
  })

  it('says nothing about a plan with no template creation at all', () => {
    expect(aiPlannedTemplateTokens(null, AUTHOR)).toEqual({ tokens: [], unreadable: [] })
    expect(aiPlanTemplateTokenViolations(null, AUTHOR, NAME_AND_TITLE)).toEqual([])
  })
})

describe('a count the plan promised, against a page a copy produced (AGL-3024)', () => {
  const sections = (items: number) => ({
    sections: [
      { name: 'hero', uses: [], items: 0 },
      { name: 'practice areas', uses: [], items },
    ],
  })
  /** A copied page: a hero, then `count` cards. A screen carries no app bar and no footer. */
  const copiedPage = (count: number): AiDoctrineTree => ({
    rootId: '_@_',
    nodes: {
      '_@_': { componentId: 'div', nodes: ['hero', 'sec'] },
      hero: { componentId: 'section', props: { element: 'section' }, nodes: ['lede'] },
      lede: { componentId: 'muiTypography', props: { variant: 'h1', children: 'Harborline Law' } },
      ...cardsSection(count).nodes,
    },
  })

  it('refuses a copy that shows fewer of anything than the plan promised', () => {
    expect(aiPlanCopiedPageViolations(sections(4), copiedPage(3))).toEqual([
      {
        rule: null,
        code: 'plan-items-short',
        message:
          'The confirmed plan says the "practice areas" section shows 4 items, and this page is a copy that shows at most 3 of anything. Build the 4.',
      },
    ])
  })

  it('keeps a copy that already shows every item the plan promised', () => {
    expect(aiPlanCopiedPageViolations(sections(4), copiedPage(4))).toEqual([])
  })

  it('promises nothing where no section of the plan promises a repeat', () => {
    expect(aiPlanCopiedPageViolations(sections(1), copiedPage(3))).toEqual([])
    expect(aiPlanCopiedPageViolations({ sections: [] }, copiedPage(3))).toEqual([])
  })

  it('does not count a copy whose items a collection fills at render', () => {
    const bound: AiDoctrineTree = {
      rootId: '_@_',
      nodes: {
        '_@_': { componentId: 'div', nodes: ['list'] },
        list: { componentId: 'collectionEntries', props: { collectionId: 'col-1' }, nodes: [] },
      },
    }
    expect(aiPlanCopiedPageViolations(sections(4), bound)).toEqual([])
  })
})

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
  type AiDoctrineTree,
} from '../runtime/ai-doctrine-validators'
import {
  aiPlanItemCountViolations,
  aiPlanRegionViolations,
  aiPlannedLayoutRegions,
} from './ai-job-plan-conformance'

/**
 * The build held to the plan the member confirmed (AGL-3024): the two shapes
 * a plan promises structurally — a count of items, and a layout's regions —
 * measured against what was actually built.
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
})
